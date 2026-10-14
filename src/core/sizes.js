/**
 * Size presets and the type ramp.
 *
 * A size preset decides two things at once — the `viewBox` and the type ramp —
 * and that pairing is the point: a slide is read from further away, so its type
 * grows with the canvas. Shrinking the ramp to fit more nodes onto a big canvas
 * is the failure this module exists to prevent.
 *
 * Every viewBox value is divisible by 4, so the grid rule holds by construction.
 * Ported verbatim from the reference `references/output-spec.md` (MIT).
 *
 * @module dsh-diagram-design/lib/sizes
 */

import { cssVariables } from './tokens.js'

/**
 * The size presets. `ramp` names a row of {@link TYPE_RAMP}.
 *
 * `minWidth` is the SVG `min-width` a host must pin — it equals the viewBox
 * width, which is what keeps the type ramp from being scaled down on a phone.
 */
export const SIZES = [
  { id: 'doc-inline', viewBox: '0 0 960 600', aspect: '8:5', ramp: 'standard', minWidth: 960, use: '文章或 README 里的正文宽度图（默认）' },
  { id: 'doc-wide', viewBox: '0 0 1280 720', aspect: '16:9', ramp: 'standard', minWidth: 1280, use: '全宽文档、wiki 页面' },
  { id: 'slide-16x9', viewBox: '0 0 1280 720', aspect: '16:9', ramp: 'presentation', minWidth: 1280, use: '演示幻灯片、投影' },
  { id: 'slide-4x3', viewBox: '0 0 1024 768', aspect: '4:3', ramp: 'presentation', minWidth: 1024, use: '旧版幻灯片模板' },
  { id: 'social-og', viewBox: '0 0 1200 632', aspect: '~1.9:1', ramp: 'presentation', minWidth: 1200, use: '链接预览卡片' },
  { id: 'social-square', viewBox: '0 0 1080 1080', aspect: '1:1', ramp: 'presentation', minWidth: 1080, use: '信息流帖子、轮播' },
  { id: 'print-a4-landscape', viewBox: '0 0 1120 792', aspect: '~1.41:1', ramp: 'print', minWidth: 1120, use: 'A4 横向，96dpi 下约 10mm 页边距' },
  { id: 'print-a3-landscape', viewBox: '0 0 1584 1120', aspect: '~1.41:1', ramp: 'print', minWidth: 1584, use: 'A3 横向' },
  { id: 'print-letter-landscape', viewBox: '0 0 1056 816', aspect: '~1.29:1', ramp: 'print', minWidth: 1056, use: '美制 Letter 横向' },
  { id: 'fit', viewBox: null, aspect: '任意', ramp: 'standard', minWidth: null, use: '矢量交付，无固定画框（由内容包围盒推导）' },
]

/** The default size preset. */
export const DEFAULT_SIZE = 'doc-inline'

/**
 * Type ramp per size class.
 *
 * Families are the default skin's; under a custom skin read them as the
 * `title` / `node-name` / `sublabel` / `arrow-label` / `eyebrow` roles.
 */
export const TYPE_RAMP = {
  standard: { title: 28, nodeName: 12, sublabel: 9, arrowLabel: 8, eyebrow: 8, nodeMinHeight: 48, minGap: 24 },
  presentation: { title: 40, nodeName: 16, sublabel: 12, arrowLabel: 12, eyebrow: 8, nodeMinHeight: 64, minGap: 40 },
  print: { title: 32, nodeName: 12, sublabel: 9, arrowLabel: 8, eyebrow: 8, nodeMinHeight: 48, minGap: 24 },
}

/**
 * Named size exceptions. A size that is neither on the ramp nor on this list is
 * a bug in the diagram, not a new size — which is what keeps a diagram from
 * quietly inventing a 7px node name.
 */
export const SIZE_EXCEPTIONS = [
  { font: 'Geist Mono / Geist regular', sizes: '7–11（半步允许）', what: '密集注释：图例键、轴刻度、图表数据标签、来源行、盒内标签' },
  { font: 'Geist 600', sizes: '10–11', what: '图表系列名或行名：柱状类别、折线/凸点系列、甘特行、矩阵表头' },
  { font: 'Geist 600', sizes: '14', what: '分组或实体标题' },
  { font: '任意', sizes: '任意', what: '不透明度 ≤0.08 的装饰性水印数字' },
]

/** Safe areas per preset — where nothing but chrome may live. */
export const SAFE_AREAS = [
  { preset: '全部', rule: '40px 外边距；图例条占据底部 60px，其它内容不得进入' },
  { preset: 'social-og', rule: '四边各留 64px 空白——各平台的链接卡裁切不可预测' },
  { preset: 'slide-*', rule: '若模板有页脚条，底部 80px 保持空置；不确定就问' },
]

/** Resolve one preset by id, falling back to the default. */
export function sizeById(id) {
  return SIZES.find((entry) => entry.id === id) ?? SIZES.find((entry) => entry.id === DEFAULT_SIZE)
}

/** The type ramp for a preset id. */
export function rampFor(id) {
  const preset = sizeById(id)
  return { preset: preset.id, ...TYPE_RAMP[preset.ramp] }
}

/**
 * Derive a `fit` viewBox from a content bounding box.
 *
 * Round the content box UP to the next multiple of 4, then add fixed chrome:
 * 40px on every side, plus 60px at the bottom for the legend strip. Content
 * never touches the viewBox edge.
 */
export function fitViewBox(contentWidth, contentHeight) {
  const roundUp4 = (value) => Math.ceil(value / 4) * 4
  const width = roundUp4(contentWidth) + 80
  const height = roundUp4(contentHeight) + 80 + 60
  return `0 0 ${width} ${height}`
}

/** The four output dials an import or a new diagram must set before drawing. */
export const DIALS = [
  { dial: 'format', question: '文件落到哪里？', options: ['html', 'svg', 'png', 'html+png'], default: 'html' },
  { dial: 'size', question: '画布多大、读者离多远？', options: SIZES.map((entry) => entry.id), default: DEFAULT_SIZE },
  { dial: 'detail', question: '复刻每个元素，还是压缩？', options: ['faithful', 'balanced', 'simplified'], default: 'balanced' },
  { dial: 'audience', question: '措辞该多技术？', options: ['engineer', 'mixed', 'executive'], default: 'mixed' },
]

/** Detail levels — a COUNT dial: how many elements survive, not how they read. */
export const DETAIL_LEVELS = [
  { id: 'faithful', nodes: '≤24（须分区）', edges: '≤32', sublabels: '每个端口、协议、版本', survives: '源里每个不同的组件，只有完全重复才合并' },
  { id: 'balanced', nodes: '≤12', edges: '≤16', sublabels: '≤4 个节点带技术子标签', survives: '承载故事的组件；叶簇各塌缩为一个节点' },
  { id: 'simplified', nodes: '≤7', edges: '≤9', sublabels: '无', survives: '能力及其顺序，基础设施消失' },
]

/** Audience levels — the same nodes, named differently. */
export const AUDIENCE_LEVELS = [
  { id: 'engineer', names: '精确的服务/组件名', sublabels: '协议、端口、版本、镜像 tag', edges: 'POST /v2/orders、SQL、gRPC', never: '「连接到」这类含糊动词' },
  { id: 'mixed', names: '组件名，缩写展开', sublabels: '仅在影响决策时给技术细节', edges: '朴素动词——验证、写入、通知', never: '端口、版本、内部代号' },
  { id: 'executive', names: '能力与结果', sublabels: '无', edges: '业务动词——批准、放款', never: '厂商名、基础设施、协议' },
]

/** The degrade ladder: cut in this order and stop as soon as you are under budget. */
export const DEGRADE_LADDER = [
  '装饰性单元格——便签、游离文字、标题块、水印、源文件自带的图例（值得留的批注转成 annotation callout，最多 2 条）',
  '完全重复——N 个相同 worker/副本/分片合并为一个节点，标为 `Worker ×N`',
  '叶簇——子节点全是叶子的容器塌缩为容器本身：`Core Services` 取代它的三个盒子',
  '不改变故事的度为 1 的汇点——监控钩子、日志桶、归档层',
  '横切基础设施——日志、指标、密钥、CI（`simplified` 无需询问即删；`balanced` 最多留一个，且只有当图就是讲它时）',
  '还是超？拆成总览 + 细节。拆图永远优于缩图',
]

/**
 * Build the CSS block for a generated diagram.
 *
 * The two rules that matter and are easy to get wrong:
 *   - `min-width` equals the viewBox width, so the type ramp is never scaled
 *     down; the SVG sits in a local `overflow-x: auto` wrapper so a narrow
 *     screen scrolls the diagram instead of the whole page.
 *   - the `@media print` release comes AFTER the `svg` rule, because a media
 *     query adds no specificity and a later plain rule would win.
 */
/**
 * The hosting CSS every document needs.
 *
 * `skin` is not optional in spirit: it decides the four `--color-*` custom
 * properties, and `body`/`h1`/`svg` all read them through `var()`. This
 * function used to hardcode the light values, which is what made `skin: 'dark'`
 * emit a page with a light background under a dark canvas — the palette looked
 * swapped rather than themed. Now the values come straight from `cssVariables`,
 * which is the same function the tools expose to callers, so there is exactly
 * one place a hex lives.
 *
 * Light output is byte-for-byte what it always was.
 */
export function diagramCss(minWidth, ramp, skin = 'light') {
  const colors = cssVariables(skin)
  return [
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
    ':root {',
    `  ${Object.entries(colors).map(([name, value]) => `${name}: ${value}`).join('; ')};`,
    "  --font-sans: 'Geist', system-ui, sans-serif;",
    "  --font-serif: 'Instrument Serif', 'Noto Serif', 'Noto Serif KR', 'Noto Serif TC', serif;",
    "  --font-mono: 'Geist Mono', ui-monospace, monospace;",
    '}',
    'body { font-family: var(--font-sans); background: var(--color-paper); color: var(--color-ink);',
    '  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }',
    '.frame { max-width: 1200px; width: 100%; }',
    '.diagram-container { width: 100%; overflow-x: auto; }',
    '.eyebrow { font-family: var(--font-mono); font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em;',
    '  text-transform: uppercase; color: var(--color-muted); margin-bottom: 0.5rem; }',
    'h1 { font-family: var(--font-serif); font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400;',
    '  letter-spacing: -0.02em; line-height: 1.15; color: var(--color-ink); margin-bottom: 1.5rem; }',
    `svg { width: 100%; min-width: ${minWidth}px; display: block; }`,
    '@media print { .diagram-container { overflow-x: visible; } svg { min-width: 0; } }',
  ].join('\n    ')
}
