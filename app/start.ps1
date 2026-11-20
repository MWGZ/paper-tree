$ErrorActionPreference = "Stop"
$envFile = Join-Path $PSScriptRoot ".env"
$example = Join-Path $PSScriptRoot ".env.example"

if (!(Test-Path $envFile)) {
  Copy-Item $example $envFile
  Write-Host ""
  Write-Host "已创建 app/.env。"
  Write-Host "请填入 DEEPSEEK_API_KEY 后重新运行；不填则进入演示模式。"
  Write-Host ""
}

node (Join-Path $PSScriptRoot "server.mjs")
