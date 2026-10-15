/**
 * The design system, as data.
 *
 * SINGLE SOURCE OF TRUTH. The agent tools, the shipped skill document, and the
 * Web panel all read this module — nothing re-types a hex value or a font role.
 * The upstream project this plugin ports names this exact failure in its own
 * notes: a hand-written catalogue drifted six signatures behind the tools that
 * were supposed to match it. Keeping one copy is the fix.
 *
 * Values are ported verbatim from the reference design system (MIT,
 * cathrynlavery/diagram-design `references/style-guide.md`). The names are
 * semantic ROLES, never hex values: type specs say `accent`, and the renderer
 * resolves it here. That indirection is what makes a skin swappable.
 *
 * @module dsh-diagram-design/lib/tokens
 */

/** Token roles: the value each role takes in the light and dark skins. */
export const ROLES = [
  { role: 'paper', light: '#f5f5f5', dark: '#2d3142', purpose: '页面底色、默认节点填充' },
  { role: 'paper-2', light: '#ececec', dark: '#393e53', purpose: '容器底色、次级填充' },
  { role: 'ink', light: '#2d3142', dark: '#f5f5f5', purpose: '主文字、主描边' },
  { role: 'ink-strong', light: '#111111', dark: '#111111', purpose: '暖色填充上的高对比文字' },
  { role: 'muted', light: '#4f5d75', dark: '#bfc0c0', purpose: '次级文字、默认箭头描边' },
  { role: 'soft', light: '#5a6580', dark: '#949eb2', purpose: '子标签、边界标签' },
  { role: 'rule', light: 'rgba(45,49,66,0.12)', dark: 'rgba(245,245,245,0.12)', purpose: '发丝边框' },
  { role: 'rule-solid', light: '#bfc0c0', dark: 'rgba(191,192,192,0.25)', purpose: '较强边框、基线' },
  { role: 'accent', light: '#bf4520', dark: '#f08a59', purpose: '焦点色：每图最多 1–2 处' },
  { role: 'accent-tint', light: 'rgba(191,69,32,0.08)', dark: 'rgba(240,138,89,0.10)', purpose: '焦点节点的填充' },
  { role: 'link', light: '#2e5aa8', dark: '#739fdf', purpose: 'HTTP/API 调用、外部箭头' },
]

/** Optional series palette — multi-series chart types only (currently: radar). */
export const SERIES = [
  { token: 'series-1', light: '#7c8f6f', dark: '#9caf8f', note: 'sage' },
  { token: 'series-2', light: '#5e7a9b', dark: '#82a0c0', note: 'dusty-blue' },
  { token: 'series-3', light: '#b8915a', dark: '#d3ad7a', note: 'mustard' },
  { token: 'series-4', light: '#9c6b50', dark: '#b88670', note: 'rust-brown' },
  { token: 'series-5', light: '#6e6479', dark: '#8d8298', note: 'slate' },
]

/** Opt-in terminal skin for the CLI-window primitive. A second, fixed skin. */
export const TERMINAL = [
  { token: 'terminal-page', hex: '#0a0a0a', purpose: '窗口背后的页面底色' },
  { token: 'terminal-paper', hex: '#141414', purpose: '窗口主体、节点填充' },
  { token: 'terminal-bar', hex: '#1b1b1b', purpose: '标题栏' },
  { token: 'terminal-border', hex: '#2b2b2b', purpose: '窗口边框、发丝线' },
  { token: 'terminal-ink', hex: '#f5f5f5', purpose: '主文字、主描边' },
  { token: 'terminal-muted', hex: '#9a9a9a', purpose: '次级文字、子标签、环描边' },
  { token: 'terminal-soft', hex: '#5c5c5c', purpose: '三级：非活动圆点、辐条' },
  { token: 'terminal-accent', hex: '#ff5a36', purpose: '唯一强调色：焦点站点、提示符、活动圆点' },
  { token: 'terminal-accent-tint', hex: 'rgba(255,90,54,0.12)', purpose: '强调描边盒的填充' },
]

/** Typography roles. `family` is the CSS stack; the size is the render ramp. */
export const TYPOGRAPHY = [
  { role: 'title', family: "'Instrument Serif', 'Noto Serif', 'Noto Serif KR', 'Noto Serif TC', serif", size: '1.75rem', weight: 400, usage: '页面 H1' },
  { role: 'node-name', family: "'Geist', system-ui, sans-serif", size: '12px', weight: 600, usage: '人可读的名字' },
  { role: 'sublabel', family: "'Geist Mono', ui-monospace, monospace", size: '9px', weight: 400, usage: '端口、协议、URL、字段类型' },
  { role: 'eyebrow', family: "'Geist Mono', ui-monospace, monospace", size: '7–8px', weight: 500, usage: '类型标签、轴标签（大写、字距 0.18em）' },
  { role: 'arrow-label', family: "'Geist Mono', ui-monospace, monospace", size: '8px', weight: 400, usage: '箭头注释（字距 0.06em）' },
  { role: 'callout', family: "'Instrument Serif', serif", size: '14px', weight: 400, usage: '仅用于编者按（斜体）' },
]

/** The Google Fonts request the templates embed (skipped in `system` mode). */
export const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Serif:ital@0;1&family=Noto+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@400&family=Noto+Sans+TC:wght@400;500;600&family=Noto+Serif+TC:wght@400&display=swap'

/**
 * Node treatment: the fill + stroke combination each node TYPE gets.
 *
 * This is the whole visual grammar in one table — shape carries category, and
 * `focal` is the only treatment allowed to spend the accent budget.
 */
export const NODE_TREATMENTS = [
  { type: 'focal', fill: 'accent-tint', stroke: 'accent', dash: null, rule: '每图最多 1–2 个' },
  { type: 'backend', fill: '#ffffff', stroke: 'ink', dash: null, rule: '服务、API' },
  { type: 'store', fill: 'ink @ 0.05', stroke: 'muted', dash: null, rule: '存储、状态' },
  { type: 'external', fill: 'ink @ 0.03', stroke: 'ink @ 0.30', dash: null, rule: '第三方、云' },
  { type: 'input', fill: 'muted @ 0.10', stroke: 'soft', dash: null, rule: '输入、用户' },
  { type: 'optional', fill: 'ink @ 0.02', stroke: 'ink @ 0.20', dash: '4,3', rule: '可选、异步' },
  { type: 'security', fill: 'accent @ 0.05', stroke: 'accent @ 0.50', dash: '4,4', rule: '安全、边界' },
]

/** Stroke weights, radii, and the hard geometry grid. */
export const GEOMETRY = {
  stroke: [
    { token: 'stroke-thin', value: '0.8', use: '标签盒描边、叶节点' },
    { token: 'stroke-default', value: '1', use: '大多数描边' },
    { token: 'stroke-strong', value: '1.2', use: '强调描边' },
  ],
  radius: [
    { token: 'radius-sm', value: 4, use: '小标签' },
    { token: 'radius-md', value: 6, use: '节点盒' },
    { token: 'radius-lg', value: 8, use: '容器、环' },
  ],
  /** Every coordinate, size and gap divides by this. A hard rule. */
  grid: 4,
  /** Max border-radius anywhere. Beyond this is the "rounded-2xl" slop. */
  radiusMax: 10,
  /**
   * The discrete walkable values for structural geometry (node origins, widths,
   * heights, gaps, padding). Ported from the reference `layout-budget.md`; the
   * check list is not mechanical (the checker cannot tell a node from a zone),
   * so it is the renderer's contract: pick from these, never an off-list 168px.
   */
  allowed: {
    sizes: [80, 96, 112, 120, 128, 140, 144, 160, 180, 200, 240, 320],
    gaps: [20, 24, 32, 40, 48],
    padding: [8, 12, 16],
  },
}

/**
 * The complexity budget. Exceeding it means "split into overview + detail",
 * never "shrink the type".
 */
export const BUDGET = {
  nodes: 9,
  arrows: 12,
  accent: 2,
  callouts: 2,
  motionSteps: 8,
  motionMarked: 12,
  motionSimultaneous: 2,
  /** Target density on a 1–10 scale. Enough to be complete, not to need a guide. */
  density: 4,
}

/**
 * The six mandatory connector rules.
 *
 * Non-negotiable. `id` is the stable key the checker reports against, so a
 * finding names the same rule the skill text does.
 */
export const CONNECTOR_RULES = [
  {
    id: 'orthogonal',
    text: '只用正交线。非同轴节点之间的连线是 r=8 的圆角直角折线（紧凑布局最小 r=6）；只有当两端 x 或 y 相同时才用直线 <line>。斜线一律不合格。',
    check: '每条连接线的两端必须共享 x 或 y',
  },
  {
    id: 'label-gap',
    text: '每个箭头标签（≤14 字符、全大写、居中于线段）都压在不透明遮罩上，与线之间留 6–10px 可见间隙，放在竖线段旁边，绝不压线。',
    check: '箭头标签必须有不透明遮罩，且与描边留出间隙',
  },
  {
    id: 'no-overlap',
    text: '不重叠：平行路线错开 ≥12px，交叉处使用桥接/跳线。',
    check: '连接线之间不重叠、不共线',
  },
  {
    id: 'fan-attach',
    text: '同一盒边的多条连线各自有独立接点，位于 L * k / (N + 1)，彼此 ≥12px（很小的盒子 ≥8px）。',
    check: '同一盒边的接点分散',
  },
  {
    id: 'no-transit',
    text: '不穿行非端点盒子。改道；仅当该盒子几何上无法避开时：虚线（4,3）、标签放在可见端、中间盒子不带箭头标记。',
    check: '连接线不穿过无关节点',
  },
  {
    id: 'mask-before-node',
    text: '遮罩先于节点。标签遮罩不得与之后绘制的节点重叠；完全落在节点内的徽章遮罩、以及覆盖更早图层的遮罩都可以。',
    check: '标签遮罩不与后绘制的节点重叠',
  },
]

/** Universal anti-patterns — the "AI slop" table. */
export const ANTI_PATTERNS = [
  { bad: '深色模式 + 青紫辉光', why: '看起来"技术"，其实没做设计决策' },
  { bad: '把 JetBrains Mono 当作万用"开发者字体"', why: '等宽只用于技术内容——端口、命令、URL。名字用 Geist 无衬线' },
  { bad: '每个节点都是同样的盒子', why: '抹平了层级' },
  { bad: '图例浮在图区内部', why: '会与节点打架' },
  { bad: '箭头标签没有遮罩矩形', why: '线会从文字里穿过去' },
  { bad: '箭头上的竖排 writing-mode 文字', why: '不可读' },
  { bad: '默认三张等宽摘要卡', why: '通用网格——宽度要有变化' },
  { bad: '任何元素带阴影', why: '阴影出局，边框入场' },
  { bad: '盒子用 rounded-2xl', why: '圆角上限 6–10px，或者不要' },
  { bad: '每个"重要"节点都用焦点色', why: '焦点色是 1–2 处编者级强调，不是信号系统' },
  { bad: '照搬 Mermaid 渲染器的布局', why: '那等于继承自动间距与走线，而不是做编排' },
  { bad: '违反第 6 节六条连线铁律中的任何一条', why: '自动不合格：斜线、标签压线、遮罩被后续节点裁切、路径重叠、共用接点、穿行非端点盒子' },
]

/** Resolve a role name to its value for one skin. */
export function roleValue(role, skin = 'light') {
  const found = ROLES.find((entry) => entry.role === role)
  if (found === undefined) return undefined
  return skin === 'dark' ? found.dark : found.light
}

/** The palette as a `{ '--color-<role>': value }` map, ready for CSS custom props. */
export function cssVariables(skin = 'light') {
  const out = {}
  for (const entry of ROLES) out[`--color-${entry.role}`] = skin === 'dark' ? entry.dark : entry.light
  return out
}
