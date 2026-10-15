param(
  [int]$Port = 1896,
  [switch]$SkipStart
)

$InstallerVersion = '1.0.6'
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js，请先安装 Node.js 20 或更高版本。'
}

function Invoke-BridgeDependencyCommand {
  param([string]$Command, [string[]]$CommandArguments, [switch]$Quiet)
  # Windows PowerShell turns native stderr into ErrorRecord objects. Keep those
  # local to this call; dependency checks must be decided by the exit code.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  $commandOutput = & $Command @CommandArguments 2>&1
  $commandExitCode = $LASTEXITCODE
  if (-not $Quiet) {
    foreach ($line in $commandOutput) { Write-Host $line.ToString() }
  }
  return $commandExitCode
}

Set-Location -LiteralPath $bridgeRoot
$dependencyCheckPath = Join-Path $bridgeRoot 'src\check-dependencies.js'
$dependenciesReady = (Invoke-BridgeDependencyCommand -Command npm -CommandArguments @('ls', '--omit=dev', '--all', '--silent') -Quiet) -eq 0
if ($dependenciesReady) {
  $dependenciesReady = (Invoke-BridgeDependencyCommand -Command node -CommandArguments @($dependencyCheckPath) -Quiet) -eq 0
}
if (-not $dependenciesReady) {
  if ((Invoke-BridgeDependencyCommand -Command npm -CommandArguments @('install', '--ignore-scripts', '--no-audit', '--no-fund')) -ne 0) {
    throw '安装 Bridge 依赖失败'
  }
  if ((Invoke-BridgeDependencyCommand -Command node -CommandArguments @($dependencyCheckPath)) -ne 0) {
    throw 'Bridge 依赖校验失败，未更新命令入口'
  }
}

$commandDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant'))
$legacyCommandDirectory = Join-Path $commandDirectory 'bin'
New-Item -ItemType Directory -Path $commandDirectory -Force | Out-Null

$commandScriptPath = Join-Path $bridgeRoot 'command.ps1'
$escapedBridgeRoot = $bridgeRoot.Replace("'", "''")
$launcherText = [System.IO.File]::ReadAllText($commandScriptPath, [System.Text.Encoding]::GetEncoding(936))
$launcherText = $launcherText.Replace(
  '$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
  "`$BJTUCACommandVersion = '$InstallerVersion'`r`n`$bridgeRoot = '$escapedBridgeRoot'"
)
foreach ($commandName in @('bjtuca-bridge', 'BJTUCA')) {
  $commandLauncherPath = Join-Path $commandDirectory ($commandName + '.ps1')
  $commandShimPath = Join-Path $commandDirectory ($commandName + '.cmd')
  [System.IO.File]::WriteAllText($commandLauncherPath, $launcherText, [System.Text.Encoding]::GetEncoding(936))
  [System.IO.File]::WriteAllText(
    $commandShimPath,
    "@echo off`r`nsetlocal`r`nset `"BJTUCA_COMMAND_NAME=%~n0`"`r`n(goto) 2>nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0$commandName.ps1`" %*`r`n",
    [System.Text.Encoding]::ASCII
  )
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object {
  $_ -and $_.TrimEnd('\') -ine $commandDirectory.TrimEnd('\') -and $_.TrimEnd('\') -ine $legacyCommandDirectory.TrimEnd('\')
})
$nextUserPath = (@($pathEntries) + $commandDirectory) -join ';'
if ($nextUserPath -cne $userPath) {
  [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User')
}
$processPathEntries = @($env:Path -split ';' | Where-Object {
  $_.Trim() -and $_.Trim().TrimEnd('\') -ine $commandDirectory.TrimEnd('\') -and $_.Trim().TrimEnd('\') -ine $legacyCommandDirectory.TrimEnd('\')
})
$env:Path = (@($processPathEntries) + $commandDirectory) -join ';'
if (Test-Path -LiteralPath $legacyCommandDirectory -PathType Container) {
  if ([System.IO.Path]::GetFullPath((Split-Path -Parent $legacyCommandDirectory)) -ine $commandDirectory) {
    throw '旧命令目录校验失败'
  }
  Remove-Item -LiteralPath $legacyCommandDirectory -Recurse -Force
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
