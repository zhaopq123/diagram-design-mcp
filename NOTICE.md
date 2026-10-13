# Attribution

## 来源链

```
cathrynlavery/diagram-design   (MIT, 上游设计系统)
        ↓  移植为 DSH 插件
dsh-diagram-design             (MIT, 加了 check/scaffold/面板)
        ↓  迁移为 MCP 服务
workbuddy-diagram-design       (MIT, 本包)
```

## 上游：`cathrynlavery/diagram-design`

- **作者**：Cathryn Lavery
- **仓库**：https://github.com/cathrynlavery/diagram-design
- **主页**：https://diagramdesign.dev
- **许可**：MIT

移植过来的内容（**设计系统，不是逐行抄代码**）：

- **设计令牌** —— 语义角色（明/暗两套值）、排版角色、节点处理、描边/圆角/网格、多系列调色板、复杂度预算。见 `src/core/tokens.js`。
- **尺寸预设、排版阶梯、安全区、输出旋钮、细节与受众层级、降级顺序**。见 `src/core/sizes.js`。
- **45 类图表目录**（最适合场景、布局约定、每类预算、反模式）、**选型指南**、**语义模式路由**。见 `src/core/catalog.json`。
- **六条连线铁律**与**通用反模式**。
- **无障碍 SVG 契约**与**宿主 CSS 契约**。
- **品味关卡清单**，按上游自己的划分拆成机械可判定部分（`src/core/check.js`）与编辑判断部分（交还给 agent，不假装能判）。

## 中间层：`dsh-diagram-design`

把上面那套设计系统包成 DeepSeek Harness 插件，并新增：

- `lib/check.js` —— 把品味关卡做成能跑、有测试的分析器。
- `lib/scaffold.js` —— 生成"落地即合规"的骨架文档。
- `lib/index.js` / `lib/client.js` —— DSH Host 半边（工具注册）与 Web 侧边栏图库面板。

## 本包：`workbuddy-diagram-design`

把插件的能力迁移成 **WorkBuddy 专用的 MCP 服务**，并做以下改动：

- **传输层换成 MCP Streamable HTTP**，7 个工具对任何 MCP 客户端可用，不再绑定单一宿主。
- **工具 schema 重写为扁平结构**：去掉 `outputSchema`、`anyOf`、`oneOf`、`allOf`、`$ref`。严格上游模型会因为这些字段直接拒掉整个请求，工具静默不可用。`test/tools.test.mjs` 把这个约束锁死了。
- **内容进、内容出**：服务端不读写调用方文件系统，路径穿越风险归零，服务可以跑在完全不同的机器上（本包实际部署在手机上）。
- **新增 `diagram_gallery`**：DSH 版侧边栏图库面板在 WorkBuddy 下的等价物——自足 HTML 页，`iframe sandbox="" srcdoc` 隔离预览。
- **修复上游解析器 bug**：Mermaid `S-->>C` 被解析出幽灵节点 `S-`（id 正则尾部允许 `-`，吞掉了箭头首划）。
- **解析器从 Host 半边抽出**为 `src/core/import.js`，脱离宿主可独立测试。

## 许可

上游 MIT，中间层 MIT，本包 MIT。保留上游版权声明（见 `LICENSE`），本文件记录完整派生关系。
