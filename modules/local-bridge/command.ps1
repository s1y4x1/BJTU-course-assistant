param(
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$BridgeArguments,
  [Alias('v')][switch]$ShowVersion
)

# ASCII bootstrap: repository templates are GBK/936, installed launchers UTF-8 BOM.
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

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$bridgeRoot = Split-Path -Parent $PSCommandPath
$commandDirectory = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant'
$displayCommand = if ($env:BJTUCA_COMMAND_NAME) {
  $env:BJTUCA_COMMAND_NAME
} elseif ($MyInvocation.ScriptName) {
  [System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.ScriptName)
} else { 'BJTUCA' }
if ($BridgeArguments.Count -eq 1 -and $BridgeArguments[0] -eq '') { $BridgeArguments = @() }
$action = if ($ShowVersion) { '--version' } elseif ($BridgeArguments.Count) { $BridgeArguments[0] } else { 'start' }
if ($action -eq '--chatroom') { $action = 'chatroom' }
if ($action -in @('uninstall', 'uninst', 'unist', 'u')) {
  if ($BridgeArguments.Count -gt 2 -or ($BridgeArguments.Count -eq 2 -and $BridgeArguments[1] -ne '-r')) {
    throw "卸载命令仅接受 -r 参数（只取消注册），如 $displayCommand u -r"
  }
  $action = if ($BridgeArguments.Count -eq 2) { 'unregister' } else { 'uninstall' }
}

switch ($action) {
  { $_ -in @('help', '--help', '-h', '-?', '/?') } {
    Write-Output @"
用法：$displayCommand [start] [--port=端口]
      $displayCommand chatroom [--port=端口]
      $displayCommand --show-token
      $displayCommand -c "ve.courseList"
      $displayCommand -c "help ve.login ykt.assignments"
      $displayCommand uninstall
      $displayCommand unregister
      $displayCommand u -r
      $displayCommand --help
      $displayCommand -v

bjtuca-bridge 和 BJTUCA 支持相同参数。

start          启动本地 Bridge（默认操作，端口读取 bridge.json，初始为 1896）
chatroom       启动独立聊天室服务器（默认端口 1897，不等待扩展连接）
--port=N       指定端口 N（1 至 65535）：普通 Bridge 会写回 bridge.json；
               chatroom 仅影响该独立服务，不写入 bridge.json
--show-token   显示 bridge.json 中的 Bearer Token，不启动服务
-c 命令        执行一条终端命令并退出；复用正在运行的 Bridge，否则临时启动并等待扩展连接
uninstall      删除注册的命令并从用户 PATH 移除命令目录，且删除 Bridge 本身及配置（简写 u/uninst/unist）
unregister     仅取消命令注册并移除用户 PATH 项；保留 Bridge 本身及配置（简写 unreg，或 uninstall 及其简写加 -r）
-v, --version  显示命令入口版本，不启动 Bridge
"@
    return
  }
  { $_ -in @('-v', '--version') } {
    $versionVariable = Get-Variable -Name BJTUCACommandVersion -ErrorAction SilentlyContinue
    if ($versionVariable) {
      $commandVersion = $versionVariable.Value
    } else {
      $installerText = [System.IO.File]::ReadAllText((Join-Path $bridgeRoot 'install.ps1'), [System.Text.Encoding]::GetEncoding(936))
      $commandVersion = [regex]::Match($installerText, '(?m)^\$InstallerVersion\s*=\s*''([0-9]+(?:\.[0-9]+){1,3})''').Groups[1].Value
    }
    Write-Output "BJTUCA $commandVersion"
    return
  }
  { $_ -in @('uninstall', 'unregister', 'unreg') } {
    $actualBridgeDirectory = [System.IO.Path]::GetFullPath($bridgeRoot)
    if ($action -eq 'uninstall' -and (Test-Path -LiteralPath $actualBridgeDirectory)) {
      $bridgeModulePath = Join-Path $actualBridgeDirectory 'module.json'
      if ((Split-Path -Leaf $actualBridgeDirectory) -ine 'local-bridge' -or
          -not (Test-Path -LiteralPath $bridgeModulePath -PathType Leaf) -or
          (Get-Content -LiteralPath $bridgeModulePath -Raw | ConvertFrom-Json).id -ne 'local-bridge') {
        throw 'Bridge 目录校验失败，未执行卸载'
      }
    }
    $expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant'))
    $actualDirectory = [System.IO.Path]::GetFullPath($commandDirectory)
    if ($actualDirectory -ine $expectedDirectory) { throw '命令目录校验失败' }
    $protocolKey = 'HKCU:\Software\Classes\bjtuca'
    if (Test-Path -LiteralPath $protocolKey) {
      Remove-Item -LiteralPath $protocolKey -Recurse -Force
    }
    $legacyCommandDirectory = Join-Path $actualDirectory 'bin'
    Set-Location -LiteralPath $env:TEMP
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $remaining = @($userPath -split ';' | Where-Object {
      $_.Trim() -and $_.Trim().TrimEnd('\') -ine $actualDirectory.TrimEnd('\') -and $_.Trim().TrimEnd('\') -ine $legacyCommandDirectory.TrimEnd('\')
    })
    [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
    $env:Path = (@($env:Path -split ';' | Where-Object {
      $_.Trim() -and $_.Trim().TrimEnd('\') -ine $actualDirectory.TrimEnd('\') -and $_.Trim().TrimEnd('\') -ine $legacyCommandDirectory.TrimEnd('\')
    })) -join ';'
    if (Test-Path -LiteralPath $actualDirectory -PathType Container) {
      Remove-Item -LiteralPath $actualDirectory -Recurse -Force
    }
    if ($action -eq 'uninstall') {
      if (Test-Path -LiteralPath $actualBridgeDirectory -PathType Container) {
        Remove-Item -LiteralPath $actualBridgeDirectory -Recurse -Force
      }
      Write-Output 'bjtuca-bridge 和 BJTUCA 命令、用户 PATH 项及 Bridge 目录（含配置和依赖）已删除。'
    } else {
      Write-Output 'bjtuca-bridge 和 BJTUCA 命令已取消注册；Bridge 文件和 bridge.json 已保留。'
    }
    return
  }
  { $_ -in @('start', 'chatroom') } {
    $startArguments = if ($BridgeArguments.Count -gt 1) {
      @($BridgeArguments[1..($BridgeArguments.Count - 1)])
    } else { @() }
  }
  default { $startArguments = @($BridgeArguments) }
}

$startArguments = @($startArguments)
$singleCommandIndex = [Array]::IndexOf($startArguments, '-c')
$singleCommandText = $null
if ($singleCommandIndex -ge 0) {
  if ($action -eq 'chatroom') { throw 'chatroom 不支持 -c' }
  if ($singleCommandIndex -eq $startArguments.Count - 1) { throw '-c 后必须提供命令' }
  $singleCommandText = ($startArguments[($singleCommandIndex + 1)..($startArguments.Count - 1)] -join ' ').Trim()
  if (-not $singleCommandText) { throw '-c 后必须提供命令' }
  $startArguments = if ($singleCommandIndex) { @($startArguments[0..($singleCommandIndex - 1)]) } else { @() }
}
foreach ($argument in $startArguments) {
  if ($argument -notmatch '\A--port=([0-9]{1,5})\z' -and ($argument -ne '--show-token' -or $action -eq 'chatroom')) {
    throw "不支持的参数：$argument。运行 $displayCommand --help 查看用法。"
  }
  if ($argument -match '\A--port=([0-9]{1,5})\z' -and ([int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt 65535)) {
    throw '端口必须是 1 至 65535 的整数'
  }
}
if (@($startArguments | Where-Object { $_ -like '--port=*' }).Count -gt 1) { throw '只能指定一个端口' }
if ($startArguments -contains '--show-token' -and $startArguments.Count -ne 1) {
  throw '--show-token 不能与其他参数一起使用'
}
if ($singleCommandText -and $startArguments -contains '--show-token') { throw '-c 不能与 --show-token 一起使用' }
if ($startArguments -notcontains '--show-token') {
  $installerPath = Join-Path $bridgeRoot 'install.ps1'
  $installerText = [System.IO.File]::ReadAllText($installerPath, [System.Text.Encoding]::GetEncoding(936))
  $installerVersionMatch = [regex]::Match($installerText, '(?m)^\$InstallerVersion\s*=\s*''([0-9]+(?:\.[0-9]+){1,3})''')
  if (-not $installerVersionMatch.Success) { throw 'install.ps1 未声明 InstallerVersion' }
  $installedVersionVariable = Get-Variable -Name BJTUCACommandVersion -ErrorAction SilentlyContinue
  $installedVersion = if ($installedVersionVariable) { [version]$installedVersionVariable.Value } else { [version]'0.0.0' }
  $installerVersion = [version]$installerVersionMatch.Groups[1].Value
  if ($installerVersion -gt $installedVersion) {
    Write-Host "命令入口版本 $installedVersion，安装脚本版本 $installerVersion，正在自动更新…"
    & $installerPath -SkipStart
  }
}
$previousRunCommand = $env:BJTUCA_RUN_COMMAND
$previousRawArguments = $env:BJTUCA_RAW_ARGUMENTS
try {
  $env:BJTUCA_RUN_COMMAND = $singleCommandText
  if ($action -eq 'chatroom') {
    # Do not inherit a stale single-command request from a parent CMD launcher.
    $env:BJTUCA_RAW_ARGUMENTS = $null
    & node (Join-Path $bridgeRoot 'src\server.js') --chatroom @startArguments
  } elseif ($singleCommandText) {
    & npm --silent --prefix $bridgeRoot start -- @startArguments
  } elseif ($startArguments.Count) {
    & npm --silent --prefix $bridgeRoot start -- @startArguments
  } else {
    & npm --silent --prefix $bridgeRoot start
  }
} finally {
  $env:BJTUCA_RUN_COMMAND = $previousRunCommand
  $env:BJTUCA_RAW_ARGUMENTS = $previousRawArguments
}
exit $LASTEXITCODE
