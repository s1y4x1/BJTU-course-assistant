param(
  [ValidateRange(1, 65535)][int]$Port = 1896,
  [switch]$SkipStart
)

# ASCII bootstrap: repository templates are GBK/936, installed launchers UTF-8 BOM.
# Decode before using any localized strings, including in pwsh (UTF-8 by default).
if ($BJTUCAEncodingReloadedPath -ne $PSCommandPath) {
  $sourceBytes = [System.IO.File]::ReadAllBytes($PSCommandPath)
  if ($sourceBytes.Length -lt 3 -or $sourceBytes[0] -ne 239 -or $sourceBytes[1] -ne 187 -or $sourceBytes[2] -ne 191) {
    $BJTUCAEncodingReloadedPath = $PSCommandPath
    $sourceText = [System.IO.File]::ReadAllText($PSCommandPath, [System.Text.Encoding]::GetEncoding(936))
    $sourceTokens = $null; $sourceErrors = $null
    $sourceAst = [System.Management.Automation.Language.Parser]::ParseInput($sourceText, $PSCommandPath, [ref]$sourceTokens, [ref]$sourceErrors)
    if ($sourceErrors.Count) { throw $sourceErrors[0] }
    $sourceArguments = @()
    if ($args.Count) { $sourceArguments = @($args) }
    & $sourceAst.GetScriptBlock() @PSBoundParameters @sourceArguments
    return
  }
}

$InstallerVersion = '1.0.12'
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSCommandPath

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
  '$bridgeRoot = Split-Path -Parent $PSCommandPath',
  "`$BJTUCACommandVersion = '$InstallerVersion'`r`n`$bridgeRoot = '$escapedBridgeRoot'"
)
$launcherEncoding = [System.Text.UTF8Encoding]::new($true)
foreach ($commandName in @('bjtuca-bridge', 'BJTUCA')) {
  $commandLauncherPath = Join-Path $commandDirectory ($commandName + '.ps1')
  $commandShimPath = Join-Path $commandDirectory ($commandName + '.cmd')
  [System.IO.File]::WriteAllText($commandLauncherPath, $launcherText, $launcherEncoding)
  [System.IO.File]::WriteAllText(
    $commandShimPath,
    "@echo off`r`nset `"BJTUCA_COMMAND_NAME=%~n0`"`r`nset BJTUCA_RAW_ARGUMENTS=%*`r`n(goto) 2>nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0$commandName.ps1`" %* & call set `"BJTUCA_COMMAND_EXIT=%%errorlevel%%`" & set `"BJTUCA_RAW_ARGUMENTS=`" & set `"BJTUCA_COMMAND_NAME=`" & call cmd.exe /d /c exit %%BJTUCA_COMMAND_EXIT%%`r`n",
    [System.Text.Encoding]::ASCII
  )
}

$protocolScriptPath = Join-Path $commandDirectory 'protocol.ps1'
$protocolText = [System.IO.File]::ReadAllText((Join-Path $bridgeRoot 'protocol.ps1'), [System.Text.Encoding]::GetEncoding(936))
$protocolText = $protocolText.Replace(
  '$bridgeRoot = Split-Path -Parent $PSCommandPath',
  "`$bridgeRoot = '$escapedBridgeRoot'"
)
[System.IO.File]::WriteAllText($protocolScriptPath, $protocolText, $launcherEncoding)
$protocolKey = 'HKCU:\Software\Classes\bjtuca'
New-Item -Path $protocolKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:BJTUCA Bridge Protocol'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$protocolCommandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $protocolCommandKey -Force | Out-Null
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Set-Item -LiteralPath $protocolCommandKey -Value ('"' + $powershellPath + '" -NoProfile -ExecutionPolicy Bypass -File "' + $protocolScriptPath + '" "%1"')

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
Write-Host '已注册 bjtuca-bridge 和 BJTUCA 命令及 bjtuca:// 协议，可在任意目录或从浏览器启动。'
if ($SkipStart) { return }
Write-Host 'Bridge 正在运行；按 Ctrl+C 可停止。'
if ($Port -eq 1896) {
  npm --silent start
} else {
  npm --silent start -- --port=$Port
}
