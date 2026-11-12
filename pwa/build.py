"""Builds the installable web app (PWA) into pwa/build/.

It is the same single self-contained page the APK ships, plus a manifest, icons and a service
worker so phones can add it to the home screen and open it offline.
Usage: python pwa/build.py
"""
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parent
out = here / 'build'
shutil.rmtree(out, ignore_errors=True)
out.mkdir()

subprocess.run([sys.executable, str(root / 'android' / 'bundle.py'), str(root / 'web'), str(out / 'index.html')], check=True)
html = (out / 'index.html').read_text(encoding='utf8')
if '<!--pwa-->' not in html:
    sys.exit('pwa/build.py: web/index.html has lost its <!--pwa--> marker')
(out / 'index.html').write_text(html.replace('<!--pwa-->', (here / 'head.html').read_text(encoding='utf8').strip()), encoding='utf8')

version = re.search(r"const VERSION = '([^']+)'", (root / 'web' / 'js' / 'data.js').read_text(encoding='utf8')).group(1)
build = '%s-%d' % (version, int(time.time()))
(out / 'sw.js').write_text((here / 'sw.js').read_text(encoding='utf8').replace('__BUILD__', build), encoding='utf8')
for name in ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']:
    shutil.copy(here / name, out / name)
(out / '.nojekyll').write_text('', encoding='utf8')       # serve the files exactly as they are
print('web app %s built in %s' % (build, out))
