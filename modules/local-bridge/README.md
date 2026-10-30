# 本地 Bridge 安装与使用说明

本地 Bridge 将浏览器扩展已有的 `BJTUCA` 操作提供给 Codex、其他 MCP 客户端和普通本地程序。默认只监听 `127.0.0.1`，默认端口为 `1896`。操作注册表、文档、执行桥及操作权限由「扩展接口」（api）模块提供；它是 Bridge 的必要前置模块，无需安装「通义千问」。

## 安装与启动

需要 Node.js 20 或更高版本。尚未安装时，请前往 [Node.js 官方下载页面](https://nodejs.org/zh-cn/download)。

在扩展目录的 `modules/local-bridge` 文件夹中运行：

```powershell
.\install.ps1
```

安装脚本会直接在当前 `modules/local-bridge` 目录安装依赖并立即执行 `npm start`，不再复制 Bridge。当前 PowerShell 窗口会继续承载 Bridge；空闲时按 `Ctrl+C` 可停止。

首次启动时，Bridge 会在当前目录创建 `bridge.json`。扩展会自动读取该文件中的端口、局域网设置与 Bearer Token，并持续检测 Bridge 连接；连接成功后才可开启「允许本地程序调用扩展操作」。

### 从浏览器启动 Bridge

安装脚本会为当前 Windows 用户注册 `bjtuca://` 协议，无需管理员权限。扩展页面可提供由用户点击的链接 `<a href="bjtuca://start">启动本机 Bridge</a>`；浏览器可能询问是否打开外部应用。也可在 PowerShell 中运行：

```powershell
Start-Process 'bjtuca://start'
```

协议入口位于 `%LOCALAPPDATA%\BJTUCourseAssistant\protocol.ps1`，按本机 `bridge.json` 中的端口检查 `/health`。Bridge 已运行时直接返回，否则启动已注册的 `BJTUCA.ps1 start`；重复唤起不会重复启动。此协议只启动本机 Bridge，不改变扩展的连接目标，也不传递 Token、命令或 JavaScript。启动后，扩展仍通过原有 WebSocket 连接，并按现有规则批准和执行操作。

`bjtuca unreg`、`bjtuca uninstall` 及其别名也会移除协议注册；扩展目录已被删除时仍可取消注册。

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

也可使用 `BJTUCA`，两者支持相同参数，例如 `BJTUCA --help`、`BJTUCA --port=1000`。执行任一命令的 `uninstall` 都会移除两个命令入口。

启动时会比较已注册命令入口的版本与 `install.ps1` 中的 `InstallerVersion`。安装脚本版本更高时，自动重新执行安装并按原参数启动 Bridge；帮助、版本查询、卸载和查看 Token 不触发安装。修改安装脚本后需提高 `InstallerVersion` 才会触发已安装入口的自动更新。

可运行 `bjtuca-bridge --help` 查看全部参数：`start`（默认）、`--port=1000`（端口）、`--show-token`（显示 Token）、`uninstall`（完全卸载，简写 `u`、`uninst` 或 `unist`）、`unregister`（仅取消命令注册，简写 `unreg`）。

命令入口直接保存在 `%LOCALAPPDATA%\BJTUCourseAssistant`，不再使用 `bin` 子目录。`BJTUCA -v` 或 `BJTUCA --version` 可查看命令入口版本，不启动 Bridge。

`BJTUCA uninstall` 及其简写删除整个命令入口目录、用户 PATH 项以及整个 `modules/local-bridge/` 目录，包括 Bridge 本身、依赖和 `bridge.json`。`BJTUCA unregister`、`BJTUCA unreg`、`BJTUCA u -r`、`BJTUCA uninst -r`、`BJTUCA unist -r` 和 `BJTUCA uninstall -r` 也会删除整个命令入口目录和用户 PATH 项，但保留 Bridge 文件及配置。扩展目录已经删除时，仍可解除命令注册。仅手动删除 `%LOCALAPPDATA%\BJTUCourseAssistant` 会遗留 PATH 项。旧版升级会清理原 `bin` 目录及其 PATH 项，完成后请重新打开终端。

Bridge 配置保存在当前 `modules/local-bridge/bridge.json`。

使用 `-c` 可以执行一条与终端中相同语法的命令，输出结果后退出：

```powershell
BJTUCA -c "ve.courseList"
BJTUCA -c "api.operationList"
BJTUCA -c "help ve.login ykt.assignments"
BJTUCA -c 'api.getDocs {"module":"ve","name":"login"}'
```

在 cmd 中也可以直接使用双引号参数；命令入口会保留原始文本，避免经 PowerShell 转发时丢失引号而被误当作 JavaScript：

```cmd
BJTUCA -c api.getDocs({name:"courseList"})
```

注册生成的 PowerShell 命令与协议入口使用带 BOM 的 UTF-8 编码，同时支持 Windows PowerShell 5 和 PowerShell 7 的中文输出及中文路径；仓库中的 PowerShell 模板仍使用 ANSI 编码。

若 Bridge 已在运行，会直接通过它执行，不会关闭该 Bridge。否则临时启动服务，等待扩展连接后执行，结束时关闭临时服务。端口参数放在 `-c` 之前，例如 `BJTUCA --port=1000 -c "ve.courseList"`。成功时退出码为 0，执行出错时为 1。

浏览器扩展连接成功后，Bridge 会在启动窗口显示紫红色的 `BJTUCA>` 提示符（不支持颜色的终端显示普通文本）。可直接输入操作名，或附上对象参数。键名无需引号，外层 `{}` 可省略；字符串支持单引号或双引号，多项参数以逗号分隔：

```text
ve.courseList
ve.assignments {"status":"pending"}
api.getDocs {module:'ve', name:'courseList'}
api.getDocs module:'ve', name:'courseList'
api.getDocs(module:'ve', name:'courseList')
ve.courseList({})
```

本地文件上传可传 `filePath:'C:\\path\\file.pdf'`。命令行使用 JSON5 解析参数，不执行任意 JavaScript；调用仍受浏览器扩展的操作启用与批准规则约束。HTTP/MCP 请求仍使用标准 JSON 对象。通过命令行、HTTP 或 MCP 发起的操作会在 Bridge 窗口直接打印完整返回结果，不另加操作名或结果标题。输入 `help` 查看示例；输入 `help ve.courseList ykt.assignments` 或 `help(ve.courseList)` 查看指定操作说明；输入 `exit`、`quit` 或在空闲时按 `Ctrl+C` 停止 Bridge。

命令等待用户授权时，按 `Ctrl+C` 可立即取消当前命令并撤销对应授权提示，随后继续输入其他命令。`bjtuca -c "操作"` 也支持取消；连接到已有 Bridge 时不会停止该 Bridge。

操作参数按各操作的说明传入，不限于对象。例如 `reminder.enabled(true)` 开启提醒、`reminder.enabled(false)` 关闭提醒，`reminder.add([15,30])` 添加多个提醒节点；HTTP/MCP 调用时将对应值放入 `arguments` 字段即可。

如需从同一局域网内的其他设备访问本机 Bridge，可在「本机 Bridge」中开启「允许局域网设备连接本机 Bridge」，然后将下文地址中的 `127.0.0.1` 替换为运行 Bridge 的电脑的局域网 IP。开启后本机 Bridge 会监听所有网络接口；除操作列表外，调用仍需携带其 `bridge.json` 中的 Bearer Token。系统防火墙可能会要求您允许 Node.js 接受专用网络连接。

### 连接另一台电脑上的扩展

在程序所在电脑运行 Bridge，并允许该 Bridge 被局域网设备访问（在那台电脑的扩展选项中设置，或把其 `bridge.json` 的 `allowLan` 设为 `true`）。在另一台电脑的「扩展连接目标」中，将「Bridge 地址」填为前者的局域网 IP，「连接端口」填为前者的监听端口；输入满前者 Bridge 终端显示的 6 位数字配对码后自动配对。这台电脑不必开启本机 Bridge 的局域网访问。程序调用该 Bridge 时，操作将在已配对的那台电脑的浏览器扩展中执行。

配对码 5 分钟内有效、只能使用一次；在 Bridge 终端输入 `pair` 可生成新码。每个来源 IP 每分钟最多尝试 5 次。配对后 token 自动保存，无需手动输入长串 token；HTTP/MCP 调用仍须 Bearer Token。连接仅用于可信局域网，当前 HTTP/WebSocket 不提供传输加密。

一个 Bridge 同时只控制一个扩展。新配对/连接替换旧连接时，旧扩展暂停自动重连，避免两台电脑循环抢占；如需接回，在旧扩展重新配对即可。

本机 Bridge 的 `port`、`allowLan`、`token` 保存在 `modules/local-bridge/bridge.json`；扩展连接目标的地址、端口及远程配对 token 仅保存在扩展存储中，不写入该文件。配对不会覆盖本机授权。地址为 `127.0.0.1` 时使用本机 token，连接端口自动跟随本机监听端口。更改连接目标或远程连接端口不需要目录写入权限，也不会修改远程 Bridge 的服务配置；远程服务须在所在电脑配置。更改本机 Bridge 的配置仍需要在「更新」模块中授权扩展目录。

认证失败后保留 token，按所选「重试间隔」等待后重连，不再每次查询状态都读取配置或重建连接。重连时配置文件读取间隔至少 10 秒；普通网络断连也按所选重试间隔处理。Bridge 发送「知行」，扩展回复「合一」。

## 独立聊天室 LAN 信令服务器

在 `modules/local-bridge` 目录执行（无需连接浏览器扩展）：

```powershell
node src/server.js --chatroom
node src/server.js chatroom --port=1898
```

命令入口也可将 `bjtuca chatroom [--port=N]` 转交至上述服务。默认监听 `0.0.0.0:1897` 的 WebSocket `/chatroom`，与常规 Bridge 的 `1896` 完全独立，可同时运行；不读取或修改 `bridge.json`、不生成配对码、不开放 MCP/扩展操作接口。将聊天室在线发现地址设为 `ws://运行服务的电脑的LANIP:1897/chatroom`（客户端须支持 LAN `ws:`），并允许防火墙的专用网络入站连接。客户端按 LocalSend 格式在 URL 的 `d` 参数提交 base64url 编码的设备信息。

服务仅处理 HELLO/JOIN/LEFT、UPDATE 发现信息和 OFFER/ANSWER SDP 信令，不转发聊天或文件内容；设备 ID 由服务器分配，转发身份由服务器填入，ANSWER 必须匹配原 OFFER 的双方及会话。目录信息和 token 不代表已验证身份，签名鉴权仍由 `link.js` 在端到端连接上完成。明文 `ws:` 仅适用于可信局域网，不应直接暴露到公网。

默认上限：128 个 TCP/WS 连接、每 IP 16 个连接、每 IP 每分钟 60 次升级请求、每连接每 10 秒 40 条消息（含空保活）、单条 256 KiB、发送队列 1 MiB；未完成会话最多 512 个且每设备最多 16 个，5 分钟过期。每 30 秒检测连接存活并清理离线设备。端口占用会提示换用 `--port=N`；按 `Ctrl+C` 关闭服务并清理连接。

只读 `GET /health` 返回 `{ "ok": true, "service": "bjtuca-chatroom", "port": 1897 }`（端口为实际监听值），供命令/协议入口识别现有服务、避免重复启动；此端点不依赖扩展连接。

测试可直接导入 `src/chatroom-server.js` 的 `startChatroomServer({ port: 0, host: '127.0.0.1', limits: {} })`，返回 `{ server, wss, port, host, close }`；`close()` 可重复调用，不注册进程信号处理器。另导出 `parseChatroomPort`、`runChatroomServer`、`DEFAULT_CHATROOM_PORT` 和 `CHATROOM_LIMITS`。

## 连接 Codex

连接完成后，将下面的 TOML 加入 `~/.codex/config.toml`：

```toml
[mcp_servers.bjtu_course_assistant]
url = "http://{{BJTU_CA_BRIDGE_HOST}}:{{BJTU_CA_BRIDGE_PORT}}/mcp"
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
