/**
 * A flowchart body: the recommended authoring sequence.
 *
 * Same constraints as body.mjs — 4px grid, axis-aligned connectors, one focal
 * node. Five steps laid out left-to-right so the reading direction matches the
 * temporal one.
 *
 * All colours are `var(--color-*)` references so the body follows the
 * document's skin — the same rule the scaffold helpers follow.
 */

const SANS = "'Geist','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const MONO = "'Geist Mono',ui-monospace,monospace"

const INK = 'var(--color-ink)'
const MUTED = 'var(--color-muted)'
const SOFT = 'var(--color-soft)'
const ACCENT = 'var(--color-accent)'
const PAPER = 'var(--color-paper)'

const name = (x, y, text) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="600" fill="${INK}">${text}</text>`

const sub = (x, y, text) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${SOFT}">${text}</text>`

/** A node box with its two lines of text. fillOpacity is optional. */
const node = (x, y, w, h, fill, stroke, width, label, sublabel, fillOpacity = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}"${fillOpacity ? ` fill-opacity="${fillOpacity}"` : ''} stroke="${stroke}" stroke-width="${width}"/>
        ${name(x + w / 2, y + 40, label)}
        ${sub(x + w / 2, y + 60, sublabel)}`

/** Axis-aligned connector. */
const arrow = (x1, y1, x2, y2, marker = 'arrow') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUTED}" stroke-width="1" marker-end="url(#${marker})"/>`

// 5 boxes, 152 wide, 32 apart, centred vertically: 36 + 184k
const X = [36, 220, 404, 588, 772]
const Y = 280
const W = 152
const H = 80
const MID = Y + H / 2

export const BODY = `
        <!-- ── 连线先画：线必须落在盒子后面 ── -->
        ${arrow(X[0] + W, MID, X[1], MID)}
        ${arrow(X[1] + W, MID, X[2], MID)}
        ${arrow(X[2] + W, MID, X[3], MID)}
        ${arrow(X[3] + W, MID, X[4], MID)}

        <!-- ── 节点 ── -->
        ${node(X[0], Y, W, H, SOFT, SOFT, 1, '选型', 'diagram_types', '0.10')}
        ${node(X[1], Y, W, H, PAPER, INK, 1, '定尺寸', 'diagram_sizes')}
        ${node(X[2], Y, W, H, PAPER, INK, 1, '取令牌', 'diagram_tokens')}
        ${node(X[3], Y, W, H, PAPER, INK, 1, '搭骨架', 'diagram_scaffold')}
        ${node(X[4], Y, W, H, ACCENT, ACCENT, 1.2, '自检', 'diagram_check', '0.08')}
`

export const LEGEND = [
  { label: '入口', fill: SOFT, stroke: SOFT },
  { label: '服务', fill: PAPER, stroke: INK },
  { label: '质量关卡', fill: ACCENT, stroke: ACCENT },
]

export const SPEC = {
  slug: 'workflow',
  title: '画一张图的标准顺序',
  type: 'flowchart',
  desc: '从选型到自检的五个步骤：先定类型，再定尺寸，取设计令牌，搭合规骨架，最后跑机械自检。',
}
