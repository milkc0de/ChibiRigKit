#!/bin/sh
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
setup_python=${PYTHON:-python3.12}
if ! command -v "$setup_python" >/dev/null 2>&1; then setup_python=python3; fi
command -v "$setup_python" >/dev/null 2>&1 || { echo 'Pythonをインストールしてください。'; exit 2; }
command -v npm >/dev/null 2>&1 || { echo 'Node.jsをインストールしてください。'; exit 2; }
"$setup_python" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm install
npm run setup:tracking
echo 'セットアップ完了。次に sh AUTO_RIG.sh "画像のパス" を実行してください。'
