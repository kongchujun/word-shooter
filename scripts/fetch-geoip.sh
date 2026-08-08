#!/usr/bin/env bash
# 下载 IP 归属地库(ip2region,Apache 2.0 / MIT)。
# 文件 11MB 不进仓库,构建前拉一次;已经有了就跳过。
# 拉不到不算失败 —— 归属地只是锦上添花,没有它服务照常跑,只是不显示归属地。
set -uo pipefail
cd "$(dirname "$0")/.."

DEST=internal/geoip/data/ip2region_v4.xdb
URL=https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb

if [ -s "$DEST" ]; then
  echo "==> IP 归属地库已存在($(du -h "$DEST" | cut -f1)),跳过下载"
  exit 0
fi

echo "==> 下载 IP 归属地库"
mkdir -p internal/geoip/data
if curl -fSL --retry 3 --retry-delay 2 -o "$DEST.tmp" "$URL"; then
  mv "$DEST.tmp" "$DEST"
  echo "    完成($(du -h "$DEST" | cut -f1))"
else
  rm -f "$DEST.tmp"
  echo "    ⚠️  下载失败,这次构建出的二进制不带归属地功能(其余不受影响)"
fi
