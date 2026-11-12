#!/usr/bin/env bash
# Builds MeepleJacks into a signed APK without Gradle:
# aapt2 (resources) -> javac -> d8 (dex) -> zipalign -> apksigner.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="${ANDROID_BUILD_TOOLS:-/c/Users/mcnee/android-build}"
export JAVA_HOME="$(ls -d "$TOOLS"/jdk/jdk-* | head -1)"
export PATH="$JAVA_HOME/bin:$PATH"
BT="$TOOLS/bt/android-14"
JAR="$TOOLS/plat/android-34/android.jar"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
# signing password lives in android/signing.env (git-ignored): KS_PASS=...
[ -f "$HERE/signing.env" ] && . "$HERE/signing.env"
: "${KS_PASS:?Set KS_PASS or create android/signing.env}"

OUT="$HERE/build"
rm -rf "$OUT"; mkdir -p "$OUT"/{res,gen,obj,dex,assets}

echo "• assets"
# one self-contained page: some WebViews block local pages from loading other local files
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  # skip Windows' Microsoft Store "python3" stub, which isn't a real interpreter
  for c in /c/Users/mcnee/AppData/Local/Programs/Python/Python3*/python.exe python3 python; do
    if "$c" -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
"$PY" "$HERE/bundle.py" "$ROOT/web" "$OUT/assets/index.html"

echo "• resources"
"$BT/aapt2.exe" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$JAR" \
  --manifest "$HERE/AndroidManifest.xml" -A "$OUT/assets" --java "$OUT/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

echo "• java"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR" -classpath "$BT/core-lambda-stubs.jar" -d "$OUT/obj" \
  $(find "$HERE/src" "$OUT/gen" -name '*.java')

echo "• dex"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/obj" -name '*.class')

echo "• package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && "$JAVA_HOME/bin/jar" uf "$OUT/unsigned.apk" classes.dex)
"$BT/zipalign.exe" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "• sign"
KS="$HERE/meeplejacks.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias meeplejacks -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=MeepleJacks, O=Home" >/dev/null
fi
java -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-key-alias meeplejacks --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$ROOT/MeepleJacks.apk" "$OUT/aligned.apk"
java -jar "$BT/lib/apksigner.jar" verify --print-certs "$ROOT/MeepleJacks.apk" | head -2
ls -la "$ROOT/MeepleJacks.apk"
