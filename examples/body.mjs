/**
 * A real diagram body, hand-authored against the design system.
 *
 * Subject: the request path of this very service. Every coordinate is a
 * multiple of 4, every connector is axis-aligned, and the single focal node
 * (the trust boundary) is the only thing wearing the accent colour.
 */

const SANS = "'Geist','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const MONO = "'Geist Mono',ui-monospace,monospace"

const INK = '#2d3142'
const MUTED = '#4f5d75'
const SOFT = '#5a6580'
const ACCENT = '#bf4520'
const PAPER = '#f5f5f5'

const name = (x, y, text, fill = INK) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="600" fill="${fill}">${text}</text>`

const sub = (x, y, text) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${SOFT}">${text}</text>`

/** A node box with its two lines of text. */
const node = (x, y, w, h, fill, stroke, width, label, sublabel) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>
        ${name(x + w / 2, y + 40, label)}
        ${sub(x + w / 2, y + 60, sublabel)}`

/** Axis-aligned connector. */
const arrow = (x1, y1, x2, y2, marker = 'arrow') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUTED}" stroke-width="1" marker-end="url(#${marker})"/>`

export const BODY = `
        <!-- ── 连线先画：线必须落在盒子后面 ── -->
        ${arrow(200, 292, 256, 292)}
        ${arrow(416, 292, 472, 292)}
        ${arrow(632, 292, 688, 292)}
        ${arrow(552, 336, 552, 440)}
        ${arrow(784, 336, 784, 440)}

        <!-- 箭头标签：不透明遮罩 + 与描边留 8px 间隙，绝不压线 -->
        <rect x="560" y="380" width="88" height="16" fill="${PAPER}"/>
        <text x="564" y="392" font-family="${SANS}" font-size="12" font-weight="500" fill="${MUTED}">按类型取数</text>

        <!-- ── 节点 ── -->
        ${node(40, 248, 160, 88, 'rgba(79,93,117,0.10)', SOFT, 1, 'WorkBuddy 会话', 'tools/call')}
        ${node(256, 248, 160, 88, 'rgba(191,69,32,0.08)', ACCENT, 1.2, 'Bearer 鉴权', ':8400/mcp')}
        ${node(472, 248, 160, 88, '#ffffff', INK, 1, '会话 + 分发', 'Mcp-Session-Id')}
        ${node(688, 248, 192, 88, '#ffffff', INK, 1, '机械自检', 'diagram_check')}
        ${node(472, 440, 160, 80, 'rgba(45,49,66,0.05)', MUTED, 1, '类型目录', 'catalog.json')}
        ${node(688, 440, 192, 80, 'rgba(45,49,66,0.05)', MUTED, 1, '交付物', 'host writes .html')}
`

export const LEGEND = [
  { label: '输入', fill: 'rgba(79,93,117,0.10)', stroke: SOFT },
  { label: '焦点（信任边界）', fill: 'rgba(191,69,32,0.08)', stroke: ACCENT },
  { label: '服务', fill: '#ffffff', stroke: INK },
  { label: '数据 / 交付物', fill: 'rgba(45,49,66,0.05)', stroke: MUTED },
]

export const SPEC = {
  slug: 'request-path',
  title: 'WorkBuddy 图表 MCP：一次请求的链路',
  type: 'architecture',
  desc: '一次 diagram_check 调用从 WorkBuddy 会话经鉴权与分发抵达工具、并回写交付物的路径。',
}
