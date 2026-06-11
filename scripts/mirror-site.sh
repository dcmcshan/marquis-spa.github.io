#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.mirror-build"
SITE_URL="${SITE_URL:-https://marquis.spa}"
WGET_BIN="${WGET_BIN:-wget}"

if ! command -v "$WGET_BIN" >/dev/null 2>&1; then
  echo "error: wget is required" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cat >"$BUILD_DIR/urls.txt" <<EOF
$SITE_URL/
$SITE_URL/about/
$SITE_URL/work-with-me/
$SITE_URL/contact/
$SITE_URL/shop/
$SITE_URL/product-category/services/
$SITE_URL/robots.txt
$SITE_URL/sitemap.xml
EOF

while IFS= read -r url; do
  [ -n "$url" ] || continue
  status=0
  "$WGET_BIN" \
    --page-requisites \
    --adjust-extension \
    --convert-links \
    --directory-prefix "$BUILD_DIR" \
    --no-host-directories \
    --restrict-file-names=windows \
    "$url" || status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 8 ]; then
    exit "$status"
  fi
done <"$BUILD_DIR/urls.txt"

python3 - "$ROOT_DIR" "$BUILD_DIR" <<'PY'
import os
import shutil
import sys

root = sys.argv[1]
source = sys.argv[2]
keep = {".git", ".gitignore", ".mirror-build", "README.md", "scripts"}

for name in os.listdir(root):
    if name in keep:
        continue
    path = os.path.join(root, name)
    if os.path.isdir(path):
        shutil.rmtree(path)
    else:
        os.remove(path)

for name in os.listdir(source):
    if name == "urls.txt":
        continue
    src = os.path.join(source, name)
    dst = os.path.join(root, name)
    shutil.move(src, dst)

open(os.path.join(root, ".nojekyll"), "a", encoding="utf-8").close()
shutil.rmtree(source)
PY

echo "Mirror complete in $ROOT_DIR"
