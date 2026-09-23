#!/bin/sh
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
PLAYER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
/bin/sh "$PLAYER_DIR/START_SERVER.sh"
PLAYER_STATUS=$?
if [ "$PLAYER_STATUS" -ne 0 ] && [ "$PLAYER_STATUS" -ne 130 ]; then
  printf '\nサーバーが停止しました。Enterキーで閉じます。 '
  read -r reply
fi
exit "$PLAYER_STATUS"
