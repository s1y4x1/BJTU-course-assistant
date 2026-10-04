param(
  [int]$Port = 1896,
  [switch]$SkipStart
)

$InstallerVersion = '1.0.0'
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js，请先安装 Node.js 20 或更高版本。'
}

Set-Location -LiteralPath $bridgeRoot
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw '安装 Bridge 依赖失败' }

$commandDirectory = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'
New-Item -ItemType Directory -Path $commandDirectory -Force | Out-Null

$commandScriptPath = Join-Path $bridgeRoot 'command.ps1'
$escapedCommandScriptPath = $commandScriptPath.Replace("'", "''")
$launcherText = @"
param([Parameter(ValueFromRemainingArguments=`$true)][string[]]`$BridgeArguments)
`$BJTUCACommandVersion = '$InstallerVersion'
& '$escapedCommandScriptPath' @BridgeArguments
exit `$LASTEXITCODE
"@
foreach ($commandName in @('bjtuca-bridge', 'BJTUCA')) {
  $commandLauncherPath = Join-Path $commandDirectory ($commandName + '.ps1')
  $commandShimPath = Join-Path $commandDirectory ($commandName + '.cmd')
  [System.IO.File]::WriteAllText($commandLauncherPath, $launcherText, [System.Text.Encoding]::GetEncoding(936))
  [System.IO.File]::WriteAllText(
    $commandShimPath,
    "@echo off`r`nsetlocal`r`nset `"BJTUCA_COMMAND_NAME=%~n0`"`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0$commandName.ps1`" %*`r`n",
    [System.Text.Encoding]::ASCII
  )
}

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
Write-Host '已注册 bjtuca-bridge 和 BJTUCA 命令，可在任意目录启动。'
if ($SkipStart) { return }
Write-Host 'Bridge 正在运行；按 Ctrl+C 可停止。'
if ($Port -eq 1896) {
  npm start
} else {
  npm start -- --port=$Port
}
