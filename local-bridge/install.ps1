param(
  [int]$Port = 1896
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bridge'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js。请先安装 Node.js 20 或更高版本。'
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installRoot 'src') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'package.json') -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'package-lock.json') -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'src\config.js') -Destination (Join-Path $installRoot 'src') -Force
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'src\server.js') -Destination (Join-Path $installRoot 'src') -Force

Push-Location $installRoot
try {
  npm ci --ignore-scripts
  Write-Host "Bridge 已安装到：$installRoot"
  Write-Host "启动命令：Set-Location '$installRoot'; npm start -- --port=$Port"
} finally {
  Pop-Location
}
