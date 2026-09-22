@echo off
chcp 65001 >nul
rem SPDX-FileCopyrightText: 2026 milkc0de
rem SPDX-License-Identifier: MIT
setlocal DisableDelayedExpansion
if not exist "%~dp0index.html" (
  echo index.htmlが見つかりません。ZIPをすべて展開してから起動してください。
  pause
  exit /b 1
)
py -3 -c "import sys; sys.exit(not (sys.version_info[0] == 3 and sys.version_info >= (3, 7)))" >nul 2>&1
if not errorlevel 1 (
  set "PLAYER_PYTHON=py -3"
  goto run
)
python3 -c "import sys; sys.exit(not (sys.version_info[0] == 3 and sys.version_info >= (3, 7)))" >nul 2>&1
if not errorlevel 1 (
  set "PLAYER_PYTHON=python3"
  goto run
)
python -c "import sys; sys.exit(not (sys.version_info[0] == 3 and sys.version_info >= (3, 7)))" >nul 2>&1
if not errorlevel 1 (
  set "PLAYER_PYTHON=python"
  goto run
)
echo Python 3が必要です。Python 3をインストールしてから、もう一度起動してください。
pause
exit /b 1
:run
echo.
echo ChibiRigKit - local player
echo このPCの中だけで動く表示用サーバーです。
echo インターネットには公開されず、同じWi-Fiの別の端末からもアクセスできません。
echo 起動・表示にインターネット接続は不要です（Python 3の導入時を除く）。
echo OBSの「ブラウザ」ソースに貼るURL：http://127.0.0.1:5510/
echo 使用中はこの画面を開いたままにしてください。終了はCtrl+Cです。
echo ポート5510が使用中の場合は、先に起動したサーバーを停止してください。
echo.
rem Use dot to avoid the quoted trailing backslash in the script directory.
pushd "%~dp0" || exit /b 1
%PLAYER_PYTHON% -m http.server 5510 --bind 127.0.0.1 --directory .
set "PLAYER_STATUS=%ERRORLEVEL%"
popd
if not "%PLAYER_STATUS%"=="0" pause
exit /b %PLAYER_STATUS%
