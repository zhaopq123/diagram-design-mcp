# workbuddy-diagram-design

把架构图、流程图、时序图、状态机、象限图等 **45 类图表**画成自足单文件 HTML+SVG 的编辑级设计系统，以 **MCP 服务**的形式提供。

一个 7 工具的 MCP 服务器：查设计规范、搭合规骨架、跑机械自检、从既有图提取结构、合成图库页。

## 为什么是 MCP

原本这套东西是 DeepSeek Harness 插件（[`dsh-diagram-design`](https://github.com/cathrynlavery/diagram-design)）。插件只能在一个宿主里用；MCP 协议让同一套能力对任何支持 MCP 的客户端开放——WorkBuddy、Claude Code、Cursor、自己写的 agent 都行。

## 设计约束

### 内容进、内容出

服务端**不读写调用方的文件系统**。每个工具接收文档文本，返回文本。文件由宿主读、由宿主写。

这不是偷懒，是刻意的：服务因此可以跑在任何地方（本包实际部署在一台安卓手机的 Termux 里），路径穿越风险归零，多客户端共享一个实例也不会互相踩文件。

### 扁平 schema

严格上游模型会**因为工具定义里有 `outputSchema` / `anyOf` / `oneOf` 就直接拒掉整个请求**，工具静默不可用——报错码还长得像"参数不合法"，能查一整天。

所以这里的 schema 全部手写、扁平，只用 `type` / `properties` / `required` / `enum` / `items`。可选参数就是"不在 `required` 里"，绝不用联合类型表达。`test/tools.test.mjs` 断言了这个约束，防止以后有人顺手改坏。

## 工具

| 工具 | 干什么 |
|---|---|
| `diagram_tokens` | 取权威设计数值：语义角色（明/暗）、节点处理、排版、描边/圆角/网格、复杂度预算、六条连线铁律、反模式 |
| `diagram_sizes` | 取尺寸预设（viewBox 与字号绑定）、排版阶梯、安全区、四个输出旋钮、降级顺序、宿主 CSS 契约 |
| `diagram_types` | 查 45 类目录：选型指南、语义模式路由、每类的布局约定/预算/反模式。支持中文关键词（「时序」「象限」） |
| `diagram_scaffold` | 生成**落地即合规**的骨架 HTML（无障碍契约、箭头标记、宿主 CSS、图例条、4px 网格都放好了） |
| `diagram_check` | 机械自检。报告分 `findings`（机械判定，error 必须修）/ `judgement`（编辑判断，是你的责任）/ `limits`（查不出什么） |
| `diagram_import` | 从 Mermaid / draw.io / Excalidraw **提取结构**（不渲染） |
| `diagram_gallery` | 把多张图合成自足图库页，内嵌 `iframe sandbox="" srcdoc` 隔离预览 + 自检结论 |

## 跑起来

```bash
npm install

# 必须设置 token —— 没设会拒绝启动，不会裸奔
export DIAGRAM_MCP_TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
export DIAGRAM_MCP_PORT=8400        # 默认 8400
export DIAGRAM_MCP_BIND=0.0.0.0     # 默认 0.0.0.0

npm start
```

或者用 `deploy/run.sh`（从同目录的 `config.env` 读配置，前台 `exec`——supervisor 负责重启）。

### 会话寿命

客户端**很少主动断开**：MCP SDK 自己的 `client.close()` 都不发 `DELETE`（实测确认，只有显式 `terminateSession()` 才发），进程被杀或掉网的客户端更发不出来。所以会话不能只靠 `DELETE` 回收——一台跑几周的机器上这就是无界泄漏（一次审计把会话数从 11 顶到 63，一个都没回收）。

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `DIAGRAM_MCP_IDLE_MS` | `1800000`（30 分钟） | 空闲多久回收。任何流量都续命，只有彻底静默才过期 |
| `DIAGRAM_MCP_MAX_SESSIONS` | `256` | 硬上限，到顶淘汰最久未用的，防止一波连接打爆内存 |

两者都会在 `/health` 里回显（`idleMs` / `maxSessions`），方便核对部署配置有没有真的生效。

> `run.sh` 用 `set -a` 导出整个 `config.env`。**不要改回裸 `. config.env`**——那样只设 shell 变量，子进程收不到，`config.env` 里写的旋钮会静默失效而 `/health` 报默认值（踩过，`diagram-mcp-ctl status` 现在有漂移检测专门抓这个）。

### 接入客户端

```json
{
  "mcpServers": {
    "diagram-design": {
      "type": "streamableHttp",
      "url": "http://<host>:8400/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

`/health` 免鉴权，`/mcp` 需要 Bearer。

### 接入 WorkBuddy

配置文件放 `mcp.json`（Windows 上是 `%USERPROFILE%\.workbuddy-ai\mcp.json`；同目录还有一份 `.workbuddy\mcp.json`，实际生效的是 `.workbuddy-ai` 那份——旁边的 `mcp-approvals.json`、`mcp-tool-list.json` 都在那儿）。

**用户自行添加的 MCP Server 默认不可信。** 首次接入要在 UI 里显式确认一次：

> **设置 → 安全中心 → 工具控制 → 自定义 MCP**（"统一控制用户自行添加的 MCP Server"）

那个页面会把 `mcp.json` 里的条目列出来，未确认的显示为不可信，点确认后写入 `mcp-approvals.json`。

两个容易踩的点：

- **配置不热重载。** 改完 `mcp.json` 要么重开应用，要么打开上面那个页面触发一次刷新（对应 `mcpRefresh` 通道）。直接改文件然后等，是等不到的。
- **信任键绑的是 URL 的 origin，不是完整 URL。** 上游实现是 `sha256(new URL(url).origin)`，再拼服务名——即 `diagram-design::sha256("http://<host>:8400")`。所以 `/mcp` 路径改了不影响，**端口或主机改了要重新确认一次**。

```js
// 信任键的推导（摘自应用实现）
function hashInput(cfg) { return cfg.kind === 'stdio' ? [...] : new URL(cfg.url).origin }
const key = `${name}::${sha256(hashInput(cfg))}`
```

## 测试

```bash
npm test        # 单元：核心模块 + 工具契约 + HTTP 端到端 + 会话生命周期 + CLI 契约
```

`test/cli-contract.test.mjs` 守两件事：三个远端脚本**缺 `DIAGRAM_MCP_URL` 必须 exit 2 并点名该变量**（不能把"忘配地址"伪装成网络错误），以及**仓库里不许出现内网地址**。它靠 `spawnSync` 拉起子进程——在禁 spawn 的沙箱里会显式 skip 并说明原因，不会假通过。

对**已部署实例**跑端到端冒烟（真实 MCP 客户端、握手、鉴权、7 工具全打一遍、并发会话）：

```bash
DIAGRAM_MCP_URL=http://<host>:8400/mcp \
DIAGRAM_MCP_TOKEN=<token> \
node scripts/smoke-remote.mjs
```

> **两个变量都是必须的，没有默认值。** 这三个脚本打的是*部署实例*，一个指向 `localhost` 的假默认值只会把"你忘了配地址"变成一句看不懂的 `ECONNREFUSED`。
> 若本机设了 `HTTP_PROXY`，局域网地址会被代理拦掉（404）。用
> `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy` 跑。

全量边界审计（异常 HTTP 请求、鉴权变体、极端入参、45 类 × 10 尺寸档 × 2 皮肤、恶意内容穿透、会话回收、并发压力）：

```bash
DIAGRAM_MCP_URL=http://<host>:8400/mcp \
DIAGRAM_MCP_TOKEN=<token> \
DIAGRAM_MCP_EXPECT_MAX_SESSIONS=128 \
DIAGRAM_MCP_EXPECT_IDLE_MS=1800000 \
node scripts/audit.mjs
```

审计自己不留尾巴：它会故意造 15 个孤儿会话来验证回收与上限，但**在断言成立后立刻清掉**，并在结束时要求会话数回到基线。跑完就干净，不用等空闲窗口过去。

`DIAGRAM_MCP_EXPECT_*` 是可选的，但**部署后一定要带上**：不带的话只验"`/health` 有这个字段"，带了才验"值等于你配的"。少了这一层，配置漂移（变量名拼错、启动脚本漏导出）能一路绿灯放行。

重建 `examples/` 里的示例图与图库页（同样打的是真实服务，任何一张有 error 就以非零码退出）：

```bash
DIAGRAM_MCP_URL=http://<host>:8400/mcp \
DIAGRAM_MCP_TOKEN=<token> \
node scripts/build-examples.mjs
```

## 示例

`examples/` 下是两张真图，都是走"选型 → 定尺寸 → 取令牌 → 搭骨架 → 自检"产出的，机械自检 0 error：

- `request-path.html` —— 一次请求的链路（architecture）
- `workflow.html` —— 画一张图的标准顺序（flowchart）
- `gallery.html` —— 图库页，两张图的沙箱预览 + 各自的自检结论

打开 `examples/gallery.html` 就能看。

## 部署到安卓手机（Termux）

`deploy/termux/` 下是两个运维脚本，与常见的 Termux 服务约定一致（tmux 会话 + while 循环 + 端口幂等检测）：

- `diagram-mcp-guard` —— 幂等启动，已跑则跳过；接进 `ubuntu-autostart` 即可开机自启。
- `diagram-mcp-ctl` —— `status` / `restart` / `stop` / `logs` / `token`。

`status` 除了端口、健康、日志，还会做两件事：

1. **配置漂移检测** —— 把 `config.env` 里的 `DIAGRAM_MCP_*` 与运行进程的真实环境逐条比对。
2. **配置 ↔ `/health` 闭环** —— 确认代码真的读了那些变量（防变量名拼错：环境对了但 `/health` 还是默认值）。

这两道是补出来的。原先 `config.env` 里写了 `DIAGRAM_MCP_IDLE_MS` / `DIAGRAM_MCP_MAX_SESSIONS`，`run.sh` 却没导出它们，`/health` 一直报默认值——而当时所有测试都是绿的，因为断言只验"字段存在且为正数"。现在这种"运维配了、进程没收到"的情况会被直接点名。

这个服务是纯 Node + 一个依赖，**直接跑在 Termux 层**即可，不必进 proot——进 proot 只会多一层 `--kill-on-exit` 的坑（容器一退，守护全死）。

## 目录

```
src/
  server.mjs        Streamable HTTP + 会话生命周期 + Bearer 鉴权
  tools.js          7 个工具：纯数据 + 纯 handler
  core/
    tokens.js       设计令牌（语义角色、排版、网格、预算、连线铁律）
    sizes.js        尺寸预设、排版阶梯、安全区、旋钮、降级顺序
    check.js        品味关卡：机械可判定部分
    scaffold.js     合规骨架生成器
    import.js       Mermaid / draw.io / Excalidraw 解析器
    catalog.json    45 类图表目录
test/               43 项（含 CLI 契约，2 项在禁 spawn 的环境下 skip）
scripts/            smoke-remote.mjs（60 项端到端）· audit.mjs（67 项边界审计）· build-examples.mjs
examples/           两张真图 + 图库页
deploy/             run.sh + Termux 守护脚本
skill/              WorkBuddy Skill 入口
```

## 已知边界

- 服务端无文件系统访问，所以 `diagram_check` 要传 HTML 全文而不是路径——图很大的时候 token 开销实打实。
- 机械自检只查能机械判定的部分。**"通过"不等于"图很好"**，编辑判断仍然是人（或模型）的责任。工具会明确列出自己覆盖不到什么。
- 中文标签需要自己扩展字族：Geist 无汉字覆盖。字号下限 12px，装不下就砍名字，不要缩字号。

## 许可与来源

MIT。派生链：`cathrynlavery/diagram-design` → `dsh-diagram-design` → 本包。详见 [NOTICE.md](./NOTICE.md)。
