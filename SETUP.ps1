# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js をインストールしてください。' }
    if ($env:PYTHON) { & $env:PYTHON -m venv .venv }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv .venv }
    else { & python -m venv .venv }
    if ($LASTEXITCODE -ne 0) { throw 'Python 仮想環境の作成に失敗しました。' }
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python ライブラリのインストールに失敗しました。' }
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'Node.js ライブラリのインストールに失敗しました。' }
    Write-Host 'セットアップ完了。次に .\AUTO_RIG.ps1 "画像のパス" を実行してください。'
} finally { Pop-Location }
