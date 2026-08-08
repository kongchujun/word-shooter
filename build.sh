#!/usr/bin/env bash
# 构建前端 + 打包成单二进制。产出在 build/。
set -euo pipefail
cd "$(dirname "$0")"

./scripts/fetch-geoip.sh

echo "==> 构建前端"
npm --prefix web install --silent
npm --prefix web run build

mkdir -p build

echo "==> 编译 linux/amd64"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o build/word-shooter-linux-amd64 ./cmd/word-shooter

echo "==> 编译本机版本"
CGO_ENABLED=0 go build -trimpath -o build/word-shooter ./cmd/word-shooter

ls -lh build/
echo
echo "部署: scp build/word-shooter-linux-amd64 和整个 assets/ 目录到服务器同一层,然后 ./word-shooter-linux-amd64 -addr :8091"
