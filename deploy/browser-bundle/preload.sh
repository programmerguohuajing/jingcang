#!/bin/sh
set -eu

echo "[JingCang] Loading bundled Selenium browser images into Docker Engine..."
docker load -i /opt/jingcang/browsers.tar
echo "[JingCang] Browser image preload completed."
