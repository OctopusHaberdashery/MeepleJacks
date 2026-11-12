#!/usr/bin/env bash
# Builds the web app and publishes it to the gh-pages branch, which GitHub Pages serves at
# https://octopushaberdashery.github.io/MeepleJacks/
# The branch holds only the built files and is replaced on every publish.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  # skip Windows' Microsoft Store "python3" stub, which isn't a real interpreter
  for c in /c/Users/mcnee/AppData/Local/Programs/Python/Python3*/python.exe python3 python; do
    if "$c" -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
"$PY" "$HERE/build.py"

cd "$HERE/build"
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Publish web app from $(git -C "$ROOT" rev-parse --short HEAD)"
git push -q -f "$(git -C "$ROOT" remote get-url origin)" gh-pages
rm -rf .git
echo "published to gh-pages"
