# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'
$playerDirectory = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $playerDirectory 'index.html') -PathType Leaf)) {
    Write-Host 'index.htmlが見つかりません。ZIPをすべて展開してから起動してください。'
    exit 1
}
$pythonCommand = $null
$pythonArguments = @()
foreach ($candidate in @('py', 'python3', 'python')) {
    if (-not (Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue)) { continue }
    $prefix = @()
    if ($candidate -eq 'py') { $prefix = @('-3') }
    try {
        & $candidate @prefix -c 'import sys; sys.exit(not (sys.version_info[0] == 3 and sys.version_info >= (3, 7)))' 2>$null
        if ($LASTEXITCODE -eq 0) { $pythonCommand = $candidate; $pythonArguments = $prefix; break }
    } catch { continue }
}
if (-not $pythonCommand) {
    Write-Host 'Python 3が必要です。Python 3をインストールしてから、もう一度起動してください。'
    exit 1
}
Write-Host "`nChibiRigKit - local player"
Write-Host 'このPCの中だけで動く表示用サーバーです。'
Write-Host 'インターネットには公開されず、同じWi-Fiの別の端末からもアクセスできません。'
Write-Host '起動・表示にインターネット接続は不要です（Python 3の導入時を除く）。'
Write-Host 'OBSの「ブラウザ」ソースに貼るURL：http://127.0.0.1:5510/obs'
Write-Host '使用中はこの画面を開いたままにしてください。終了はCtrl+Cです。'
Write-Host "ポート5510が使用中の場合は、先に起動したサーバーを停止してください。`n"
& $pythonCommand @pythonArguments (Join-Path $playerDirectory 'PLAYER_SERVER.py')
exit $LASTEXITCODE
