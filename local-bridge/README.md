# BJTU Course Assistant Local Bridge

本地 Bridge 将浏览器扩展已有的 `BJTUCA` 操作提供给 Codex、其他 MCP 客户端和普通本地程序。它只监听 `127.0.0.1`，默认端口为 `1896`。

## 安装与启动

需要 Node.js 20 或更高版本。在本目录运行：

```powershell
.\install.ps1
Set-Location "$env:LOCALAPPDATA\BJTUCourseAssistant\bridge"
npm start
```

安装脚本会把 Bridge 复制到 `%LOCALAPPDATA%\BJTUCourseAssistant\bridge` 后安装依赖，避免 `node_modules` 进入扩展目录或被扩展更新清理。

控制台会显示六位配对码。打开扩展的“通义千问”选项，启用“允许本地程序调用扩展操作”，输入配对码并点击“配对”。

端口可以在扩展选项中修改。Bridge 已连接时，修改会同时写入 Bridge 配置并切换监听端口；Bridge 未运行时，可使用下面的命令令两端保持一致：

```powershell
Set-Location "$env:LOCALAPPDATA\BJTUCourseAssistant\bridge"
npm start -- --port=1896
```

Bridge 配置保存在：

```text
%LOCALAPPDATA%\BJTUCourseAssistant\bridge.json
```

## Codex

配对完成后，点击扩展选项中的“复制 Codex 配置”。复制内容的第一行会将 Token 写入当前用户的长期环境变量；执行后重新启动 Codex。将 TOML 部分加入 `~/.codex/config.toml`：

```toml
[mcp_servers.bjtu_course_assistant]
url = "http://127.0.0.1:1896/mcp"
bearer_token_env_var = "BJTU_CA_BRIDGE_TOKEN"
tool_timeout_sec = 86400
```

提供的 MCP 工具：

- `BJTUCA_operation_list`
- `BJTUCA_get_docs`
- `BJTUCA_call`

## 普通 HTTP API

所有接口都需要配对得到的 Bearer Token：

```http
GET  /api/v1/operation-list
POST /api/v1/get-docs
POST /api/v1/call
```

调用示例：

```powershell
$headers = @{ Authorization = "Bearer $env:BJTU_CA_BRIDGE_TOKEN" }
$body = @{
  name = 've.assignments'
  arguments = @{ status = 'pending' }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:1896/api/v1/call' -Headers $headers -ContentType 'application/json' -Body $body
```

操作是否启用、是否始终允许及需要浏览器交互的确认，均由扩展决定。Bridge 不提供任意 JavaScript 执行接口。
