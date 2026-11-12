"""Inline every <script src="..."> into index.html so the APK ships one self-contained page.

Some Android WebViews refuse to load further file:///android_asset/ files from a
local page, which left the game stuck on its loading screen.
Usage: python bundle.py <web dir> <output index.html>
"""
import re
import sys
from pathlib import Path

web, out = Path(sys.argv[1]), Path(sys.argv[2])
html = (web / 'index.html').read_text(encoding='utf8')


def inline(m):
    src = m.group(1)
    code = (web / src).read_text(encoding='utf8')
    # a literal "</script" inside JS would end the inline block early
    code = code.replace('</script', '<\\/script')
    return '<script>/* %s */\n%s\n</script>' % (src, code)


bundled, n = re.subn(r'<script src="([^"]+)"></script>', inline, html)
if re.search(r'<script[^>]+src=', bundled):
    sys.exit('bundle.py: an external <script src> was left behind')
out.write_text(bundled, encoding='utf8')
print('bundled %d scripts into %s (%d KB)' % (n, out.name, len(bundled.encode('utf8')) // 1024))
