param(
  [int]$Port = 1896
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js，请先安装 Node.js 20 或更高版本。'
}

Set-Location -LiteralPath $bridgeRoot
npm ci --ignore-scripts

$commandDirectory = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'
$commandLauncherPath = Join-Path $commandDirectory 'bjtuca-bridge.ps1'
$commandShimPath = Join-Path $commandDirectory 'bjtuca-bridge.cmd'
New-Item -ItemType Directory -Path $commandDirectory -Force | Out-Null

$commandScriptPath = Join-Path $bridgeRoot 'command.ps1'
$escapedCommandScriptPath = $commandScriptPath.Replace("'", "''")
$launcherText = @"
param([Parameter(ValueFromRemainingArguments=`$true)][string[]]`$BridgeArguments)
& '$escapedCommandScriptPath' @BridgeArguments
exit `$LASTEXITCODE
"@
[System.IO.File]::WriteAllText($commandLauncherPath, $launcherText, [System.Text.UTF8Encoding]::new($true))
[System.IO.File]::WriteAllText(
  $commandShimPath,
  "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0bjtuca-bridge.ps1`" %*`r`n",
  [System.Text.Encoding]::ASCII
)

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not ($pathEntries | Where-Object { $_.TrimEnd('\') -ieq $commandDirectory.TrimEnd('\') })) {
  $nextUserPath = (@($pathEntries) + $commandDirectory) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User')
}
if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $commandDirectory.TrimEnd('\') })) {
  $env:Path = "$env:Path;$commandDirectory"
}

Write-Host "Bridge 已安装到当前目录：$bridgeRoot"
Write-Host '已注册 bjtuca-bridge 命令，可在任意目录启动。'
Write-Host 'Bridge 正在运行；按 Ctrl+C 可停止。'
if ($Port -eq 1896) {
  npm start
} else {
  npm start -- --port=$Port
}
