# 本地 Bridge 安装与使用说明

本地 Bridge 将浏览器扩展已有的 `BJTUCA` 操作提供给 Codex、其他 MCP 客户端和普通本地程序。默认只监听 `127.0.0.1`，默认端口为 `1896`。操作注册表由「通义千问」模块提供，因此使用 Bridge 调用操作前必须先安装该模块。

## 安装与启动

需要 Node.js 20 或更高版本。尚未安装时，请前往 [Node.js 官方下载页面](https://nodejs.org/zh-cn/download)。

在扩展目录的 `modules/local-bridge` 文件夹中运行：

```powershell
.\install.ps1
```

安装脚本会直接在当前 `modules/local-bridge` 目录安装依赖并立即执行 `npm start`，不再复制 Bridge。当前 PowerShell 窗口会继续承载 Bridge；按 `Ctrl+C` 可停止。

首次启动时，Bridge 会在当前目录创建 `bridge.json`。扩展会自动读取该文件中的端口、局域网设置与 Bearer Token，并持续检测 Bridge 连接；连接成功后才可开启“允许本地程序调用扩展操作”。

Bridge 已连接时，修改监听端口会同时写入 Bridge 配置并切换端口。也可以手动指定端口：

```powershell
npm start -- --port=1896
```

无需先切换目录也可以从任意位置启动：

```powershell
npm --prefix "扩展目录\modules\local-bridge" start
```

运行 `install.ps1` 后还会注册用户级命令。重新打开终端后，可在任意目录直接运行：

```powershell
bjtuca-bridge
```

可运行 `bjtuca-bridge --help` 查看全部参数：`start`（默认）、`--port=1000`（端口）、`--show-token`（显示 Token）、`uninstall`（卸载注册命令）。卸载只删除命令入口和用户 PATH 项，保留 Bridge 文件、依赖和 `bridge.json`。仅手动删除 `%LOCALAPPDATA%\BJTUCourseAssistant\bin` 会遗留 PATH 项。

Bridge 配置保存在当前 `modules/local-bridge/bridge.json`。

浏览器扩展连接成功后，Bridge 会在启动窗口显示紫红色的 `BJTUCA>` 提示符（不支持颜色的终端显示普通文本）。可直接输入操作名，或在后面附上单行 JSON 对象参数：

```text
ve.courseList
ve.assignments {"status":"pending"}
ve.courseList({})
```

本地文件上传可传 `{"filePath":"C:\\path\\file.pdf"}`。命令行只解析操作名和 JSON，不执行任意 JavaScript；调用仍受浏览器扩展的操作启用与批准规则约束。通过命令行、HTTP 或 MCP 发起的操作会在 Bridge 窗口直接打印完整返回结果，不另加操作名或结果标题。输入 `help` 查看示例；输入 `help ve.courseList ykt.assignments` 或 `help(ve.courseList)` 查看指定操作说明；输入 `exit` 或按 `Ctrl+C` 停止 Bridge。

如需从同一局域网内的其他设备访问，可在扩展选项中开启“允许局域网访问”，然后将下文地址中的 `127.0.0.1` 替换为运行 Bridge 的电脑的局域网 IP。开启后 Bridge 会监听所有网络接口；除操作列表外，调用仍需携带 `bridge.json` 中的 Bearer Token。系统防火墙可能会要求您允许 Node.js 接受专用网络连接。

## 连接 Codex

连接完成后，将下面的 TOML 加入 `~/.codex/config.toml`：

```toml
[mcp_servers.bjtu_course_assistant]
url = "http://127.0.0.1:{{BJTU_CA_BRIDGE_PORT}}/mcp"
bearer_token_env_var = "BJTU_CA_BRIDGE_TOKEN"
```

再选择一种命令，将当前 `bridge.json` 中的 Token 写入用户环境变量。

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

`GET /api/v1/operation-list` 可直接访问，不需要 token。其余接口需要 `bridge.json` 中的 Bearer token：

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

`arguments` 必须是 JSON 对象；无参数操作可省略该字段或传 `{}`。操作是否启用、是否始终允许及需要浏览器交互的确认，均由扩展决定。Bridge 不提供任意 JavaScript 执行接口。
