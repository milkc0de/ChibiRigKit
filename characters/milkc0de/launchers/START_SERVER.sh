#!/bin/sh
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
# Serve only the completed player's directory; no packages or internet needed.
set -u
PLAYER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
if [ ! -f "$PLAYER_DIR/index.html" ]; then
  echo "index.htmlが見つかりません。ZIPをすべて展開してから起動してください。" >&2
  exit 1
fi
PLAYER_PYTHON=''
for candidate in python3 python /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(not (sys.version_info[0] == 3 and sys.version_info >= (3, 7)))' >/dev/null 2>&1; then
    PLAYER_PYTHON=$candidate
    break
  fi
done
if [ -z "$PLAYER_PYTHON" ]; then
  echo "Python 3が必要です。Python 3をインストールしてから、もう一度起動してください。" >&2
  exit 1
fi
printf '\nChibiRigKit - local player\nこのPCの中だけで動く表示用サーバーです。\nインターネットには公開されず、同じWi-Fiの別の端末からもアクセスできません。\n起動・表示にインターネット接続は不要です（Python 3の導入時を除く）。\nOBSの「ブラウザ」ソースに貼るURL： http://127.0.0.1:5510/obs\n使用中はこの画面を開いたままにしてください。終了はCtrl+Cです。\nポート5510が使用中の場合は、先に起動したサーバーを停止してください。\n\n'
exec "$PLAYER_PYTHON" "$PLAYER_DIR/PLAYER_SERVER.py"
