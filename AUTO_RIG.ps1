# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
# Pass the image/folder first; remaining arguments go directly to the rig command.
$ErrorActionPreference = 'Stop'
if ($args.Count -lt 1) { throw '使い方: .\AUTO_RIG.ps1 "画像のパス、またはキャラフォルダ" [追加オプション]' }
$rigInput = (Resolve-Path -LiteralPath $args[0]).Path
$rigExtra = @($args | Select-Object -Skip 1)
Push-Location $PSScriptRoot
try {
    $rigPython = if ($env:PYTHON) { $env:PYTHON } else { Join-Path $PSScriptRoot '.venv\Scripts\python.exe' }
    if (-not (Test-Path -LiteralPath $rigPython)) { throw '先に .\SETUP.ps1 を実行してください。' }
    if (-not (Test-Path node_modules)) {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
    }
    if (Test-Path -LiteralPath $rigInput -PathType Leaf) {
        $rigWorkspace = & $rigPython scripts/new_character.py --normal $rigInput
        if ($LASTEXITCODE -ne 0) { throw 'キャラフォルダを作成できませんでした。' }
    } else { $rigWorkspace = $rigInput }
    & npm.cmd run auto -- --character "$rigWorkspace" --python "$rigPython" @rigExtra
    if ($LASTEXITCODE -ne 0) { throw '自動リグが停止しました。直前のエラーを確認してください。' }
} finally { Pop-Location }
