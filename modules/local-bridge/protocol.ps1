param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Uri
)

$ErrorActionPreference = 'Stop'
if ($args.Count -or $Uri -notmatch '^bjtuca://(?:start)?/?$') {
  throw 'Only bjtuca://start is supported. Commands, code and query parameters are not accepted.'
}

$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
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

  $launcher = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'BJTUCA.ps1'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'BJTUCA is not installed. Run modules/local-bridge/install.ps1 first.'
  }
  & $launcher start
} finally {
  if ($ownsMutex) { $startMutex.ReleaseMutex() }
  $startMutex.Dispose()
}
