/**
 * Scaffold a compliant diagram document.
 *
 * THE PRODUCT IDEA
 * ----------------
 * The hard part of an editorial diagram is the layout decision, and that stays
 * with the author. The part that is easy to get WRONG and tedious to redo is
 * everything around it: the accessible-SVG contract, the three markers, the
 * hosting CSS that keeps the type ramp from being scaled away, the legend strip
 * that needs its 60px, the 4px grid. Those are exactly what the taste gate
 * fails on, and exactly what a generator can get right every time.
 *
 * So this emits a document that already passes the mechanical checks, with the
 * content slots empty and marked. The author then does the part that needs
 * judgement — which is the whole point of the design system.
 *
 * @module dsh-diagram-design/lib/scaffold
 */

import { FONT_LINK } from './tokens.js'
import { diagramCss, rampFor, sizeById } from './sizes.js'

/** Escape text for XML character-data. */
function xml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Turn a title into a slug usable in element ids. */
export function slugify(title) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.length === 0 ? 'diagram' : base.slice(0, 48)
}

/**
 * Resolve the CSS variables the emitted shapes read from.
 *
 * Helpers return fragments BEFORE `scaffold()` knows the skin, so baking any
 * skin's hex into them would repeat the shipped bug: `skin: 'dark'` reached the
 * backdrop rect and nowhere else. Every emitted colour is therefore a
 * `var(--color-*)` reference, and `diagramCss(skin)` resolves those variables
 * once in `:root` for the selected skin. One place a hex lives, one place a
 * skin swap happens.
 */
function paletteFor() {
  // Emit CSS variables rather than resolved hex values. The body helpers return
  // an SVG fragment before scaffold() receives the skin, so baking light values
  // into the fragment makes dark mode impossible to apply consistently.
  // CSS variables keep the fragment skin-agnostic; scaffold's :root resolves
  // them for the selected skin at render time.
  return {
    paper: 'var(--color-paper)',
    paper2: 'var(--color-paper-2)',
    ink: 'var(--color-ink)',
    muted: 'var(--color-muted)',
    soft: 'var(--color-soft)',
    accent: 'var(--color-accent)',
    accentTint: 'var(--color-accent-tint)',
    link: 'var(--color-link)',
  }
}

/** Node fill/stroke combos read from the same variables, so they follow the skin. */
function treatments() {
  const p = paletteFor()
  return {
    focal: { fill: p.accentTint, stroke: p.accent, width: 1.2 },
    backend: { fill: p.paper, stroke: p.ink, width: 1 },
    store: { fill: p.ink, fillOpacity: 0.05, stroke: p.muted, width: 1 },
    external: { fill: p.ink, fillOpacity: 0.03, stroke: p.ink, strokeOpacity: 0.30, width: 1 },
    input: { fill: p.muted, fillOpacity: 0.10, stroke: p.soft, width: 1 },
    optional: { fill: p.ink, fillOpacity: 0.02, stroke: p.ink, strokeOpacity: 0.20, width: 1, dash: '4,3' },
    security: { fill: p.accent, fillOpacity: 0.05, stroke: p.accent, strokeOpacity: 0.50, width: 1, dash: '4,4' },
  }
}

/**
 * The three arrow markers every diagram needs.
 *
 * Ids are `arrow`, `arrow-accent`, `arrow-link` — the reference templates use
 * these names, so a diagram assembled by hand from the type docs still matches.
 *
 * `skin` defaults to light, which keeps the output byte-identical to what this
 * function always produced.
 */
function markerDefs(skin = 'light') {
  const p = paletteFor(skin)
  return [
    '    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">',
    `      <polygon points="0 0, 8 3, 0 6" fill="${p.muted}"/>`,
    '    </marker>',
    '    <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">',
    `      <polygon points="0 0, 8 3, 0 6" fill="${p.accent}"/>`,
    '    </marker>',
    '    <marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">',
    `      <polygon points="0 0, 8 3, 0 6" fill="${p.link}"/>`,
    '    </marker>',
  ].join('\n')
}

/**
 * A starter node: an opaque mask, then the styled box, then the type tag, the
 * name, and the mono sublabel.
 *
 * The mask is not decoration — it is what lets a connector pass behind the box
 * without bleeding through, and drawing it is the single most commonly skipped
 * step in hand-authored diagrams.
 *
 * `skin` is threaded all the way down: the mask, the box, the tag frame, the
 * tag text, the name and the sublabel all come from the skin's palette. Before,
 * every one of those was a hardcoded light hex, so a dark document got white
 * boxes and dark-on-dark text.
 */
export function node({ x, y, w, h, name, sublabel, tag, treatment = 'backend', id, skin = 'light' }) {
  const boxId = id ?? slugify(name)
  const p = paletteFor(skin)
  const fills = treatments(skin)[treatment] ?? { fill: p.paper, stroke: p.ink, width: 1 }

  const dash = fills.dash === undefined ? '' : ` stroke-dasharray="${fills.dash}"`
  const fillOpacity = fills.fillOpacity === undefined ? '' : ` fill-opacity="${fills.fillOpacity}"`
  const strokeOpacity = fills.strokeOpacity === undefined ? '' : ` stroke-opacity="${fills.strokeOpacity}"`
  const lines = [
    `    <!-- node: ${xml(name)} -->`,
    `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${p.paper}"/>`,
    `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fills.fill}"${fillOpacity} stroke="${fills.stroke}"${strokeOpacity} stroke-width="${fills.width}"${dash}/>`,
  ]
  if (typeof tag === 'string' && tag.length > 0) {
    // Tag width and its x/y must land on the 4px grid — the same rule that
    // governs node geometry, so a generated box is never flagged by the grid
    // check the tool itself runs.
    const tagWidth = Math.ceil((Math.max(28, tag.length * 6 + 12)) / 4) * 4
    lines.push(
      `    <rect x="${x + 8}" y="${y + 8}" width="${tagWidth}" height="16" rx="2" fill="none" stroke="${p.ink}" stroke-opacity="0.30" stroke-width="0.8"/>`,
      `    <text x="${x + 12}" y="${y + 20}" font-family="'Geist Mono', ui-monospace, monospace" font-size="8" font-weight="500" letter-spacing="0.18em" fill="${p.soft}">${xml(tag.toUpperCase())}</text>`,
    )
  }
  lines.push(
    `    <text x="${x + 12}" y="${y + h / 2 + (sublabel === undefined ? 4 : -2)}" font-family="'Geist', system-ui, sans-serif" font-size="12" font-weight="600" fill="${p.ink}">${xml(name)}</text>`,
  )
  if (typeof sublabel === 'string' && sublabel.length > 0) {
    lines.push(`    <text x="${x + 12}" y="${y + h / 2 + 14}" font-family="'Geist Mono', ui-monospace, monospace" font-size="9" fill="${p.soft}">${xml(sublabel)}</text>`)
  }
  void boxId
  return lines.join('\n')
}

/**
 * A right-angle connector with a rounded elbow.
 *
 * Rule 1 of the connector contract is "orthogonal only", and a hand-drawn
 * diagonal is the most common breach. Emitting the elbow as a path is the whole
 * reason this helper exists.
 */
export function elbow({ from, to, r = 8, kind = 'arrow', dashed = false, label, skin = 'light' }) {
  const [x1, y1] = from
  const [x2, y2] = to
  const p = paletteFor(skin)
  const stroke = kind === 'accent' ? p.accent : kind === 'link' ? p.link : p.muted
  const marker = `url(#${kind === 'accent' ? 'arrow-accent' : kind === 'link' ? 'arrow-link' : 'arrow'})`
  const dash = dashed ? ' stroke-dasharray="5,4"' : ''

  let d
  if (Math.abs(x1 - x2) < 0.5 || Math.abs(y1 - y2) < 0.5) {
    d = `M ${x1} ${y1} L ${x2} ${y2}`
  } else {
    // Vertical-first elbow: down to the target's row, then across.
    const dir = y2 > y1 ? 1 : -1
    const mid = y2 - dir * r
    d = `M ${x1} ${y1} L ${x1} ${mid} Q ${x1} ${y2} ${x1 + (x2 > x1 ? r : -r)} ${y2} L ${x2} ${y2}`
  }

  const out = [`    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1"${dash} marker-end="${marker}"/>`]
  if (typeof label === 'string' && label.length > 0) {
    // The label sits beside the segment on its own opaque mask — rule 2. A label
    // drawn straight over the stroke bleeds through it. Mask geometry is snapped
    // to the 4px grid like everything else structural.
    const lx = Math.round((Math.min(x1, x2) + Math.abs(x2 - x1) / 2) / 4) * 4
    const ly = Math.abs(y1 - y2) > Math.abs(x1 - x2)
      ? Math.round((y1 + (y2 - y1) / 2) / 4) * 4
      : Math.round(y1 / 4) * 4
    const w = Math.ceil(Math.max(24, label.length * 5 + 12) / 4) * 4
    out.push(
      `    <rect class="label-mask" x="${Math.round((lx - w / 2) / 4) * 4}" y="${Math.round((ly - 16) / 4) * 4}" width="${w}" height="16" fill="${p.paper}"/>`,
      `    <text class="arrow-label" x="${lx}" y="${Math.round((ly - 4) / 4) * 4}" font-family="'Geist Mono', ui-monospace, monospace" font-size="8" letter-spacing="0.06em" fill="${p.muted}" text-anchor="middle">${xml(label)}</text>`,
    )
  }
  return out.join('\n')
}

/** The legend strip. A horizontal bottom strip, never floating inside the art. */
export function legend(entries, viewBoxWidth, viewBoxHeight, skin = 'light') {
  // The tool schema marks `label` required, but a JS function must not crash on
  // a caller that skipped it: one missing legend entry should never take down
  // the whole document. A non-array yields no legend at all.
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const usable = entries.filter((entry) => entry !== null && typeof entry === 'object')
  if (usable.length === 0) return ''
  const p = paletteFor(skin)
  // The legend owns the bottom 60px; nothing else lives there.
  const y = viewBoxHeight - 40
  const parts = [
    '    <!-- legend: horizontal bottom strip (never floating inside the diagram area) -->',
    `    <line x1="40" y1="${y - 12}" x2="${viewBoxWidth - 40}" y2="${y - 12}" stroke="var(--color-rule)" stroke-width="1"/>`,
  ]
  let x = 40
  for (const entry of usable) {
    const label = typeof entry.label === 'string' ? entry.label : ''
    parts.push(
      `    <rect x="${x}" y="${y - 4}" width="16" height="16" rx="2" fill="${entry.fill ?? p.paper2}" stroke="${entry.stroke ?? p.ink}" stroke-width="1"${entry.dash === undefined ? '' : ` stroke-dasharray="${entry.dash}"`}/>`,
      `    <text x="${x + 24}" y="${y + 8}" font-family="'Geist Mono', ui-monospace, monospace" font-size="8" letter-spacing="0.06em" fill="${p.muted}">${xml(label)}</text>`,
    )
    // Advance on the 4px grid so the next swatch is itself compliant.
    x += 24 + Math.ceil((label.length * 5.2) / 4) * 4 + 24
  }
  return parts.join('\n')
}

/**
 * The full starter document.
 *
 * @param {object} spec
 * @param {string} spec.title - page H1 and the SVG `<title>`.
 * @param {string} [spec.type] - diagram type id, shown as the eyebrow.
 * @param {string} [spec.desc] - the SVG `<desc>`; one sentence about content.
 * @param {string} [spec.size] - size preset id.
 * @param {string} [spec.skin] - `light` or `dark`.
 * @param {string} [spec.fonts] - `web` (Google Fonts link) or `system` (offline).
 * @param {string} [spec.body] - the SVG body between background and legend.
 * @param {Array} [spec.legend] - legend entries.
 */
export function scaffold(spec) {
  const {
    title = 'Diagram',
    type = 'architecture',
    desc = 'One sentence about what this diagram shows.',
    size = 'doc-inline',
    skin = 'light',
    fonts = 'web',
    body = '',
    legend: legendEntries = [],
  } = spec

  const preset = sizeById(size)
  const ramp = rampFor(size)
  const slug = slugify(title)

  // `fit` derives its frame from content; without content there is nothing to
  // derive from, so fall back to the default frame and say so in a comment.
  const viewBox = preset.viewBox ?? '0 0 960 600'
  const [vbW, vbH] = viewBox.split(/\s+/).slice(2).map(Number)
  const minWidth = preset.minWidth ?? vbW

  const paper = 'var(--color-paper)'
  const ink = 'var(--color-ink)'
  const muted = 'var(--color-muted)'
  const soft = 'var(--color-soft)'

  const fontLink = fonts === 'web' ? `\n  <link href="${FONT_LINK}" rel="stylesheet">` : ''
  const fontNote = fonts === 'web'
    ? ''
    : '\n  <!-- font source: system — no network request; each stack ends in a generic family -->'

  const legendSvg = legend(legendEntries, vbW, vbH, skin)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${xml(title)}</title>${fontLink}${fontNote}
  <style>
    ${diagramCss(minWidth, ramp, skin)}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">${xml(type)} · Diagram Design</p>
    <h1>${xml(title)}</h1>

    <div class="diagram-container">
      <svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${slug}-title ${slug}-desc">
        <title id="${slug}-title">${xml(title)}</title>
        <desc id="${slug}-desc">${xml(desc)}</desc>
        <defs>
${markerDefs(skin)}
        </defs>

        <rect width="100%" height="100%" fill="${paper}"/>

        <!-- Arrows first, then nodes: lines must sit behind boxes. -->
${body}

${legendSvg}
      </svg>
    </div>
  </div>
</body>
</html>
`
}

/** Export the skin's resolved colours for the scaffold's callers. */
export const SKIN = {
  light: { paper: '#f5f5f5', ink: '#2d3142', muted: '#4f5d75', soft: '#5a6580', accent: '#bf4520', link: '#2e5aa8' },
  dark: { paper: '#2d3142', ink: '#f5f5f5', muted: '#bfc0c0', soft: '#949eb2', accent: '#f08a59', link: '#739fdf' },
}
