param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Uri
)

$ErrorActionPreference = 'Stop'
if ($args.Count) { throw 'Extra protocol arguments are not accepted.' }
$isChatroom = $false
$chatroomPort = 1897
$portArgument = @()
if ($Uri -match '\Abjtuca://chatroom/?(?:\?port=([0-9]{1,5}))?\z') {
  $isChatroom = $true
  if ($Matches[1]) {
    $chatroomPort = [int]$Matches[1]
    if ($chatroomPort -lt 1 -or $chatroomPort -gt 65535) { throw 'Port must be between 1 and 65535.' }
    $portArgument = @("--port=$chatroomPort")
  }
} elseif ($Uri -notmatch '\Abjtuca://(?:start)?/?\z') {
  throw 'Only bjtuca://start and bjtuca://chatroom[?port=1..65535] are supported. Commands and code are not accepted.'
}

$bridgeRoot = Split-Path -Parent $PSCommandPath
if ($isChatroom) {
  # Never route URL text through CMD, Invoke-Expression, or the -c command path.
  # Keep concurrent protocol activations from racing before node starts listening.
  $chatroomMutex = [Threading.Mutex]::new($false, "Local\BJTUCA-Protocol-Chatroom-$chatroomPort")
  $ownsChatroomMutex = $false
  $previousRunCommand = $env:BJTUCA_RUN_COMMAND
  $previousRawArguments = $env:BJTUCA_RAW_ARGUMENTS
  try {
    try { $ownsChatroomMutex = $chatroomMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsChatroomMutex = $true }
    if (-not $ownsChatroomMutex) { return }
    $health = $null
    try { $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$chatroomPort/health" -TimeoutSec 2 }
    catch { }
    if ($health.ok -eq $true -and $health.service -ceq 'bjtuca-chatroom') { return }
    $env:BJTUCA_RUN_COMMAND = $null
    $env:BJTUCA_RAW_ARGUMENTS = $null
    & node (Join-Path $bridgeRoot 'src\server.js') --chatroom @portArgument
  } finally {
    $env:BJTUCA_RUN_COMMAND = $previousRunCommand
    $env:BJTUCA_RAW_ARGUMENTS = $previousRawArguments
    if ($ownsChatroomMutex) { $chatroomMutex.ReleaseMutex() }
    $chatroomMutex.Dispose()
  }
  exit $LASTEXITCODE
}
$startMutex = [Threading.Mutex]::new($false, 'Local\BJTUCA-Protocol-Start')
$ownsMutex = $false
try {
  try { $ownsMutex = $startMutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { return }

  $configFile = Join-Path $bridgeRoot 'bridge.json'
  $port = 1896
  if (Test-Path -LiteralPath $configFile -PathType Leaf) {
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.port -ge 1 -and $config.port -le 65535) { $port = [int]$config.port }
  }
  $health = $null
  try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 }
  catch { }
  if ($health.ok -eq $true) { return }

  $launcher = Join-Path (Split-Path -Parent $PSCommandPath) 'BJTUCA.ps1'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'BJTUCA is not installed. Run modules/local-bridge/install.ps1 first.'
  }
  & $launcher start
} finally {
  if ($ownsMutex) { $startMutex.ReleaseMutex() }
  $startMutex.Dispose()
}
