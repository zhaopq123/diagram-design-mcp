/**
 * Regression tests for three real defects, all found by adversarial reading
 * rather than by a green suite. Each one passed every test that existed at the
 * time, which is the point: the checks that were supposed to catch them were
 * themselves broken.
 *
 * BUG-1  `skin` was half-wired. `scaffold()` computed `ink`/`muted`/`soft` per
 *        skin and then never used them; `diagramCss` hardcoded light `:root`
 *        values; `markerDefs()` / `node()` / `elbow()` / `legend()` hardcoded
 *        light fills. Only the backdrop rect honoured `skin`. So `skin:dark`
 *        produced a dark canvas with WHITE node boxes and DARK text on them —
 *        contrast ratio zero, document unreadable — while `diagram_check`
 *        reported 0 errors. The `SKIN` constant was exported and used nowhere.
 *
 * BUG-2  The arrow-label mask gate could not fail. It counted "any rect with
 *        positive width and height", and every diagram has node boxes, so the
 *        condition was always satisfied. Worse: it looked for
 *        `class*="arrow-label"`, which `elbow()` never emitted — so it could
 *        not even see the labels the generator produces. A gate that cannot
 *        fail is worse than no gate: it certifies compliance.
 *
 * BUG-3  The accent-budget gate called `roleValue('accent', 'light')` with the
 *        skin hardcoded. A dark diagram's accent is a different hex, so the
 *        count came back zero and the budget check silently no-opped for every
 *        dark diagram.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkDiagram } from '../src/core/check.js'
import { scaffold, node, elbow } from '../src/core/scaffold.js'
import { roleValue, ROLES } from '../src/core/tokens.js'

/** A minimal but complete document: everything except the body is scaffolded. */
function doc(body, spec = {}) {
  return scaffold({ title: '探针', desc: '一张用于测试的图。', ...spec, body })
}

// ── BUG-1: the dark skin must actually be dark ──────────────────────────────

test('BUG-1 暗色骨架的 CSS 变量必须是暗色值，而不是硬编码亮色', () => {
  const light = doc('')
  const dark = doc('', { skin: 'dark' })

  for (const entry of ROLES) {
    const varName = `--color-${entry.role}:`
    assert.match(dark, new RegExp(`${varName}\\s*${entry.dark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `暗色文档里 ${varName} 应为 ${entry.dark}（来自 ROLES 的 dark 列）`)
    assert.match(light, new RegExp(`${varName}\\s*${entry.light.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `亮色文档里 ${varName} 应仍为 ${entry.light}（不能顺手改坏）`)
  }
})

test('BUG-1 暗色骨架的箭头 marker 也要用暗色描边色', () => {
  const dark = doc('', { skin: 'dark' })
  // The emitted markup speaks in CSS variables; the dark `:root` is what makes
  // them resolve dark, and the var() refs are what let the shapes follow.
  assert.match(dark, /fill="var\(--color-muted\)"/, '默认箭头 marker 要引用 muted 变量')
  assert.match(dark, /fill="var\(--color-accent\)"/, '焦点箭头 marker 要引用 accent 变量')
  assert.match(dark, /fill="var\(--color-link\)"/, '外链箭头 marker 要引用 link 变量')
  assert.match(dark, /--color-muted:\s*#bfc0c0/, '暗色 :root 里 muted 必须解析为暗色值')
  assert.match(dark, /--color-link:\s*#739fdf/, '暗色 :root 里 link 必须解析为暗色值')
})

test('BUG-1 暗色骨架里的节点不能是白盒子深色字', () => {
  const dark = doc(node({ x: 40, y: 40, w: 120, h: 48, name: '甲' }), { skin: 'dark' })
  // A white fill on a dark canvas is the exact failure the user saw.
  assert.doesNotMatch(dark, /fill="#ffffff"/, '暗色文档里不允许出现 #ffffff 节点填充')
  // The node's own mask and name text must follow the dark palette.
  assert.match(dark, /fill="var\(--color-paper\)"/, '节点遮罩矩形要引用 paper 变量')
  assert.match(dark, /fill="var\(--color-ink\)"/, '节点名文字要引用 ink 变量')
})

test('BUG-1 elbow 的连线与标签在暗色下要用暗色描边', () => {
  const dark = doc(elbow({ from: [40, 200], to: [40, 320], label: 'HTTP' }), { skin: 'dark' })
  assert.match(dark, /stroke="var\(--color-muted\)"/)
  assert.match(dark, /--color-ink:\s*#f5f5f5/, '暗色 :root 里 ink 必须解析为亮色')
  assert.match(dark, /class="arrow-label"/, '标签要带 arrow-label 类，检查器才能看见它')
})

test('BUG-1 暗色文档必须通过机械自检（自检不能比生成器落后）', () => {
  const dark = doc([
    node({ x: 40, y: 40, w: 160, h: 48, name: '甲', treatment: 'focal', tag: 'api' }),
    node({ x: 240, y: 40, w: 160, h: 48, name: '乙', treatment: 'backend' }),
    elbow({ from: [200, 64], to: [240, 64], label: 'GET' }),
  ].join('\n'), { skin: 'dark', type: 'architecture' })
  const report = checkDiagram(dark, { type: 'architecture' })
  assert.equal(report.errors, 0, report.findings.filter((f) => f.level === 'error').map((f) => f.message).join('；'))
})

// ── BUG-2: the label-mask gate must be able to fail ─────────────────────────

test('BUG-2 elbow 生成的标签要带 arrow-label 类，否则检查器看不见它', () => {
  const out = elbow({ from: [40, 200], to: [40, 320], label: 'HTTP' })
  assert.match(out, /class="[^"]*arrow-label/, 'elbow 的 <text> 必须带 arrow-label 类')
  assert.match(out, /class="[^"]*label-mask/, 'elbow 的遮罩矩形必须带 label-mask 类')
})

test('BUG-2 有箭头标签但没有遮罩 → 必须报错', () => {
  const body = '<text class="arrow-label" x="200" y="120" font-size="8" text-anchor="middle">GET /v2</text>'
  const report = checkDiagram(doc(body))
  const hit = report.findings.find((f) => f.rule === 'connector-label-mask')
  assert.ok(hit, '没有遮罩的箭头标签必须被 connector-label-mask 抓到')
  assert.equal(hit.level, 'error')
})

test('BUG-2 标签被矩形真正盖住 → 不该报错', () => {
  const body = [
    // Mask first, then the label on top of it — the documented draw order.
    '<rect class="label-mask" x="160" y="104" width="80" height="16" fill="#f5f5f5"/>',
    '<text class="arrow-label" x="200" y="116" font-size="8" text-anchor="middle">GET /v2</text>',
  ].join('\n')
  const report = checkDiagram(doc(body))
  assert.ok(!report.findings.some((f) => f.rule === 'connector-label-mask'),
    '有遮罩时不应报错：' + (report.findings.find((f) => f.rule === 'connector-label-mask')?.message ?? ''))
})

test('BUG-2 遮罩与标签错开（遮不住）→ 仍要报错', () => {
  const body = [
    '<rect class="label-mask" x="600" y="104" width="80" height="16" fill="#f5f5f5"/>',
    '<text class="arrow-label" x="200" y="116" font-size="8" text-anchor="middle">GET /v2</text>',
  ].join('\n')
  const report = checkDiagram(doc(body))
  assert.ok(report.findings.some((f) => f.rule === 'connector-label-mask'),
    '遮罩没盖住标签时必须报错——几何必须真的覆盖，不能只问"图里有没有矩形"')
})

// ── BUG-3: accent budget must work on both skins ────────────────────────────

test('BUG-3 亮色图焦点色超预算要被点名', () => {
  let body = ''
  for (let i = 0; i < 7; i += 1) body += `<rect x="${40 + i * 8}" y="${40 + i * 8}" width="64" height="48" fill="${roleValue('accent', 'light')}"/>\n`
  const report = checkDiagram(doc(body))
  assert.ok(report.findings.some((f) => f.rule === 'accent-budget'), '亮色 accent 超预算必须被点名')
})

test('BUG-3 暗色图焦点色超预算也要被点名（以前写死 light，一次都数不到）', () => {
  let body = ''
  for (let i = 0; i < 7; i += 1) body += `<rect x="${40 + i * 8}" y="${40 + i * 8}" width="64" height="48" fill="${roleValue('accent', 'dark')}"/>\n`
  const report = checkDiagram(doc(body, { skin: 'dark' }))
  const hit = report.findings.find((f) => f.rule === 'accent-budget')
  assert.ok(hit, '暗色 accent 超预算必须被点名——写死 light 会让这条检查对暗色图静默空转')
})

test('BUG-3 accent 用得少 → 两种皮肤都不该报', () => {
  for (const skin of ['light', 'dark']) {
    const body = `<rect x="40" y="40" width="64" height="48" fill="${roleValue('accent', skin)}"/>`
    const report = checkDiagram(doc(body, { skin }))
    assert.ok(!report.findings.some((f) => f.rule === 'accent-budget'),
      `${skin} 皮肤下 1 处 accent 不应触发预算告警`)
  }
})

// ── BUG-6: fitViewBox must actually be called ───────────────────────────────

test('BUG-6 size=fit 给了内容宽高 → viewBox 按内容推导', () => {
  const html = doc('', { size: 'fit', contentWidth: 400, contentHeight: 300 })
  // fitViewBox rounds up to 4, adds 40px each side + 60px bottom legend
  // 400 → 400 (already divisible by 4) + 80 = 480
  // 300 → 300 + 80 + 60 = 440
  assert.match(html, /viewBox="0 0 480 440"/,
    'fit 预设给了 contentWidth=400 contentHeight=300，viewBox 应为 0 0 480 440')
  // min-width should equal the derived width, not a preset default
  assert.match(html, /min-width:\s*480px/, 'min-width 应等于推导出的 viewBox 宽度 480px')
})

test('BUG-6 size=fit 没给内容宽高 → 回退到默认画框', () => {
  const html = doc('', { size: 'fit' })
  // Without content dimensions, fit falls back to doc-inline's frame
  assert.match(html, /viewBox="0 0 960 600"/,
    'fit 预设没给内容宽高，应回退到 0 0 960 600')
  assert.match(html, /min-width:\s*960px/, '回退时 min-width 应为 960px')
})

test('BUG-6 fit 推导出的画框仍须通过机械自检', () => {
  const body = [
    node({ x: 40, y: 40, w: 160, h: 48, name: '甲', treatment: 'backend' }),
    node({ x: 240, y: 40, w: 160, h: 48, name: '乙', treatment: 'focal' }),
    elbow({ from: [200, 64], to: [240, 64] }),
  ].join('\n')
  const html = scaffold({
    title: 'fit 探针', desc: '测试 fit 预设的自检通过性',
    size: 'fit', contentWidth: 400, contentHeight: 100, body,
  })
  const report = checkDiagram(html)
  assert.equal(report.errors, 0,
    report.findings.filter((f) => f.level === 'error').map((f) => f.message).join('；'))
})
