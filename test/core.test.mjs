/**
 * Core tests: the design system, the scaffold, the taste gate, the parsers.
 *
 * The load-bearing assertion is the scaffold round-trip: a generator that emits
 * documents its own checker fails on is worse than no generator, because it
 * teaches the wrong shape. Everything else here guards the data the tools print.
 *
 * Run: node --test test/
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDiagram } from '../src/core/check.js'
import { scaffold } from '../src/core/scaffold.js'
import { parseImport } from '../src/core/import.js'
import { BUDGET, CONNECTOR_RULES, ROLES } from '../src/core/tokens.js'
import { SIZES, sizeById } from '../src/core/sizes.js'

test('设计系统：语义角色齐全且明暗双值', () => {
  assert.ok(ROLES.length >= 8, `角色数 ${ROLES.length} 偏少`)
  // Values are either solid hex or rgba() — `rule` and `accent-tint` are
  // deliberately translucent, so both forms are legitimate.
  const isColour = (value) => /^#[0-9a-f]{6}$/i.test(value) || /^rgba?\([\d.,\s]+\)$/i.test(value)
  for (const role of ROLES) {
    assert.ok(isColour(role.light), `${role.role} 亮色不是颜色值：${role.light}`)
    assert.ok(isColour(role.dark), `${role.role} 暗色不是颜色值：${role.dark}`)
  }
})

test('设计系统：六条连线铁律一条不少', () => {
  assert.equal(CONNECTOR_RULES.length, 6)
  for (const rule of CONNECTOR_RULES) {
    assert.ok(rule.id.length > 0 && rule.text.length > 0 && rule.check.length > 0)
  }
})

test('复杂度预算：节点 9 / 箭头 12 / 焦点色 2', () => {
  assert.equal(BUDGET.nodes, 9)
  assert.equal(BUDGET.arrows, 12)
  assert.equal(BUDGET.accent, 2)
})

test('尺寸预设：id 唯一且默认档存在', () => {
  const ids = SIZES.map((size) => size.id)
  assert.equal(new Set(ids).size, ids.length, '尺寸预设 id 有重复')
  assert.ok(sizeById('doc-inline').id === 'doc-inline')
})

test('脚手架自洽：每个尺寸档生成的骨架都必须零 error', () => {
  for (const size of SIZES) {
    const html = scaffold({ title: `测试图 ${size.id}`, type: 'architecture', desc: '一句关于内容的话。', size: size.id })
    const report = checkDiagram(html, { type: 'architecture' })
    const errors = report.findings.filter((item) => item.level === 'error')
    assert.equal(errors.length, 0, `${size.id} 骨架有 error：${errors.map((item) => `${item.rule} ${item.message}`).join(' | ')}`)
  }
})

test('脚手架：明暗两套皮肤都零 error', () => {
  for (const skin of ['light', 'dark']) {
    const html = scaffold({ title: '皮肤测试', type: 'flowchart', desc: '验证皮肤切换。', skin })
    assert.equal(checkDiagram(html, {}).errors, 0, `${skin} 皮肤有 error`)
  }
})

test('自检能抓到坏文档（关卡不是摆设）', () => {
  const bad = '<!DOCTYPE html><html><head><title>x</title></head><body><svg viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10"/></svg></body></html>'
  const report = checkDiagram(bad, {})
  assert.ok(report.errors > 0, '缺少无障碍契约的文档竟然通过了')
  assert.ok(report.findings.some((item) => item.level === 'error'))
  assert.ok(report.judgement.length > 0, '编辑判断项不应为空')
  assert.ok(report.limits.length > 0, 'limits 不应为空')
})

test('导入：Mermaid flowchart 提取节点与带标签的连线', () => {
  const source = ['flowchart LR', '  A[客户端] -->|HTTPS| B[网关]', '  B --> C[(订单库)]'].join('\n')
  const result = parseImport(source, 'auto', 'flow.mmd')
  assert.equal(result.ok, true)
  assert.equal(result.format, 'mermaid')
  const labels = result.nodes.map((node) => node.label)
  assert.deepEqual(labels, ['客户端', '网关', '订单库'])
  assert.equal(result.edges.length, 2)
  assert.equal(result.edges[0].label, 'HTTPS', '连线标签被吞掉了')
})

test('导入：sequenceDiagram 提取参与者与消息', () => {
  const source = ['sequenceDiagram', '  participant C as 客户端', '  participant S as 服务端', '  C->>S: POST /orders', '  S-->>C: 201'].join('\n')
  const result = parseImport(source, 'auto', 'seq.mmd')
  assert.equal(result.ok, true)
  assert.deepEqual(result.nodes.map((node) => node.label), ['客户端', '服务端'])
  assert.equal(result.edges.length, 2)
})

test('导入：draw.io 解析节点与边并还原人类标签', () => {
  const source = '<mxGraphModel><root>'
    + '<mxCell id="a" value="入口" vertex="1" style="rounded=0"/>'
    + '<mxCell id="b" value="出口" vertex="1"/>'
    + '<mxCell id="e" edge="1" source="a" target="b" value="走"/>'
    + '</root></mxGraphModel>'
  const result = parseImport(source, 'auto', 'x.drawio')
  assert.equal(result.format, 'drawio')
  assert.equal(result.nodes.length, 2)
  assert.deepEqual(result.edges[0], { from: '入口', to: '出口', label: '走' })
})

test('导入：Excalidraw 坏 JSON 返回失败而不是抛异常', () => {
  const result = parseImport('{ not json', 'excalidraw', 'x.excalidraw')
  assert.equal(result.ok, false)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('导入：超预算时给出预算提示', () => {
  const lines = ['flowchart LR']
  for (let i = 0; i < 14; i += 1) lines.push(`  N${i} --> N${i + 1}`)
  const result = parseImport(lines.join('\n'), 'auto', 'big.mmd')
  assert.ok(result.budgetFlags.some((flag) => flag.includes('超过通用上限')), '超预算竟然没提示')
})
