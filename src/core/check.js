/**
 * The taste gate, made mechanical.
 *
 * WHAT THIS IS
 * ------------
 * The reference design system ships a §9 "Pre-Output Checklist" that a human or
 * model is asked to run before shipping a diagram. Asking nicely is not a
 * control. This module turns the parts that are *decidable from the artifact*
 * into checks with pass/fail results, so "is this diagram actually compliant?"
 * has an answer that does not depend on the author's memory.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 * -----------------------------------
 * A checker that overstates its coverage is worse than none: it retires the
 * human judgement it cannot replace. Several checklist items — "would a table
 * do the same job?", "can I remove a node?" — are editorial judgements with no
 * mechanical test, and they are listed under `judgement` rather than faked.
 * Parsing is regex-based over well-formed generated markup; hand-edited or
 * exotic HTML can defeat it, which the report states rather than hides.
 *
 * @module dsh-diagram-design/lib/check
 */

import { BUDGET, CONNECTOR_RULES, GEOMETRY, roleValue } from './tokens.js'
import { sizeById } from './sizes.js'

/** A finding. `rule` names the design-system rule the finding is about. */
function finding(level, rule, message, hint) {
  return { level, rule, message, ...(hint === undefined ? {} : { hint }) }
}

/** Strip comments so commented-out markup cannot satisfy a check. */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** The `<svg>…</svg>` block, or null when there is none. */
function svgBlock(html) {
  const match = html.match(/<svg\b[\s\S]*?<\/svg>/i)
  return match === null ? null : match[0]
}

/** Parse `viewBox="minX minY w h"` into numbers. */
function parseViewBox(svg) {
  const raw = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (raw === undefined) return null
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] }
}

/** All numeric attribute values of one tag name, as `{ attr: number }` maps. */
function numbersOf(svg, tag) {
  const out = []
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, 'gi')
  let match
  while ((match = pattern.exec(svg)) !== null) {
    const attrs = { __class: match[1].match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] }
    // Attribute names carry digits (`x1`, `y2`, `cx`, `cx1`); a letter-only
    // name class silently drops every coordinate and makes the connector and
    // containment checks no-ops that always pass.
    const attrPattern = /([a-zA-Z][\w:-]*)\s*=\s*["']([^"']*)["']/g
    let attr
    while ((attr = attrPattern.exec(match[1])) !== null) {
      const value = Number(attr[2])
      if (Number.isFinite(value)) attrs[attr[1]] = value
    }
    out.push(attrs)
  }
  return out
}

/**
 * Run every mechanical check over one diagram document.
 *
 * @param {string} html - the full self-contained document.
 * @param {{ type?: string }} [options] - the declared diagram type, when known.
 * @returns {{ ok: boolean, findings: Array, judgement: string[], limits: string[] }}
 */
export function checkDiagram(html, options = {}) {
  const findings = []
  const clean = stripComments(html)
  const svg = svgBlock(clean)

  // ── Document level ────────────────────────────────────────────────────────
  if (svg === null) {
    findings.push(finding('error', 'svg-present', '文档里没有 <svg> 元素——这不是一张图。'))
    return finish(findings)
  }

  // Single-file safety: no external resource except the font stylesheet.
  const externalRefs = []
  const srcPattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi
  let ref
  while ((ref = srcPattern.exec(clean)) !== null) {
    const url = ref[1]
    if (/^(#|data:|mailto:)/i.test(url)) continue
    if (/^https:\/\/fonts\.googleapis\.com\//i.test(url)) continue
    externalRefs.push(url)
  }
  if (externalRefs.length > 0) {
    findings.push(finding('error', 'single-file', `引用了 ${externalRefs.length} 个外部资源，破坏"单文件自足"契约。`, externalRefs.slice(0, 5).join(', ')))
  }
  if (/<script\b[^>]*\bsrc=/i.test(clean)) {
    findings.push(finding('error', 'single-file', '通过 <script src> 引入外部脚本——图必须是自足的。'))
  }

  // ── Accessible SVG contract ───────────────────────────────────────────────
  const labelledBy = svg.match(/aria-labelledby\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!/role\s*=\s*["']img["']/i.test(svg)) {
    findings.push(finding('error', 'aria', '<svg> 缺少 role="img"。', '无障碍契约第 1 条。'))
  }
  if (labelledBy === undefined) {
    findings.push(finding('error', 'aria', '<svg> 缺少 aria-labelledby。', '无障碍契约第 1 条。'))
  }
  const titleMatch = svg.match(/<title\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/title>/i)
  const descMatch = svg.match(/<desc\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/desc>/i)
  if (titleMatch === null) {
    findings.push(finding('error', 'aria', '<svg> 里没有带 id 的 <title>。', '无障碍契约第 3 条：id 形如 <slug>-title。'))
  } else {
    if (titleMatch[2].trim().length === 0) findings.push(finding('error', 'aria', '<title> 是空的。'))
    if (titleMatch[2].trim().length > 60) findings.push(finding('warn', 'aria', `<title> 有 ${titleMatch[2].trim().length} 字符，超过 60。`))
    if (/^(title|desc)$/i.test(titleMatch[1])) findings.push(finding('error', 'aria', `<title> 的 id 是裸的 "${titleMatch[1]}"——必须按图/变体加前缀。`, '无障碍契约第 3 条。'))
  }
  if (descMatch === null) {
    findings.push(finding('error', 'aria', '<svg> 里没有带 id 的 <desc>。', '无障碍契约第 3 条。'))
  } else if (descMatch[2].trim().length === 0) {
    findings.push(finding('error', 'aria', '<desc> 是空的。'))
  }
  if (labelledBy !== undefined) {
    const ids = labelledBy.trim().split(/\s+/)
    const present = new Set([titleMatch?.[1], descMatch?.[1]].filter(Boolean))
    const missing = ids.filter((id) => !present.has(id))
    if (missing.length > 0) {
      findings.push(finding('error', 'aria', `aria-labelledby 指向不存在的 id：${missing.join(', ')}。`, '引用的 id 必须真的存在于该 <svg> 内。'))
    }
  }
  // <title> must be the first child of <svg> (before <defs>).
  const afterOpen = svg.replace(/^<svg\b[^>]*>/i, '')
  const firstElement = afterOpen.match(/<([a-zA-Z][\w:-]*)/)?.[1]?.toLowerCase()
  if (firstElement !== undefined && firstElement !== 'title') {
    findings.push(finding('error', 'aria', `<svg> 的第一个子元素是 <${firstElement}>，不是 <title>。`, '无障碍契约第 2 条。'))
  }

  // ── viewBox and containment ───────────────────────────────────────────────
  const viewBox = parseViewBox(svg)
  if (viewBox === null) {
    findings.push(finding('error', 'viewBox', '<svg> 缺少合法的 viewBox。'))
  } else {
    if (viewBox.width % GEOMETRY.grid !== 0 || viewBox.height % GEOMETRY.grid !== 0) {
      findings.push(finding('warn', 'grid', `viewBox 尺寸 ${viewBox.width}×${viewBox.height} 不是 ${GEOMETRY.grid} 的整数倍。`))
    }
    // Content painted outside the frame is invisible in the export and looks
    // like a rendering bug rather than an authoring one. Rectangles and circles
    // are the shapes with decidable extents.
    const outside = []
    for (const rect of numbersOf(svg, 'rect')) {
      if (rect.width === undefined || rect.height === undefined) continue
      if (/%$/.test(String(rect.width)) || String(rect.width).includes('%')) continue
      const x = rect.x ?? 0
      const y = rect.y ?? 0
      if (x < viewBox.minX - 1 || y < viewBox.minY - 1
        || x + rect.width > viewBox.minX + viewBox.width + 1
        || y + rect.height > viewBox.minY + viewBox.height + 1) {
        outside.push(`rect(${x},${y},${rect.width}×${rect.height})`)
      }
    }
    for (const circle of numbersOf(svg, 'circle')) {
      if (circle.r === undefined) continue
      const x = circle.cx ?? 0
      const y = circle.cy ?? 0
      if (x - circle.r < viewBox.minX - 1 || y - circle.r < viewBox.minY - 1
        || x + circle.r > viewBox.minX + viewBox.width + 1
        || y + circle.r > viewBox.minY + viewBox.height + 1) {
        outside.push(`circle(${x},${y},r=${circle.r})`)
      }
    }
    if (outside.length > 0) {
      findings.push(finding('error', 'containment', `${outside.length} 个图元画到了 viewBox 之外（导出后不可见）。`, outside.slice(0, 4).join(', ')))
    }
  }

  // ── Connector rule 1: orthogonal only ─────────────────────────────────────
  const diagonals = []
  for (const line of numbersOf(svg, 'line')) {
    const { x1, y1, x2, y2 } = line
    if ([x1, y1, x2, y2].some((value) => value === undefined)) continue
    if (Math.abs(x1 - x2) > 0.5 && Math.abs(y1 - y2) > 0.5) diagonals.push(`line(${x1},${y1} → ${x2},${y2})`)
  }
  if (diagonals.length > 0) {
    const rule = CONNECTOR_RULES.find((entry) => entry.id === 'orthogonal')
    findings.push(finding('error', 'connector-orthogonal', `${diagonals.length} 条连线是斜线。${rule.text}`, diagonals.slice(0, 4).join(', ')))
  }

  // ── Arrow labels must sit on an opaque mask ───────────────────────────────
  // A label drawn straight over its own stroke bleeds through the line.
  //
  // This gate used to pass whenever the document contained ANY rect of positive
  // size — and every diagram has node boxes, so it could not fail. Worse, it
  // looked for `class*="arrow-label"`, which the generator never emitted. Two
  // defects deep, the gate was decorative. It now does real geometry: every
  // `arrow-label` text must be geometrically covered by some `label-mask` rect.
  const arrowLabels = []
  for (const match of svg.matchAll(/<text\b[^>]*\bclass\s*=\s*["'][^"']*arrow-label[^>]*>/gi)) {
    const tag = match[0]
    const x = Number(tag.match(/\bx\s*=\s*["'](-?[\d.]+)["']/i)?.[1])
    const y = Number(tag.match(/\by\s*=\s*["'](-?[\d.]+)["']/i)?.[1])
    arrowLabels.push({ tag, x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null })
  }
  const masks = []
  for (const rect of numbersOf(svg, 'rect')) {
    if (rect.__class === undefined || !/label-mask/.test(rect.__class)) continue
    if (rect.x === undefined || rect.y === undefined || rect.width === undefined || rect.height === undefined) continue
    masks.push(rect)
  }
  const uncovered = []
  for (const label of arrowLabels) {
    if (label.x === null || label.y === null) {
      uncovered.push('label 缺可判定的 x/y')
      continue
    }
    // 2px horizontal / 4px vertical slack: the text baseline sits a little
    // above the mask's bottom edge in the emitted markup.
    const covered = masks.some((m) =>
      label.x >= m.x - 2 && label.x <= m.x + m.width + 2
      && label.y >= m.y - 4 && label.y <= m.y + m.height + 4)
    if (!covered) uncovered.push(`label(${label.x},${label.y}) 无遮罩`)
  }
  if (arrowLabels.length > 0 && uncovered.length > 0) {
    const rule = CONNECTOR_RULES.find((entry) => entry.id === 'label-gap')
    findings.push(finding('error', 'connector-label-mask',
      `${uncovered.length}/${arrowLabels.length} 个箭头标签没有被任何 label-mask 遮罩盖住。${rule.text}`,
      uncovered.slice(0, 4).join(', ')))
  }

  // ── Grid compliance on structural geometry ────────────────────────────────
  const offGrid = []
  for (const rect of numbersOf(svg, 'rect')) {
    if (rect.width === undefined || rect.height === undefined) continue
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = rect[key]
      if (value === undefined) continue
      if (value % GEOMETRY.grid !== 0) {
        offGrid.push(`rect.${key}=${value}`)
        break
      }
    }
  }
  if (offGrid.length > 0) {
    findings.push(finding('warn', 'grid', `${offGrid.length} 个矩形的位置/尺寸不在 ${GEOMETRY.grid}px 网格上。`, offGrid.slice(0, 4).join(', ')))
  }

  // ── Universal anti-patterns ───────────────────────────────────────────────
  if (/box-shadow\s*:/i.test(clean)) {
    findings.push(finding('error', 'no-shadow', '用了 box-shadow。阴影出局，边框入场。'))
  }
  const bigRadii = []
  for (const rect of numbersOf(svg, 'rect')) {
    if (rect.rx !== undefined && rect.rx > GEOMETRY.radiusMax) bigRadii.push(`rx=${rect.rx}`)
  }
  for (const radius of clean.matchAll(/border-radius\s*:\s*(\d+)px/gi)) {
    if (Number(radius[1]) > GEOMETRY.radiusMax) bigRadii.push(`border-radius:${radius[1]}px`)
  }
  if (bigRadii.length > 0) {
    findings.push(finding('error', 'radius', `圆角超过 ${GEOMETRY.radiusMax}px（${bigRadii.slice(0, 3).join(', ')}）。圆角上限 6–10px，或者不要。`))
  }
  if (/JetBrains\s*Mono/i.test(clean)) {
    findings.push(finding('error', 'font-mono-abuse', '出现了 JetBrains Mono。等宽字体只用于技术内容，且绝不用 JetBrains Mono。'))
  }
  if (/writing-mode\s*:\s*(vertical|tb|sideways)/i.test(clean)) {
    findings.push(finding('error', 'vertical-text', '出现了竖排 writing-mode 文字。箭头上的竖排文字不可读。'))
  }
  if (/(?:#0(?:0|1|2)[0-9a-f]{4})[\s\S]{0,200}?(?:#(?:00ffff|0ff|ff00ff|f0f|c0c|cyan|magenta))/i.test(svg)) {
    findings.push(finding('warn', 'dark-glow', '疑似深色底 + 青/紫辉光的组合。那看起来"技术"，其实没做设计决策。'))
  }

  // ── Accent budget: 1–2 focal elements ─────────────────────────────────────
  // The gate used to resolve the accent hex with the skin hardcoded to light,
  // so a dark diagram's accent (a different hex) was never counted and the
  // budget silently no-opped. The skin is now read off the document's own
  // `--color-accent` declaration; when the document speaks in CSS variables
  // (which the generator emits), `var(--color-accent)` references are counted
  // too — after stripping <defs>, so the one accent marker def doesn't spend
  // the budget by existing.
  const declaredAccent = clean.match(/--color-accent\s*:\s*(#[0-9a-f]{3,8})/i)?.[1]
  const accentValues = []
  for (const skin of ['light', 'dark']) {
    const hex = roleValue('accent', skin)
    if (declaredAccent === undefined || declaredAccent.toLowerCase() === hex.toLowerCase()) accentValues.push(hex)
  }
  const svgWithoutDefs = svg.replace(/<defs\b[\s\S]*?<\/defs>/gi, '')
  const accentCount = accentValues.reduce((total, hex) => {
    const escaped = hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hexHits = svgWithoutDefs.match(new RegExp(escaped, 'gi'))?.length ?? 0
    const varHits = svgWithoutDefs.match(/var\(\s*--color-accent\b[^)]*\)/gi)?.length ?? 0
    return total + hexHits + varHits
  }, 0)
  if (accentCount > BUDGET.accent * 3) {
    findings.push(finding('warn', 'accent-budget', `焦点色出现了 ${accentCount} 次。焦点色是 1–2 处编者级强调，不是信号系统。`, '若每处都重要，就等于都不重要。'))
  }

  // ── Complexity budget ─────────────────────────────────────────────────────
  const nodeBoxes = (svg.match(/<rect\b[^>]*\bclass\s*=\s*["'][^"']*\bnode\b/gi) ?? []).length
  if (nodeBoxes > BUDGET.nodes) {
    findings.push(finding('warn', 'budget-nodes', `画了 ${nodeBoxes} 个节点，超过通用上限 ${BUDGET.nodes}。`, '拆成"总览 + 细节"两张图，永远优于把一张图挤小。'))
  }

  // ── Hosting contract: min-width, local scroller, print release ────────────
  const minWidth = clean.match(/svg\s*\{[^}]*min-width\s*:\s*(\d+)px/i)?.[1]
  if (viewBox !== null) {
    if (minWidth === undefined) {
      findings.push(finding('error', 'hosting-minwidth', 'svg 规则里没有 min-width。', '缺了它，窄屏会把整张图连同字号一起缩下去。'))
    } else if (Number(minWidth) !== viewBox.width) {
      findings.push(finding('error', 'hosting-minwidth', `min-width 是 ${minWidth}px，但 viewBox 宽 ${viewBox.width}——两者必须相等。`, '否则字号会被静默缩小。'))
    }
  }
  if (!/overflow-x\s*:\s*auto/i.test(clean)) {
    findings.push(finding('error', 'hosting-scroller', '没有局部 overflow-x: auto 滚动容器。', '否则窄屏滚的是整个页面，右边的节点就此消失。'))
  }
  if (!/@media\s+print/i.test(clean)) {
    findings.push(finding('warn', 'hosting-print', '没有 @media print 规则。', '纸上没有滚动条：打印时应放开 min-width 与 overflow-x，让它缩到整页可见。'))
  }

  // ── Motion contract ───────────────────────────────────────────────────────
  if (/<script\b/i.test(clean)) {
    if (!/prefers-reduced-motion/i.test(clean)) {
      findings.push(finding('error', 'motion-reduced', '带脚本（动效）但没有处理 prefers-reduced-motion。', '降低动效偏好下必须显示完整的静态帧。'))
    }
  }

  return finish(findings, options)
}

/** Assemble the report: findings plus the checks no parser can decide. */
function finish(findings, options = {}) {
  const errors = findings.filter((entry) => entry.level === 'error')
  const warns = findings.filter((entry) => entry.level === 'warn')

  // The editorial half of the checklist. Stated, not faked: these decide whether
  // the diagram is any GOOD, and no parser can answer them.
  const judgement = [
    '删减测试：还能删掉任何一个节点吗？两个总是同进同退的节点，其实是一个节点。',
    '删减测试：还能删掉任何一条连线吗？如果关系从布局上一眼可见，线就是多余的。',
    '删减测试：还能删掉任何一个标签吗？颜色或形状是否已经表达了它？',
    '选型测试：读者从这张图里学到的，会比一段写好的文字更多吗？如果不会，就别画。',
    '焦点测试：焦点色是否只用在 1–2 处？如果每处都重要，就等于都不重要。',
    '图例测试：图例是否覆盖了用到的每一种类型，且没有多余的？',
    '受众测试：节点名、子标签、连线标签是否处在同一个受众层级？',
  ]

  const limits = [
    '解析基于正则，面向本插件生成的结构化标记；手工改写或异常 HTML 可能绕过某些检查。',
    '几何检查覆盖 rect / circle / line 的数值属性；路径（path）内部坐标、transform 后的实际位置未纳入。',
    '颜色语义（"这个强调色是否用在了真正焦点的位置"）无法机械判定。',
    '"是否需要分区"、"该拆图还是缩图" 属编辑判断，报告只给预算计数，不给结论。',
    '对比度无法机械判定：本检查器不校验"文字颜色在其填充色上是否可读"。皮肤由 CSS 变量解析，生成器保证变量取值成对可读；手改变量可能做出暗底暗字。',
  ]

  return {
    ok: errors.length === 0,
    type: options.type ?? null,
    errors: errors.length,
    warnings: warns.length,
    findings,
    judgement,
    limits,
  }
}
