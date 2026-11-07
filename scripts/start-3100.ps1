# STAFFETTA（3100）を起動する（管理役2 11/7）。PC を立ち上げたとき（タスク スケジューラのログオン時）にも、手でも使う。
#   1. cloudflared の quick tunnel（LINE の Webhook 用）が動いていなければ起動する
#   2. 3100 が動いていなければ起動する（next start。ビルド済みの .next を使う）
#   3. 30秒待って scripts/line-webhook-sync.mjs で LINE の受け口の URL を合わせる（quick tunnel は起動ごとに URL が変わる）
# LIFF・画面の外からの入口は Tailscale Funnel（固定 URL）。Tailscale は Windows のサービスなので、ここでは起動しない。
# 使い方:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-3100.ps1
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root "data"
New-Item -ItemType Directory -Force $data | Out-Null
$log = Join-Path $data "start-3100.log"
function Say($m) { "$(Get-Date -Format s) $m" | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $m }

# 1. cloudflared
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
  Say "cloudflared は動いています"
} elseif (Test-Path $cf) {
  Start-Process -FilePath $cf -ArgumentList "tunnel --no-autoupdate --url http://localhost:3100" -WindowStyle Hidden `
    -RedirectStandardError (Join-Path $data "cloudflared.log") -RedirectStandardOutput (Join-Path $data "cloudflared.out.log")
  Say "cloudflared を起動しました"
} else {
  Say "cloudflared が見つかりません（$cf）"
}

# 2. 3100
$up = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if ($up) {
  Say "3100 は動いています"
} else {
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx next start -p 3100 >> `"$data\next-3100.log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
  Say "3100 を起動しました"
}

# 3. LINE の受け口の URL を合わせる
Start-Sleep -Seconds 30
Push-Location $root
& node scripts/line-webhook-sync.mjs
$code = $LASTEXITCODE
Pop-Location
Say "LINE の受け口の URL を合わせました（終わりのコード $code。中身は data\line-webhook-sync.log）"
