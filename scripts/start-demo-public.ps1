# 審査員向けの見本の STAFFETTA（ポート 3118）を起動する（11/8 管理役2・担当者の決定）。中身は scripts\demo-public.mjs。
#   - 本番 3100 とは別の実体。データは data\demo-public\ の架空の見本だけ。LINE・メール・FAX の受け口の秘密は入れない
#   - 毎日 4:00（日本時間）に見本を作り直す（審査員が壊しても翌日もとに戻る）。落ちたら起こす
#   - 外へは Tailscale Funnel の 8443 で出す（管理役が開ける）。ここでは開けない
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-demo-public.ps1 -PublicUrl https://<PC の名前>.<tailnet>.ts.net:8443
# 前に1回だけ: 見本の画面を作る（本番の .next とは別）
#   $env:HUB_DIST_DIR=".next-demo"; npm run build
# 最初の管理者（judge）を作ったら、控える（初期化のあとも同じパスワードで入れる）:
#   node scripts\demo-public.mjs save-accounts
param([string]$PublicUrl = "")
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "data\demo-public"
New-Item -ItemType Directory -Force $dir | Out-Null
if (Get-NetTCPConnection -LocalPort 3118 -State Listen -ErrorAction SilentlyContinue) { Write-Host "3118 は動いています"; exit 0 }
$nodeArgs = @("scripts\demo-public.mjs", "serve")
if ($PublicUrl) { $nodeArgs += @("--public-url", $PublicUrl) }
Start-Process -FilePath "node" -ArgumentList $nodeArgs -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $dir "server.out.log") -RedirectStandardError (Join-Path $dir "server.err.log")
Write-Host "見本（3118）を起動しました。記録は data\demo-public\demo-public.log"
