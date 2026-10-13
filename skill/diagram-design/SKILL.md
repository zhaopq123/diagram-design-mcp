---
name: diagram-design
description: 画专业级图表（架构图、流程图、时序图、状态机、象限图、数据流图等 45 类），或改既有图、从 Mermaid/draw.io/Excalidraw 提取结构重画、把多张图合成图库页。产出的是自足单文件 HTML（含无障碍 SVG 契约），可打印、可分享。触发词：画图、画一张图、做张图、画个架构图、流程图、时序图、状态图、象限图、数据流、图表、示意图、diagram、architecture diagram、flowchart、sequence diagram、把这段 mermaid 画出来、这张图帮我改一下、图库、gallery、图太丑、图不规范、diagram design。
---

# 图表设计

用 `diagram_*` 系列 MCP 工具产出编辑级图表。核心是**别自己从零写 SVG**——骨架、设计令牌、机械自检都已经被工具机械化了，你负责的是判断：内容、层级、焦点、删减。

## 服务位置

远端 MCP 服务（手机常驻），工具名前缀 `diagram_`：`diagram_tokens` / `diagram_sizes` / `diagram_types` / `diagram_scaffold` / `diagram_check` / `diagram_import` / `diagram_gallery`。

**内容进、内容出**：服务不碰你的文件系统。所有内容你传进去，成品 HTML 它还给你，落盘由你来做。

## 标准流程

1. **`diagram_types`** — 先选型。要展示"谁调用谁"用 architecture，展示"步骤顺序"用 flowchart，展示"消息往返"用 sequence，展示"两个维度权衡"用 quadrant。不确定就传 `query` 搜（支持中文：「时序」「象限」「架构」）。
2. **`diagram_sizes`** — 定四个旋钮：格式（doc-inline / presentation / print）、尺寸、细节层级、受众。**尺寸预设同时决定画布和字号，不要拆开看。** 装不下就拆图，不要缩字号。
3. **`diagram_tokens`** — 取权威数值。类型文档里写的是 `{ink}`、`{accent}` 这类**角色名**，具体十六进制值以这里为准。画之前必须取。
4. **`diagram_scaffold`** — 起手。产出的骨架已经通过机械自检，把第二个内容块**原样**写进 `.html` 文件，再把内容填进去。
5. **`diagram_check`** — 收尾。传 HTML 全文。`findings` 里的 error **必须修**；`judgement` 是你自己的编辑责任；`limits` 告诉你这个检查器查不出什么。
6. **向用户交代** — 说清楚画了什么、砍了什么、为什么这么取舍。别只说"已完成"。

改既有图 → 从第 3 步开始。从 Mermaid/draw.io/Excalidraw 迁移 → 先 `diagram_import` 提结构，**然后重画，不是转换**（源坐标、颜色、字体、形状怪癖全丢，只留内容），最后向用户交"保真度账本"：合并了什么、塌缩了什么、丢掉了什么。

## 硬规则（工具会替你查，但别指望它兜底）

- **4px 网格**：每个坐标、尺寸、间隙都能被 4 整除。
- **焦点色 `accent` 每图最多 1–2 处**。其余一律 `ink` / `muted` / `soft`。全图都在喊 = 没人在喊。
- **节点 ≤ 9、箭头 ≤ 12**。超了就拆成"总览 + 细节"两张图。
- **连线画在节点之前**（线必须在盒子后面）。
- **`min-width` 必须等于 viewBox 宽度**，SVG 放在局部 `overflow-x: auto` 容器里。否则窄屏把整张图连同字号一起缩下去。
- **无障碍契约**：`<svg role="img" aria-labelledby="<slug>-title <slug>-desc">`，`<title>` 必须是 `<svg>` 的第一个子元素且带 id（不能是裸 `title`）。
- **单文件自足**：除字体样式表外不许有外链。
- **中文标签**：Geist 无汉字覆盖，要扩展自己的字族；**12px 是字号下限**，装不下就砍名字，不要缩字号。

## 图库

多张图 → `diagram_gallery`，产出一个自足图库页：每张图一张卡片，内嵌隔离沙箱预览（`iframe sandbox="" srcdoc`，不执行图内脚本）＋ 该图的机械自检结论。这是 DSH 版侧边栏图库面板在 WorkBuddy 下的等价物。

## 不要做的事

- 不要跳过 `diagram_tokens` 直接凭记忆写颜色值。
- 不要把 `diagram_check` 的"通过"当作"图很好"——它只查机械可判定的部分。
- 不要为了让内容装下而缩字号。拆图。
- 不要直接把 `diagram_import` 的结果当成品交付。
