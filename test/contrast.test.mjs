/**
 * Contrast gate: the semantic role table must clear the contrast contract in
 * BOTH skins.
 *
 * The contract is the reference project's (its `style-guide.md`, ported into
 * `diagram_tokens`): regular text ≥ 4.5:1, large text ≥ 3:1, essential
 * non-text marks ≥ 3:1, translucent tints and decorative rules exempt but
 * never the only carrier of meaning. `rgba()` values are composited over
 * `paper` before measuring — a value that clears the bar at full strength can
 * fail at 0.5 opacity.
 *
 * This gate exists because of where our table lives: upstream keeps a
 * hand-edited stylesheet and a CI script next to it. Ours is DATA that any
 * regeneration run can touch, and a drifted hex is invisible in review while
 * unreadable on a phone in daylight. The ratios `diagram_tokens` prints are
 * asserted here to the hundredth, so the doc text and the table cannot drift
 * apart silently.
 *
 * Exempt by definition (asserted only to still be parseable in core.test):
 * `paper` / `paper-2` (surfaces), `rule` / `rule-solid` (decorative borders),
 * `accent-tint` (translucent fill).
 *
 * Run: node --test test/
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { ROLES } from '../src/core/tokens.js'

/** sRGB channel (0–255) → linear-light value, WCAG 2.x. */
function srgb(channel) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb) {
  return 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2])
}

/** WCAG 2.x contrast ratio. Args: [r, g, b] arrays. */
function ratio(a, b) {
  const [lighter, darker] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(lighter) + 0.05) / (luminance(darker) + 0.05)
}

/** `#rrggbb` → [r, g, b]. Throws on anything else — the table is all hex here. */
function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  assert.ok(match !== null, `对比度门禁只认 #rrggbb，拿到：${hex}`)
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16))
}

/** Composite `rgba(r,g,b,a)` over an opaque [r,g,b] background. */
function composite(fg, alpha, bg) {
  return fg.map((channel, index) => alpha * channel + (1 - alpha) * bg[index])
}

const byRole = new Map(ROLES.map((entry) => [entry.role, entry]))

/** Roles that render text and must clear the regular-text threshold. */
const TEXT_ROLES = ['ink', 'muted', 'soft', 'accent', 'link']

/**
 * The ratios quoted in `diagram_tokens` (both in its contrast section and in
 * `diagram_check` 的 limits). Asserted to ±0.005 so a re-derived value must
 * round to the printed one.
 */
const DOCUMENTED = {
  light: { accent: 4.71, soft: 5.34, link: 6.13, muted: 6.11 },
  dark: { accent: 5.21, soft: 4.78, link: 4.76 },
}

test('对比度门禁：六个正文角色 × 两皮肤全部 ≥ 4.5:1', () => {
  for (const skin of ['light', 'dark']) {
    const paper = hexToRgb(byRole.get('paper')[skin])
    for (const role of TEXT_ROLES) {
      const value = byRole.get(role)[skin]
      assert.ok(/^#[0-9a-f]{6}$/i.test(value), `正文角色 ${role}.${skin} 不是实色：${value}`)
      const measured = ratio(hexToRgb(value), paper)
      assert.ok(measured >= 4.5, `${skin} ${role} 只有 ${measured.toFixed(2)}:1，低于 4.5:1（对 paper ${byRole.get('paper')[skin]}）`)
    }
  }
})

test('对比度门禁：ink-strong 在 0.85 accent 填充上也 ≥ 4.5:1', () => {
  // The fill it actually labels: accent at 0.85 composited over paper.
  for (const skin of ['light', 'dark']) {
    const paper = hexToRgb(byRole.get('paper')[skin])
    const fill = composite(hexToRgb(byRole.get('accent')[skin]), 0.85, paper)
    const measured = ratio(hexToRgb(byRole.get('ink-strong')[skin]), fill)
    assert.ok(measured >= 4.5, `${skin} ink-strong 在 0.85 accent 填充上只有 ${measured.toFixed(2)}:1`)
  }
})

test('对比度门禁：diagram_tokens 里印出的比率与实际一致（±0.005）', () => {
  for (const [skin, roles] of Object.entries(DOCUMENTED)) {
    const paper = hexToRgb(byRole.get('paper')[skin])
    for (const [role, documented] of Object.entries(roles)) {
      const measured = ratio(hexToRgb(byRole.get(role)[skin]), paper)
      assert.ok(
        Math.abs(measured - documented) <= 0.005,
        `${skin} ${role}：文档写 ${documented}:1，实算 ${measured.toFixed(3)}:1 —— 改表必须同步改 diagram_tokens 的对比度段落`,
      )
    }
  }
})

test('对比度门禁：豁免角色有明确的豁免身份（防误加）', () => {
  // If someone moves a text role into this list, the gate above stops covering
  // it silently. This pins the exempt set so that move requires a deliberate
  // edit here too.
  const exempt = ['paper', 'paper-2', 'rule', 'rule-solid', 'accent-tint', 'ink-strong']
  for (const role of exempt) assert.ok(byRole.has(role), `豁免清单里的 ${role} 不在表里`)
  for (const role of TEXT_ROLES) assert.ok(!exempt.includes(role), `${role} 不能既受检又豁免`)
  assert.equal(ROLES.length, 11, `角色数变了（${ROLES.length}）：新角色要么进 TEXT_ROLES，要么进豁免清单`)
})
