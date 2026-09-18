param(
  [int]$Port = 1896
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js，请先安装 Node.js 20 或更高版本。'
}

Set-Location $bridgeRoot
npm ci --ignore-scripts
Write-Host "Bridge 已安装到当前目录：$bridgeRoot"
Write-Host 'Bridge 即将启动；按 Ctrl+C 可停止。'
if ($Port -eq 1896) {
  npm start
} else {
  npm start -- --port=$Port
}
