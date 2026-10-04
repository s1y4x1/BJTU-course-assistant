param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BridgeArguments)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$commandDirectory = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'
$displayCommand = if ($env:BJTUCA_COMMAND_NAME) {
  $env:BJTUCA_COMMAND_NAME
} elseif ($MyInvocation.ScriptName) {
  [System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.ScriptName)
} else { 'BJTUCA' }
if ($BridgeArguments.Count -eq 1 -and $BridgeArguments[0] -eq '') { $BridgeArguments = @() }
$action = if ($BridgeArguments.Count) { $BridgeArguments[0] } else { 'start' }
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
      $displayCommand --show-token
      $displayCommand uninstall
      $displayCommand unregister
      $displayCommand u -r
      $displayCommand --help

bjtuca-bridge 和 BJTUCA 支持相同参数。

start          启动本地 Bridge（默认操作，端口读取 bridge.json，初始为 1896）
--port=N       本次启动使用端口 N（1 至 65535），并写回 bridge.json
--show-token   显示 bridge.json 中的 Bearer Token，不启动服务
uninstall      删除注册的命令并从用户 PATH 移除命令目录，且删除 Bridge 本身及配置（简写 u/uninst/unist）
unregister     仅取消命令注册并移除用户 PATH 项；保留 Bridge 本身及配置（简写 unreg，或 uninstall 及其简写加 -r）
"@
    return
  }
  { $_ -in @('uninstall', 'unregister', 'unreg') } {
    $actualBridgeDirectory = [System.IO.Path]::GetFullPath($bridgeRoot)
    if ($action -eq 'uninstall') {
      $bridgeModulePath = Join-Path $actualBridgeDirectory 'module.json'
      if ((Split-Path -Leaf $actualBridgeDirectory) -ine 'local-bridge' -or
          -not (Test-Path -LiteralPath $bridgeModulePath -PathType Leaf) -or
          (Get-Content -LiteralPath $bridgeModulePath -Raw | ConvertFrom-Json).id -ne 'local-bridge') {
        throw 'Bridge 目录校验失败，未执行卸载'
      }
    }
    $expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'))
    $actualDirectory = [System.IO.Path]::GetFullPath($commandDirectory)
    if ($actualDirectory -ine $expectedDirectory) { throw '命令目录校验失败' }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $remaining = @($userPath -split ';' | Where-Object {
      $_.Trim() -and ([System.IO.Path]::GetFullPath($_.Trim()).TrimEnd('\') -ine $actualDirectory.TrimEnd('\'))
    })
    [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
    foreach ($commandName in @('bjtuca-bridge', 'BJTUCA')) {
      foreach ($extension in @('.cmd', '.ps1')) {
        $target = Join-Path $actualDirectory ($commandName + $extension)
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
      }
    }
    if ((Test-Path -LiteralPath $actualDirectory -PathType Container) -and -not (Get-ChildItem -LiteralPath $actualDirectory -Force | Select-Object -First 1)) {
      Remove-Item -LiteralPath $actualDirectory
    }
    if ($action -eq 'uninstall') {
      Set-Location -LiteralPath (Split-Path -Parent $actualBridgeDirectory)
      Remove-Item -LiteralPath $actualBridgeDirectory -Recurse -Force
      Write-Output 'bjtuca-bridge 和 BJTUCA 命令、用户 PATH 项及 Bridge 目录（含配置和依赖）已删除。'
    } else {
      Write-Output 'bjtuca-bridge 和 BJTUCA 命令已取消注册；Bridge 文件和 bridge.json 已保留。'
    }
    return
  }
  'start' {
    $startArguments = if ($BridgeArguments.Count -gt 1) {
      @($BridgeArguments[1..($BridgeArguments.Count - 1)])
    } else { @() }
  }
  default { $startArguments = @($BridgeArguments) }
}

foreach ($argument in $startArguments) {
  if ($argument -notmatch '^--port=([0-9]+)$' -and $argument -ne '--show-token') {
    throw "不支持的参数：$argument。运行 $displayCommand --help 查看用法。"
  }
  if ($argument -match '^--port=([0-9]+)$' -and ([int64]$Matches[1] -lt 1 -or [int64]$Matches[1] -gt 65535)) {
    throw '端口必须是 1 至 65535 的整数'
  }
}
if ($startArguments -contains '--show-token' -and $startArguments.Count -ne 1) {
  throw '--show-token 不能与其他参数一起使用'
}
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
if ($startArguments.Count) {
  & npm --prefix $bridgeRoot start -- @startArguments
} else {
  & npm --prefix $bridgeRoot start
}
exit $LASTEXITCODE
