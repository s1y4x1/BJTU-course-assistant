param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BridgeArguments)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$commandDirectory = Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'
$action = if ($BridgeArguments.Count) { $BridgeArguments[0] } else { 'start' }

switch ($action) {
  { $_ -in @('help', '--help', '-h', '-?', '/?') } {
    Write-Output @'
用法：bjtuca-bridge [start] [--port=端口]
      bjtuca-bridge --show-token
      bjtuca-bridge uninstall
      bjtuca-bridge --help

start          启动本地 Bridge（默认操作，端口读取 bridge.json，初始为 1896）
--port=N       本次启动使用端口 N（1 至 65535），并写回 bridge.json
--show-token   显示 bridge.json 中的 Bearer Token，不启动服务
uninstall      删除注册的命令并从用户 PATH 移除命令目录；保留 Bridge 本身及配置
'@
    return
  }
  'uninstall' {
    $expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BJTUCourseAssistant\bin'))
    $actualDirectory = [System.IO.Path]::GetFullPath($commandDirectory)
    if ($actualDirectory -ine $expectedDirectory) { throw '命令目录校验失败' }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $remaining = @($userPath -split ';' | Where-Object {
      $_.Trim() -and ([System.IO.Path]::GetFullPath($_.Trim()).TrimEnd('\') -ine $actualDirectory.TrimEnd('\'))
    })
    [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
    foreach ($extension in @('.cmd', '.ps1')) {
      $target = Join-Path $actualDirectory ('bjtuca-bridge' + $extension)
      if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    if ((Test-Path -LiteralPath $actualDirectory -PathType Container) -and -not (Get-ChildItem -LiteralPath $actualDirectory -Force | Select-Object -First 1)) {
      Remove-Item -LiteralPath $actualDirectory
    }
    Write-Output 'bjtuca-bridge 命令已卸载；Bridge 文件和 bridge.json 已保留。'
    return
  }
  'start' { $startArguments = @($BridgeArguments | Select-Object -Skip 1) }
  default { $startArguments = @($BridgeArguments) }
}

foreach ($argument in $startArguments) {
  if ($argument -notmatch '^--port=([0-9]+)$' -and $argument -ne '--show-token') {
    throw "不支持的参数：$argument。运行 bjtuca-bridge --help 查看用法。"
  }
  if ($argument -match '^--port=([0-9]+)$' -and ([int64]$Matches[1] -lt 1 -or [int64]$Matches[1] -gt 65535)) {
    throw '端口必须是 1 至 65535 的整数'
  }
}
if ($startArguments -contains '--show-token' -and $startArguments.Count -ne 1) {
  throw '--show-token 不能与其他参数一起使用'
}
& npm --prefix $bridgeRoot start -- @startArguments
exit $LASTEXITCODE
