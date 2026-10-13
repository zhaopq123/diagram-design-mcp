/**
 * End-to-end transport test: spawn the real server and drive it with a real MCP
 * client.
 *
 * Unit tests prove the handlers are right. Only this proves the handshake is:
 * initialize, session id, tools/list, tools/call, and a 401 when the token is
 * missing. Those are the parts a host integration actually fails on.
 *
 * Run: node --test
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 18400
const TOKEN = 'test-token-0123456789abcdef'
const BASE = `http://127.0.0.1:${PORT}`

/** Start the server and wait until /health answers. */
async function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, DIAGRAM_MCP_PORT: String(PORT), DIAGRAM_MCP_BIND: '127.0.0.1', DIAGRAM_MCP_TOKEN: TOKEN, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))

  const deadline = Date.now() + 20000
  for (;;) {
    if (Date.now() > deadline) throw new Error(`服务未就绪，日志：\n${logs.join('')}`)
    try {
      const response = await fetch(`${BASE}/health`)
      if (response.ok) return child
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const countSessions = () => fetch(`${BASE}/health`).then((r) => r.json()).then((h) => h.sessions)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  const client = new Client({ name: 'diagram-test', version: '1.0.0' })
  return { client, transport }
}

test('端到端：真实 MCP 客户端能完成握手、列工具、调工具', async (t) => {
  const child = await startServer()
  t.after(() => child.kill('SIGTERM'))

  const { client, transport } = connect()
  t.after(() => client.close())

  await client.connect(transport)
  assert.ok(typeof transport.sessionId === 'string' && transport.sessionId.length > 0, '服务端没有下发 session id')

  const { tools } = await client.listTools()
  assert.equal(tools.length, 7)

  // The raw wire schema is what a strict upstream model actually sees — assert
  // on it, not on our local object, so the transport cannot rewrite anything in.
  const raw = JSON.stringify(tools)
  for (const forbidden of ['outputSchema', '"anyOf"', '"oneOf"', '"allOf"']) {
    assert.ok(!raw.includes(forbidden), `tools/list 里出现了 ${forbidden}`)
  }

  const tokens = await client.callTool({ name: 'diagram_tokens', arguments: {} })
  assert.equal(tokens.isError ?? false, false)
  assert.match(tokens.content[0].text, /六条连线铁律/)

  const scaffolded = await client.callTool({
    name: 'diagram_scaffold',
    arguments: { title: '端到端验证图', type: 'architecture', desc: '验证工具链打通。' },
  })
  assert.equal(scaffolded.content.length, 2, '骨架应返回说明 + HTML 两个内容块')
  const html = scaffolded.content[1].text
  assert.match(html, /^<!DOCTYPE html>/)

  const checked = await client.callTool({ name: 'diagram_check', arguments: { html, label: 'e2e.html' } })
  assert.match(checked.content[0].text, /通过（无 error）/, '生成器与自检器不自洽')

  const bad = await client.callTool({ name: 'diagram_import', arguments: { source: 'flowchart LR\n A --> B', path: 'a.mmd' } })
  assert.match(bad.content[0].text, /导入摘要：a\.mmd/)
})

test('端到端：无 token 或无 session 时被明确拒绝', async () => {
  const child = await startServer()
  try {
    const noToken = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    assert.equal(noToken.status, 401, '缺 token 竟然放行了')

    const wrongToken = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    assert.equal(wrongToken.status, 401, '错误 token 竟然放行了')

    const unknownPath = await fetch(`${BASE}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(unknownPath.status, 404)
  } finally {
    child.kill('SIGTERM')
  }
})

test('端到端：工具抛错不会打挂会话', async () => {
  const child = await startServer()
  try {
    const { client, transport } = connect()
    await client.connect(transport)
    // `entries` is required; a schema violation must surface as a tool error or
    // a rejected call — never as a dead server.
    const result = await client.callTool({ name: 'diagram_gallery', arguments: { entries: [{ name: 'x' }] } })
    assert.equal(result.isError ?? false, false, '空 html 条目应被容错处理')

    const stillAlive = await client.callTool({ name: 'diagram_sizes', arguments: {} })
    assert.match(stillAlive.content[0].text, /尺寸预设/)
    await client.close()
  } finally {
    child.kill('SIGTERM')
  }
})

test('会话生命周期：显式 DELETE 立即回收', async (t) => {
  const child = await startServer()
  t.after(() => child.kill('SIGTERM'))

  const { client, transport } = connect()
  await client.connect(transport)
  assert.equal(await countSessions(), 1, '会话未被登记')

  await transport.terminateSession()
  await sleep(300)
  assert.equal(await countSessions(), 0, 'DELETE 之后会话仍留在服务端')
})

test('会话生命周期：close() 不发 DELETE，空闲回收必须兜住', async (t) => {
  // Regression: sessions only died on DELETE. The SDK's `client.close()` does
  // not send one, and a killed client cannot — so a phone-hosted server leaked
  // one Server + transport per conversation, forever. A single audit run took
  // the live count from 11 to 63 with nothing reclaiming it.
  const child = await startServer({ DIAGRAM_MCP_IDLE_MS: '2000' })
  t.after(() => child.kill('SIGTERM'))

  const { client, transport } = connect()
  await client.connect(transport)
  assert.equal(await countSessions(), 1)

  await client.close()
  await sleep(400)
  assert.equal(await countSessions(), 1, 'SDK 行为变了：close() 现在会发 DELETE，本测试前提需复核')

  // Sweep runs every max(1s, idleMs/4) = 1s here, and the window is 2s.
  await sleep(4500)
  assert.equal(await countSessions(), 0, '空闲会话没有被回收——泄漏依旧')
})

test('会话生命周期：持续有流量就不该被回收', async (t) => {
  const child = await startServer({ DIAGRAM_MCP_IDLE_MS: '2000' })
  t.after(() => child.kill('SIGTERM'))

  const { client, transport } = connect()
  await client.connect(transport)

  // Keep talking for longer than the idle window.
  for (let i = 0; i < 5; i += 1) {
    await sleep(700)
    await client.callTool({ name: 'diagram_tokens', arguments: {} })
  }
  assert.equal(await countSessions(), 1, '活跃会话被误杀了')
  await client.close()
})

test('会话上限：超出上限淘汰最久未用的，不是无限增长', async (t) => {
  const child = await startServer({ DIAGRAM_MCP_MAX_SESSIONS: '3', DIAGRAM_MCP_IDLE_MS: '600000' })
  t.after(() => child.kill('SIGTERM'))

  const clients = []
  for (let i = 0; i < 6; i += 1) {
    const { client, transport } = connect()
    await client.connect(transport)
    clients.push(client)
  }
  const live = await countSessions()
  assert.ok(live <= 3, `上限 3，实际存活 ${live}`)

  // The most recently opened one must still work.
  const newest = clients.at(-1)
  const result = await newest.callTool({ name: 'diagram_sizes', arguments: {} })
  assert.match(result.content[0].text, /尺寸预设/)
  await Promise.all(clients.map((c) => c.close().catch(() => {})))
})
