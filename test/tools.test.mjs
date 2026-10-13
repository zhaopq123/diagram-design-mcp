/**
 * Tool-contract tests.
 *
 * These exist because the host environment has a documented history of strict
 * upstream models rejecting an entire request when a tool definition contains
 * `outputSchema`, `anyOf` or `oneOf`. That failure is silent and total — the
 * tools simply never become callable. A schema regression must therefore fail
 * here rather than in production.
 *
 * Run: node --test test/
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../src/tools.js'
import { checkDiagram } from '../src/core/check.js'

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]))

/** Walk a JSON Schema and collect every key used anywhere inside it. */
function collectKeys(node, found = new Set()) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, found)
    return found
  }
  for (const [key, value] of Object.entries(node)) {
    found.add(key)
    collectKeys(value, found)
  }
  return found
}

const FORBIDDEN_KEYS = ['anyOf', 'oneOf', 'allOf', 'not', 'outputSchema', '$ref', '$defs', 'if', 'then', 'else']

test('工具清单：7 个，名字唯一且语义化', () => {
  assert.equal(TOOLS.length, 7, `工具数 ${TOOLS.length}，期望 7`)
  assert.equal(byName.size, TOOLS.length, '工具名有重复')
  for (const tool of TOOLS) {
    assert.match(tool.name, /^diagram_[a-z_]+$/, `${tool.name} 命名不符合约定`)
  }
})

test('工具契约：每个工具都有可读的描述与对象型 inputSchema', () => {
  for (const tool of TOOLS) {
    assert.ok(typeof tool.description === 'string' && tool.description.length >= 30, `${tool.name} 描述太短，模型无法判断何时调用`)
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} 的 inputSchema 不是 object`)
    assert.ok(tool.inputSchema.properties !== undefined, `${tool.name} 没有 properties`)
    for (const key of tool.inputSchema.required ?? []) {
      assert.ok(key in tool.inputSchema.properties, `${tool.name} 的 required "${key}" 不在 properties 里`)
    }
  }
})

test('工具契约：schema 里没有 outputSchema / anyOf / oneOf（严格模型会整包拒收）', () => {
  for (const tool of TOOLS) {
    const keys = collectKeys(tool.inputSchema)
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(!keys.has(forbidden), `${tool.name} 的 inputSchema 含 ${forbidden}——严格模型会拒掉整个请求`)
    }
    assert.equal(tool.outputSchema, undefined, `${tool.name} 暴露了 outputSchema`)
  }
})

test('工具契约：可选参数不得用联合类型表达', () => {
  for (const tool of TOOLS) {
    const walk = (node, path) => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}[${index}]`))
      if (Array.isArray(node.type)) assert.fail(`${tool.name}${path} 的 type 是数组（联合类型）`)
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
    }
    walk(tool.inputSchema, '')
  }
})

test('diagram_tokens：返回设计系统全文', async () => {
  const [block] = await byName.get('diagram_tokens').handler({})
  assert.equal(block.type, 'text')
  assert.match(block.text, /语义角色/)
  assert.match(block.text, /六条连线铁律/)
  assert.match(block.text, /中文标签/)
})

test('diagram_sizes：返回预设与降级顺序', async () => {
  const [block] = await byName.get('diagram_sizes').handler({})
  assert.match(block.text, /尺寸预设/)
  assert.match(block.text, /降级顺序/)
  assert.match(block.text, /宿主 CSS 契约/)
})

test('diagram_types：完整目录 45 种；中文关键词能命中', async () => {
  const [full] = await byName.get('diagram_types').handler({})
  assert.match(full.text, /图表类型目录（45 种）/)

  const [hit] = await byName.get('diagram_types').handler({ query: '时序' })
  assert.match(hit.text, /筛选："时序" → [1-9]/)

  const [byId] = await byName.get('diagram_types').handler({ ids: ['architecture'] })
  assert.match(byId.text, /architecture/)
})

test('diagram_scaffold：产出即合规——生成的 HTML 必须零 error', async () => {
  const blocks = await byName.get('diagram_scaffold').handler({ title: '订单链路', type: 'architecture', desc: '客户端到订单库的请求路径。' })
  assert.equal(blocks.length, 2, '骨架应返回「说明 + HTML 原文」两个内容块')
  const html = blocks[1].text
  assert.match(html, /^<!DOCTYPE html>/)
  const report = checkDiagram(html, { type: 'architecture' })
  assert.equal(report.errors, 0, `骨架自带 error：${report.findings.filter((item) => item.level === 'error').map((item) => item.rule).join(', ')}`)
})

test('diagram_scaffold：title 必填，且兜底路径不产出坏文档', async () => {
  const tool = byName.get('diagram_scaffold')
  assert.deepEqual(tool.inputSchema.required, ['title'], 'title 必须是必填参数，否则会生成无名图')
  // The transport rejects a call without `title`; if the handler is ever reached
  // without one it must still emit a document the gate accepts, not a fragment.
  const blocks = await tool.handler({})
  assert.equal(checkDiagram(blocks[1].text, {}).errors, 0, '兜底路径产出的文档竟然不通过自检')
})

test('diagram_check：能判失败、能判通过，并区分三类输出', async () => {
  const good = (await byName.get('diagram_scaffold').handler({ title: '通过用例' }))[1].text
  const [pass] = await byName.get('diagram_check').handler({ html: good, label: 'good.html' })
  assert.match(pass.text, /通过（无 error）/)
  assert.match(pass.text, /编辑判断/)
  assert.match(pass.text, /覆盖不到什么/)

  const [fail] = await byName.get('diagram_check').handler({ html: '<html><body><svg viewBox="0 0 10 10"></svg></body></html>' })
  assert.match(fail.text, /未通过/)
})

test('diagram_import：内容进、结构出', async () => {
  const [block] = await byName.get('diagram_import').handler({
    source: 'flowchart TD\n  A[下单] --> B{库存足?}\n  B -->|是| C[发货]',
    path: 'order.mmd',
  })
  assert.match(block.text, /导入摘要：order.mmd（mermaid）/)
  assert.match(block.text, /下单/)
  assert.match(block.text, /重画，不是转换/)
})

test('diagram_gallery：产出沙箱隔离的图库页，并内嵌自检结论', async () => {
  const one = (await byName.get('diagram_scaffold').handler({ title: '图一' }))[1].text
  const two = (await byName.get('diagram_scaffold').handler({ title: '图二', skin: 'dark' }))[1].text
  const [note, page] = await byName.get('diagram_gallery').handler({
    title: '我的图表',
    entries: [{ name: 'a.html', path: 'docs/a.html', html: one }, { name: 'b.html', html: two }],
  })
  assert.match(note.text, /2 张图/)
  const html = page.text
  assert.match(html, /我的图表/)
  assert.match(html, /a\.html/)
  assert.match(html, /b\.html/)
  assert.equal((html.match(/sandbox=""/g) ?? []).length, 2, '预览必须逐个沙箱隔离')
  assert.match(html, /机械自检/)
})
