# 本地 Bridge 安装与使用说明

本地 Bridge 将浏览器扩展已有的 `BJTUCA` 操作提供给 Codex、其他 MCP 客户端和普通本地程序。它只监听 `127.0.0.1`，默认端口为 `1896`。

## 安装与启动

需要 Node.js 20 或更高版本。尚未安装时，请前往 [Node.js 官方下载页面](https://nodejs.org/zh-cn/download)。

在扩展目录的 `modules/local-bridge` 文件夹中运行：

```powershell
.\install.ps1
```

安装脚本会直接在当前 `modules/local-bridge` 目录安装依赖并立即执行 `npm start`，不再复制 Bridge。当前 PowerShell 窗口会继续承载 Bridge；按 `Ctrl+C` 可停止。

控制台会显示六位配对码。在扩展选项中启用“允许本地程序调用扩展操作”，输入配对码并点击“配对”。

Bridge 已连接时，修改监听端口会同时写入 Bridge 配置并切换端口。也可以手动指定端口：

```powershell
Set-Location "扩展目录\modules\local-bridge"
npm start -- --port=1896
```

Bridge 配置保存在当前 `modules/local-bridge/bridge.json`。

## 连接 Codex

配对完成后，将下面的 TOML 加入 `~/.codex/config.toml`：

```toml
[mcp_servers.bjtu_course_assistant]
url = "http://127.0.0.1:{{BJTU_CA_BRIDGE_PORT}}/mcp"
bearer_token_env_var = "BJTU_CA_BRIDGE_TOKEN"
```

再选择一种命令，将当前配对得到的 Token 写入用户环境变量。

CMD：

```cmd
setx BJTU_CA_BRIDGE_TOKEN "{{BJTU_CA_BRIDGE_TOKEN}}"
```

PowerShell：

```powershell
[Environment]::SetEnvironmentVariable('BJTU_CA_BRIDGE_TOKEN', '{{BJTU_CA_BRIDGE_TOKEN}}', 'User')
```

设置完成后，重新启动 Codex。

提供的 MCP 工具为 `BJTUCA_operation_list`、`BJTUCA_get_docs` 和 `BJTUCA_call`。

## 普通 HTTP API

`GET /api/v1/operation-list` 可直接访问，不需要 token。其余接口需要配对得到的 Bearer token：

```text
GET  /api/v1/operation-list
POST /api/v1/get-docs
POST /api/v1/call
```

PowerShell 调用示例：

```powershell
$headers = @{ Authorization = "Bearer $env:BJTU_CA_BRIDGE_TOKEN" }
$body = @{
  name = 've.assignments'
  arguments = @{ status = 'pending' }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:1896/api/v1/call' -Headers $headers -ContentType 'application/json' -Body $body
```

`/api/v1/call` 成功时直接返回操作的 `result`，不再套入包含 `ok`、`name` 和 `result` 的外层对象。操作是否启用、是否始终允许及需要浏览器交互的确认，均由扩展决定。Bridge 不提供任意 JavaScript 执行接口。
