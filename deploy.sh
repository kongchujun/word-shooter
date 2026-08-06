#!/usr/bin/env bash
# 在服务器上运行:下载最新构建 → 停掉旧进程 → 启动新版本。
#
#   ./deploy.sh                 # 默认端口 8091
#   PORT=9000 ./deploy.sh       # 换端口
#
# 只替换二进制,assets/ 里的图片、音频、words.json 原样保留。
# 下载失败就直接退出,不会把能跑的旧版本弄坏。
set -euo pipefail

REPO="kongchujun/word-shooter"
PORT="${PORT:-8091}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"

BIN="$APP_DIR/word-shooter"
PID_FILE="$APP_DIR/word-shooter.pid"
LOG_FILE="$APP_DIR/word-shooter.log"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *)
    echo "不支持的架构: $(uname -m)" >&2
    exit 1
    ;;
esac

ASSET="word-shooter-linux-$ARCH"
BASE="https://github.com/$REPO/releases/download/latest"

# ---------- 1. 先下载,下不下来就不动现有服务 ----------

echo "==> 下载 $ASSET"
# 临时文件放在同一个目录,最后那步替换才是原子的
TMP="$(mktemp "$APP_DIR/.word-shooter.XXXXXX")"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

curl -fSL --retry 3 --retry-delay 2 -o "$TMP" "$BASE/$ASSET"

if [ ! -s "$TMP" ]; then
  echo "下载到的是空文件,放弃" >&2
  exit 1
fi

# 校验和是可选的:CI 传了就核对,核对不上一定是包坏了
if command -v sha256sum >/dev/null 2>&1 &&
  curl -fsSL --retry 2 -o "$TMP.sums" "$BASE/checksums.txt" 2>/dev/null; then
  want="$(awk -v f="$ASSET" '$2 == f || $2 == "*"f { print $1 }' "$TMP.sums")"
  got="$(sha256sum "$TMP" | cut -d' ' -f1)"
  rm -f "$TMP.sums"
  if [ -n "$want" ] && [ "$want" != "$got" ]; then
    echo "校验和对不上,包可能损坏,放弃" >&2
    echo "  期望 $want" >&2
    echo "  实际 $got" >&2
    exit 1
  fi
  echo "    校验和 OK"
fi

chmod +x "$TMP"

# ---------- 2. 停掉旧进程 ----------

# 先 TERM,给它时间收尾;赖着不走再 KILL
stop_pid() {
  local pid=$1
  kill "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  echo "    $pid 没响应 TERM,强制结束"
  kill -9 "$pid" 2>/dev/null || true
}

# 查端口上在听的进程。不同发行版装的工具不一样,挨个试
port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$PORT" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  elif command -v ss >/dev/null 2>&1; then
    ss -lptnH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 || true
  fi
}

# 进程叫什么名字。用来确认端口上蹲着的确实是我们自己的服务
pid_name() {
  local pid=$1
  readlink -f "/proc/$pid/exe" 2>/dev/null ||
    ps -p "$pid" -o comm= 2>/dev/null ||
    true
}

echo "==> 停掉旧进程"

if [ -f "$PID_FILE" ]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "    pid 文件里的 $old"
    stop_pid "$old"
  fi
fi

for pid in $(port_pids); do
  name="$(pid_name "$pid")"
  case "$name" in
    *word-shooter*)
      echo "    端口 $PORT 上的 $pid"
      stop_pid "$pid"
      ;;
    "")
      echo "端口 $PORT 上的进程 $pid 看不出是什么(可能属于别的用户)。" >&2
      echo "请手动确认后再跑,或者用 PORT=别的端口。" >&2
      exit 1
      ;;
    *)
      echo "端口 $PORT 上是别的程序($name),没有动它。" >&2
      echo "换个端口,或者先手动停掉它。" >&2
      exit 1
      ;;
  esac
done

# ---------- 3. 换上新版本并启动 ----------

echo "==> 替换二进制"
mv "$TMP" "$BIN"
trap - EXIT

echo "==> 启动"
cd "$APP_DIR"
nohup "$BIN" -addr ":$PORT" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

# 起不来的话当场就报出来,别等用户发现页面打不开
for _ in $(seq 1 20); do
  sleep 0.5
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/manifest" 2>/dev/null; then
    echo "==> 好了:pid $(cat "$PID_FILE"),端口 $PORT,日志 $LOG_FILE"
    exit 0
  fi
done

echo "启动后 10 秒内没有响应,日志最后 20 行:" >&2
tail -n 20 "$LOG_FILE" >&2
exit 1
