#!/bin/sh
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
set -eu
if [ "$#" -lt 1 ]; then echo '使い方: sh AUTO_RIG.sh "画像のパス、またはキャラフォルダ" [追加オプション]'; exit 2; fi
case "$1" in /*) rig_input=$1;; *) rig_input="$PWD/$1";; esac
shift
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
rig_python=${PYTHON:-"$PWD/.venv/bin/python"}
[ -x "$rig_python" ] || { echo '先に sh SETUP.sh を実行してください。'; exit 2; }
[ -d node_modules ] || npm install
if [ -f "$rig_input" ]; then
  rig_workspace=$("$rig_python" scripts/new_character.py --normal "$rig_input")
elif [ -d "$rig_input" ]; then
  rig_workspace=$rig_input
else
  echo "画像・フォルダが見つかりません: $rig_input"; exit 2
fi
npm run auto -- --character "$rig_workspace" --python "$rig_python" "$@"
