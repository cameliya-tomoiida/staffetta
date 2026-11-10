# PC にログオンしたら STAFFETTA を自動で起動するように、Windows のタスク スケジューラに登録する（管理役2 11/7）。
# 中身は scripts\start-3100.ps1（cloudflared → 3100 → LINE の受け口の URL を合わせる）。
# 登録は担当者が1回だけ実行する:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-startup-task.ps1
# やめるとき:  Unregister-ScheduledTask -TaskName "STAFFETTA 起動" -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\start-3100.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT30S"  # ログオン直後はネットワークがつながっていないことがあるので、30秒あとに
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0) -StartWhenAvailable
Register-ScheduledTask -TaskName "STAFFETTA 起動" -Action $action -Trigger $trigger -Settings $settings -Description "cloudflared（LINE の Webhook）→ STAFFETTA 3100 → LINE の受け口の URL を合わせる" -Force | Out-Null
Write-Host "登録しました: タスク「STAFFETTA 起動」（ログオンの30秒あと）"
