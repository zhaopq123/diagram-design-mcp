/**
 * Remote end-to-end smoke test — talks to the DEPLOYED server over the LAN.
 *
 * Run:
 *   DIAGRAM_MCP_URL=http://<host>:8400/mcp \
 *   DIAGRAM_MCP_TOKEN=<token> \
 *   node scripts/smoke-remote.mjs
 *
 * Why a separate script from `node --test`: the unit tests import the pure
 * modules directly and never touch the network. This one is the only thing
 * that proves the *deployed* artifact works — handshake, auth, tool listing,
 * and every tool's return shape, all through a real MCP client.
 *
 * NOTE: the WorkBuddy sandbox exports HTTP_PROXY/HTTPS_PROXY. httpx/node fetch
 * would route a LAN address through that proxy and get a 404. Run with
 * `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// No default here. This script talks to the DEPLOYED server; a baked-in
// placeholder just turns a missing config into an opaque ECONNREFUSED.
const URL_ = process.env.DIAGRAM_MCP_URL ?? ''
const TOKEN = process.env.DIAGRAM_MCP_TOKEN ?? ''
if (URL_.length === 0) {
  console.error('DIAGRAM_MCP_URL 未设置——这个脚本打的是部署实例，必须显式给地址：')
  console.error('  DIAGRAM_MCP_URL=http://<host>:8400/mcp')
  process.exit(2)
}

let pass = 0
let fail = 0
const failures = []

function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ok   ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n── ${title} ──`)
}

/** Pull the concatenated text out of a tool result. */
const textOf = (result) => (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

const FORBIDDEN = ['outputSchema', 'anyOf', 'oneOf', 'allOf', '$ref']

async function main() {
  if (TOKEN.length === 0) {
    console.error('DIAGRAM_MCP_TOKEN 未设置')
    process.exit(2)
  }

  section('HTTP 层')
  const health = await fetch(URL_.replace(/\/mcp$/, '/health')).then((r) => r.json())
  ok('/health 可达且 ok=true', health.ok === true, JSON.stringify(health))
  ok('/health 报 8 个工具', health.tools === 8, `tools=${health.tools}`)

  const unauth = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  ok('无 token 被拒（401）', unauth.status === 401, `status=${unauth.status}`)

  const badToken = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer wrong-token-000' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  ok('错 token 被拒（401）', badToken.status === 401, `status=${badToken.status}`)

  section('MCP 握手')
  const transport = new StreamableHTTPClientTransport(new globalThis.URL(URL_), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  const client = new Client({ name: 'ddm-smoke', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  ok('initialize 成功', client.getServerVersion()?.name === 'diagram-design-mcp', JSON.stringify(client.getServerVersion()))

  section('工具清单契约（严格模型要求）')
  const { tools } = await client.listTools()
  ok('恰好 8 个工具', tools.length === 8, `count=${tools.length}`)
  const names = tools.map((t) => t.name).sort()
  const expected = ['diagram_check', 'diagram_gallery', 'diagram_icons', 'diagram_import', 'diagram_scaffold', 'diagram_sizes', 'diagram_tokens', 'diagram_types']
  ok('工具名齐全', JSON.stringify(names) === JSON.stringify(expected), names.join(','))

  for (const tool of tools) {
    const keys = Object.keys(tool)
    const bad = FORBIDDEN.filter((k) => keys.includes(k))
    ok(`${tool.name} 无禁忌字段`, bad.length === 0, bad.join(','))
    const schemaKeys = Object.keys(tool.inputSchema ?? {})
    const badSchema = FORBIDDEN.filter((k) => schemaKeys.includes(k))
    ok(`${tool.name} inputSchema 无禁忌`, badSchema.length === 0, badSchema.join(','))
    ok(`${tool.name} inputSchema.type=object`, tool.inputSchema?.type === 'object')
    ok(`${tool.name} 有 description`, typeof tool.description === 'string' && tool.description.length > 20)
  }

  const json = JSON.stringify(tools)
  ok('工具清单整体不含 oneOf/anyOf', !json.includes('"oneOf"') && !json.includes('"anyOf"'))

  section('工具调用')
  const tokens = await client.callTool({ name: 'diagram_tokens', arguments: {} })
  const tokensText = textOf(tokens)
  ok('diagram_tokens 返回设计系统', tokensText.includes('语义角色') && tokensText.includes('连线铁律'))
  ok('diagram_tokens 含网格规则', tokensText.includes('4px'))

  const sizes = await client.callTool({ name: 'diagram_sizes', arguments: {} })
  const sizesText = textOf(sizes)
  ok('diagram_sizes 返回预设', sizesText.includes('doc-inline') && sizesText.includes('安全区'))

  const iconIndex = await client.callTool({ name: 'diagram_icons', arguments: {} })
  const iconIndexText = textOf(iconIndex)
  ok('diagram_icons 索引不含内联标记', iconIndexText.includes('图标库索引') && !iconIndexText.includes('```svg'), iconIndexText.split('\n')[0])
  ok('diagram_icons 索引比标记便宜', iconIndexText.length < 8000, `len=${iconIndexText.length}`)

  const iconMarkup = await client.callTool({ name: 'diagram_icons', arguments: { names: ['database', 'firewall'] } })
  const iconMarkupText = textOf(iconMarkup)
  ok('diagram_icons 按名取到可嵌标记', iconMarkupText.includes('<svg') && iconMarkupText.includes('</svg>'))
  ok('diagram_icons 标记带来源与许可证', /MIT|CC0/.test(iconMarkupText))

  const iconZh = await client.callTool({ name: 'diagram_icons', arguments: { query: '数据库' } })
  ok('diagram_icons 中文别名可检索', textOf(iconZh).includes('`database`'), textOf(iconZh).split('\n')[0])

  const iconMiss = await client.callTool({ name: 'diagram_icons', arguments: { names: ['mail'] } })
  ok('diagram_icons 不编造缺失图标', textOf(iconMiss).includes('未找到'), textOf(iconMiss).slice(0, 120))

  const typesAll = await client.callTool({ name: 'diagram_types', arguments: {} })
  ok('diagram_types 全量目录', textOf(typesAll).includes('45'))

  const typesZh = await client.callTool({ name: 'diagram_types', arguments: { query: '时序' } })
  ok('diagram_types 中文关键词可用', /sequence|时序/i.test(textOf(typesZh)), textOf(typesZh).slice(0, 80))

  const typesIds = await client.callTool({ name: 'diagram_types', arguments: { ids: ['architecture'] } })
  ok('diagram_types 按 id 取详情', textOf(typesIds).includes('architecture'))

  const scaf = await client.callTool({ name: 'diagram_scaffold', arguments: { title: '冒烟测试图', type: 'architecture', desc: '端到端验证用。' } })
  ok('diagram_scaffold 返回两个内容块', scaf.content.length === 2, `blocks=${scaf.content.length}`)
  const scaffoldHtml = scaf.content[1].text
  ok('scaffold 第二块是完整 HTML', scaffoldHtml.startsWith('<!DOCTYPE html>') && scaffoldHtml.includes('</html>'))

  const check = await client.callTool({ name: 'diagram_check', arguments: { html: scaffoldHtml, label: 'smoke.html' } })
  const checkText = textOf(check)
  ok('scaffold 产物自检 0 error', checkText.includes('通过（无 error）'), checkText.split('\n')[2])

  // Negative cases. Each mutation is applied INSIDE the <svg> block only —
  // editing the document-level <head><title> proves nothing, because the
  // accessibility contract is about the SVG, not the page.
  const inSvg = (html, fn) => html.replace(/<svg\b[\s\S]*?<\/svg>/i, (block) => fn(block))
  const negatives = {
    '删 role="img"': inSvg(scaffoldHtml, (b) => b.replace(/\srole="img"/i, '')),
    '删 aria-labelledby': inSvg(scaffoldHtml, (b) => b.replace(/\saria-labelledby="[^"]*"/i, '')),
    '删 svg 内 <title>': inSvg(scaffoldHtml, (b) => b.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')),
    '删 svg 内 <desc>': inSvg(scaffoldHtml, (b) => b.replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/i, '')),
    '删 viewBox': inSvg(scaffoldHtml, (b) => b.replace(/\sviewBox="[^"]*"/i, '')),
    'labelledby 指向不存在的 id': inSvg(scaffoldHtml, (b) => b.replace(/aria-labelledby="[^"]*"/i, 'aria-labelledby="nope-title"')),
    '塞入 <script>': scaffoldHtml.replace('</body>', '<script>alert(1)</script></body>'),
    '塞入外链图片': scaffoldHtml.replace('</body>', '<img src="http://evil.example/x.png"></body>'),
    '删掉整个 <svg>': scaffoldHtml.replace(/<svg[\s\S]*?<\/svg>/i, ''),
  }
  for (const [name, mutated] of Object.entries(negatives)) {
    const report = await client.callTool({ name: 'diagram_check', arguments: { html: mutated, label: 'negative.html' } })
    const text = textOf(report)
    ok(`自检抓出「${name}」`, text.includes('未通过') && /ERROR/.test(text), text.split('\n')[2] ?? '')
  }

  const imported = await client.callTool({
    name: 'diagram_import',
    arguments: { source: 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]', path: 'flow.mmd' },
  })
  const importText = textOf(imported)
  ok('diagram_import 解析 mermaid', importText.includes('节点 4'), importText.split('\n')[2])
  ok('diagram_import 无幽灵节点', !importText.includes('B-') && !importText.includes('A-'), importText.slice(0, 200))

  const gallery = await client.callTool({
    name: 'diagram_gallery',
    arguments: { title: '冒烟图库', entries: [{ name: 'smoke.html', path: 'docs/smoke.html', html: scaffoldHtml }] },
  })
  ok('diagram_gallery 返回两个内容块', gallery.content.length === 2)
  const galleryHtml = gallery.content[1].text
  ok('gallery 含沙箱 iframe', galleryHtml.includes('sandbox=""') && galleryHtml.includes('srcdoc='))
  ok('gallery 是完整页面', galleryHtml.startsWith('<!DOCTYPE html>'))

  section('并发会话')
  const clients = await Promise.all(Array.from({ length: 4 }, async () => {
    const t = new StreamableHTTPClientTransport(new globalThis.URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } })
    const c = new Client({ name: 'ddm-parallel', version: '1.0.0' }, { capabilities: {} })
    await c.connect(t)
    const r = await c.callTool({ name: 'diagram_sizes', arguments: {} })
    await c.close()
    return textOf(r).length > 100
  }))
  ok('4 个并发会话各自可用', clients.every(Boolean))

  await client.close()

  console.log(`\n${'='.repeat(52)}`)
  console.log(`通过 ${pass} · 失败 ${fail}`)
  if (fail > 0) {
    console.log('失败项：')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log(`目标：${URL_}`)
}

main().catch((error) => {
  console.error('\n[致命] 冒烟测试崩了：', error)
  process.exit(1)
})
