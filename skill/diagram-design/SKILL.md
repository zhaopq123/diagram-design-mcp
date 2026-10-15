---
name: diagram-design
description: 画专业级图表（架构图、流程图、时序图、状态机、象限图、数据流图等 45 类），或改既有图、从 Mermaid/draw.io/Excalidraw 提取结构重画、把多张图合成图库页。产出的是自足单文件 HTML（含无障碍 SVG 契约），可打印、可分享。触发词：画图、画一张图、做张图、画个架构图、流程图、时序图、状态图、象限图、数据流、图表、示意图、diagram、architecture diagram、flowchart、sequence diagram、把这段 mermaid 画出来、这张图帮我改一下、图库、gallery、图太丑、图不规范、diagram design。
---

# 图表设计

用 `diagram_*` 系列 MCP 工具产出编辑级图表。核心是**别自己从零写 SVG**——骨架、设计令牌、机械自检都已经被工具机械化了，你负责的是判断：内容、层级、焦点、删减。

## 服务位置

远端 MCP 服务（手机常驻），工具名前缀 `diagram_`：`diagram_tokens` / `diagram_sizes` / `diagram_icons` / `diagram_types` / `diagram_scaffold` / `diagram_check` / `diagram_import` / `diagram_gallery`。

**内容进、内容出**：服务不碰你的文件系统。所有内容你传进去，成品 HTML 它还给你，落盘由你来做。

## 标准流程

1. **`diagram_types`** — 先选型。要展示"谁调用谁"用 architecture，展示"步骤顺序"用 flowchart，展示"消息往返"用 sequence，展示"两个维度权衡"用 quadrant。不确定就传 `query` 搜（支持中文：「时序」「象限」「架构」）。
2. **`diagram_sizes`** — 定四个旋钮：格式（doc-inline / presentation / print）、尺寸、细节层级、受众。**尺寸预设同时决定画布和字号，不要拆开看。** 装不下就拆图，不要缩字号。
3. **`diagram_tokens`** — 取权威数值。类型文档里写的是 `{ink}`、`{accent}` 这类**角色名**，具体十六进制值以这里为准。画之前必须取。
4. **`diagram_icons`** — 只在类型真要图标时才调（`it-state` / `dp-integration` / `high-level` 的 `icon` 字段）。不传参数拿索引（便宜），点名 `names` 才回 `<svg>` 标记；中文别名能直接搜（「数据库」「防火墙」）。图标用 `currentColor`，自动跟皮肤；**描边件与品牌剪影不要混在一张图里**，也别拿图标代替节点名字——能写清 host / service 就别贴个云厂商 logo。
5. **先说计划（省返工）** — 动手前用**一条短消息**说出：类型（＋语义模式）、尺寸预设、预算会逼你砍掉什么。用户能回话就让他先改；无人值守就把假设写进交付说明。请求已钉死类型/尺寸/内容时可跳过。
6. **`diagram_scaffold`** — 起手。产出的骨架已经通过机械自检，把第二个内容块**原样**写进 `.html` 文件，再把内容填进去。`size=fit` 时要一并传 `contentWidth` / `contentHeight`，否则 viewBox 推不出来，会静默回退成默认画框（返回值里会点名告知）。
7. **`diagram_check`** — 收尾。传 HTML 全文。`findings` 里的 error **必须修**；`judgement` 是你自己的编辑责任；`limits` 告诉你这个检查器查不出什么。
8. **向用户交代** — 说清楚画了什么、砍了什么、为什么这么取舍。别只说"已完成"。

改既有图 → 从第 3 步开始。从 Mermaid/draw.io/Excalidraw 迁移 → 先 `diagram_import` 提结构，**然后重画，不是转换**（源坐标、颜色、字体、形状怪癖全丢，只留内容）。Markdown 源只认**顶层** mermaid 围栏——被外层代码围栏包住的示例不算图；文件里有多个围栏块时用 `block` 参数选（默认第 0 个）。最后向用户交"保真度账本"：合并了什么、塌缩了什么、丢掉了什么。

## 硬规则（工具会替你查，但别指望它兜底）

- **4px 网格**：每个坐标、尺寸、间隙都能被 4 整除。
- **焦点色 `accent` 每图最多 1–2 处**。其余一律 `ink` / `muted` / `soft`。全图都在喊 = 没人在喊。
- **节点 ≤ 9、箭头 ≤ 12**（通用上限；部分类型有更紧的逐类型上限，见 `diagram_types` 的预算表）。超了就拆成"总览 + 细节"两张图。
- **连线画在节点之前**（线必须在盒子后面）。
- **箭头标签要压在遮罩上，且两边都带 class**：标签 `<text class="arrow-label">`，遮罩 `<rect class="label-mask">`。检查器按**几何**判定——标签的 x/y 必须真的落在某个遮罩矩形内，遮罩错位一样算不合格。少写 class 等于没有遮罩，直接判 error。`diagram_scaffold` 的 `elbow({label})` 已经把这对 class 配好了，手写时照抄。
- **结构色一律写 `var(--color-*)`，不要写死 hex**。皮肤（`light`/`dark`）就是靠 `:root` 里换这套变量实现的；写死 hex 的图换不动皮肤，暗色下会变成暗底暗字。可用的变量：`paper` `paper-2` `ink` `muted` `soft` `rule` `accent` `accent-tint` `link`。
- **对比度**：皮肤变量表的成对可读性由门禁保证（阈值与实测比率见 `diagram_tokens` 的对比度契约）；但把文字放到**非 paper 底**上（比如 0.85 透明度的 accent 填充）要自己按同一阈值复核。
- **`min-width` 必须等于 viewBox 宽度**，SVG 放在局部 `overflow-x: auto` 容器里。否则窄屏把整张图连同字号一起缩下去。
- **无障碍契约**：`<svg role="img" aria-labelledby="<slug>-title <slug>-desc">`，`<title>` 必须是 `<svg>` 的第一个子元素且带 id（不能是裸 `title`）。
- **单文件自足**：除字体样式表外不许有外链。
- **中文标签**：Geist 无汉字覆盖，要扩展自己的字族；**12px 是字号下限**，装不下就砍名字，不要缩字号。

## 图库

多张图 → `diagram_gallery`，产出一个自足图库页：每张图一张卡片，内嵌隔离沙箱预览（`iframe sandbox="" srcdoc`，不执行图内脚本）＋ 该图的机械自检结论。这是 DSH 版侧边栏图库面板在 MCP 形态下的等价物。

## 工具不可用时

如果你看不到 `diagram_*` 工具，按这个顺序查，别直接说"服务没连上"（第 2、3 步按 WorkBuddy 宿主写，其他客户端的连接入口不同、排查逻辑相同）：

1. **服务还活着吗** — 部署实例上跑 `curl http://<host>:8400/health`。`ok:true` 且 `tools:8` 才算活着。
2. **连接器在列表里吗** — WorkBuddy 的 MCP 配置**不热重载**，改完 `mcp.json` 要重开应用，或者打开「设置 → 安全中心 → 工具控制 → 自定义 MCP」触发一次刷新。
3. **信任了吗** — 用户自行添加的 MCP Server 默认不可信，条目会显示为不可信，要人点一次确认。这步只能用户做，别自己去改 `mcp-approvals.json`。
4. **信任键绑的是 origin** — URL 里只有 `/mcp` 路径变了不影响，**换了端口或主机要重新信任**。

三条都过了还是不行，再把 `/health` 的输出和服务端日志一起报给用户，别猜。

## 不要做的事

- 不要跳过 `diagram_tokens` 直接凭记忆写颜色值。
- 不要把 `diagram_check` 的"通过"当作"图很好"——它只查机械可判定的部分。
- 不要为了让内容装下而缩字号。拆图。
- 不要直接把 `diagram_import` 的结果当成品交付。
- 工具不可用时不要去改 `~/.workbuddy-ai/mcp-approvals.json` 或 `mcp.json`——那两道闸门是用户的安全边界，你能做的是把现象查清楚、把路径告诉用户。
