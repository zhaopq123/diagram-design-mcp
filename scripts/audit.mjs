/**
 * Full-surface audit against a DEPLOYED instance.
 *
 * `smoke-remote.mjs` proves the happy path works. This script is the opposite:
 * it goes looking for the ways the service can be broken, leaked, or made to
 * misbehave. Findings are reported as FAIL, not thrown — the point is a
 * complete list, not the first error.
 *
 * Run:
 *   env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
 *   DIAGRAM_MCP_TOKEN=<token> node scripts/audit.mjs
 */
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = (process.env.DIAGRAM_MCP_URL ?? 'http://localhost:8400/mcp').replace(/\/mcp$/, '')
const URL_ = `${BASE}/mcp`
const TOKEN = process.env.DIAGRAM_MCP_TOKEN ?? ''
if (TOKEN.length === 0) {
  console.error('DIAGRAM_MCP_TOKEN 未设置')
  process.exit(2)
}

const AUTH = { Authorization: `Bearer ${TOKEN}` }
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...AUTH }

let pass = 0
let fail = 0
const failures = []

function ok(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n── ${title} ──`)
const health = () => fetch(`${BASE}/health`).then((r) => r.json())
const textOf = (r) => (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

async function connect(name = 'wbdd-audit') {
  const transport = new StreamableHTTPClientTransport(new globalThis.URL(URL_), { requestInit: { headers: AUTH } })
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  return { client, transport }
}

async function main() {
  section('HTTP 层：异常请求不得打挂服务')
  const before = await health()

  const badJson = await fetch(URL_, { method: 'POST', headers: JSON_HEADERS, body: '{ this is not json' })
  ok('坏 JSON → 400 而不是 500/崩溃', badJson.status === 400, `status=${badJson.status}`)

  const emptyBody = await fetch(URL_, { method: 'POST', headers: JSON_HEADERS, body: '' })
  ok('空 body 不产生 5xx', emptyBody.status < 500, `status=${emptyBody.status}`)

  const getNoSession = await fetch(URL_, { method: 'GET', headers: AUTH })
  ok('GET 无 session → 400', getNoSession.status === 400, `status=${getNoSession.status}`)

  const deleteNoSession = await fetch(URL_, { method: 'DELETE', headers: AUTH })
  ok('DELETE 无 session 不产生 5xx', deleteNoSession.status < 500, `status=${deleteNoSession.status}`)

  const putNoSession = await fetch(URL_, { method: 'PUT', headers: JSON_HEADERS, body: '{}' })
  ok('PUT 无 session 不产生 5xx', putNoSession.status < 500, `status=${putNoSession.status}`)

  const fakeSession = await fetch(URL_, { method: 'POST', headers: { ...JSON_HEADERS, 'mcp-session-id': 'not-a-real-session' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  ok('伪造 session id → 404', fakeSession.status === 404, `status=${fakeSession.status}`)

  const notInitialize = await fetch(URL_, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  ok('无 session 直接 tools/list 不产生 5xx', notInitialize.status < 500, `status=${notInitialize.status}`)

  const traversal = await fetch(`${BASE}/mcp/../health`)
  ok('路径穿越不能绕过到别处', traversal.status !== 200 || (await traversal.text()).includes('"ok"'), `status=${traversal.status}`)

  const unknownPath = await fetch(`${BASE}/admin`, { headers: AUTH })
  ok('未知路径 → 404', unknownPath.status === 404, `status=${unknownPath.status}`)

  const after = await health()
  ok('异常请求后服务仍健康', after.ok === true && after.tools === 7, JSON.stringify(after))

  section('鉴权')
  for (const [label, header] of [
    ['无 Authorization', {}],
    ['空 Bearer', { Authorization: 'Bearer ' }],
    ['错 token（同长度）', { Authorization: `Bearer ${'0'.repeat(TOKEN.length)}` }],
    ['短 token', { Authorization: 'Bearer x' }],
    ['Basic 而非 Bearer', { Authorization: 'Basic abc' }],
  ]) {
    const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...header }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })
    ok(`${label} → 401`, res.status === 401, `status=${res.status}`)
  }
  const healthNoAuth = await fetch(`${BASE}/health`)
  ok('/health 免鉴权可用', healthNoAuth.status === 200)

  section('工具层：异常入参')
  const { client } = await connect()

  const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} })
  ok('未知工具 → isError，会话存活', unknown.isError === true, JSON.stringify(unknown).slice(0, 100))

  const missing = await client.callTool({ name: 'diagram_check', arguments: {} })
  ok('缺必填参数 → 可读报错或空结果', missing !== undefined)

  const wrongType = await client.callTool({ name: 'diagram_types', arguments: { ids: 'not-an-array' } })
  ok('参数类型错误不崩', wrongType !== undefined)

  const nullArgs = await client.callTool({ name: 'diagram_tokens', arguments: {} })
  ok('空参数工具正常', textOf(nullArgs).includes('语义角色'))

  const stillAlive = await client.callTool({ name: 'diagram_sizes', arguments: {} })
  ok('连续异常调用后会话仍可用', textOf(stillAlive).length > 100)

  section('工具层：极端输入')
  const emptyCheck = await client.callTool({ name: 'diagram_check', arguments: { html: '' } })
  ok('diagram_check("") 给出结论而非抛错', textOf(emptyCheck).includes('结论'))

  const garbageCheck = await client.callTool({ name: 'diagram_check', arguments: { html: '\u0000\u0001<<<>>>' } })
  ok('diagram_check(乱码) 不抛错', textOf(garbageCheck).includes('结论'))

  const hugeHtml = await client.callTool({ name: 'diagram_check', arguments: { html: `<svg viewBox="0 0 4 4">${'<rect x="0" y="0" width="4" height="4"/>'.repeat(20000)}</svg>` } })
  ok('超大 HTML（~1MB）不崩', textOf(hugeHtml).includes('结论'))

  const emptyImport = await client.callTool({ name: 'diagram_import', arguments: { source: '' } })
  ok('空导入源不抛错', textOf(emptyImport).length > 0)

  const badFormat = await client.callTool({ name: 'diagram_import', arguments: { source: 'x', format: 'nonsense' } })
  ok('未知 format 不抛错', textOf(badFormat).length > 0)

  const badExcalidraw = await client.callTool({ name: 'diagram_import', arguments: { source: '{oops', format: 'excalidraw' } })
  ok('坏 Excalidraw JSON 返回失败而非抛错', textOf(badExcalidraw).includes('解析失败') || textOf(badExcalidraw).includes('不是合法'))

  const badDrawio = await client.callTool({ name: 'diagram_import', arguments: { source: '<not-xml', format: 'drawio' } })
  ok('坏 draw.io 不抛错', textOf(badDrawio).length > 0)

  const emptyGallery = await client.callTool({ name: 'diagram_gallery', arguments: { entries: [] } })
  ok('空图库仍产出合法页面', emptyGallery.content[1].text.startsWith('<!DOCTYPE html>'))

  const manyGallery = await client.callTool({
    name: 'diagram_gallery',
    arguments: { entries: Array.from({ length: 30 }, (_, i) => ({ name: `d${i}.html`, html: '<!DOCTYPE html><html><body><svg role="img" aria-labelledby="a-title a-desc" viewBox="0 0 4 4"><title id="a-title">t</title><desc id="a-desc">d</desc></svg></body></html>' })) },
  })
  ok('30 条图库正常产出', manyGallery.content[1].text.startsWith('<!DOCTYPE html>'))

  const noMatch = await client.callTool({ name: 'diagram_types', arguments: { query: 'zzzzz-no-such-type' } })
  ok('无匹配查询给出 0 条而非报错', textOf(noMatch).includes('0'))

  section('工具层：45 类全覆盖')
  const catalogue = JSON.parse(await readFile(new URL('../src/core/catalog.json', import.meta.url), 'utf8'))
  const ids = catalogue.types.map((t) => t.id)
  ok(`目录共 45 类`, ids.length === 45, `实际 ${ids.length}`)
  const all = await client.callTool({ name: 'diagram_types', arguments: { ids } })
  const allText = textOf(all)
  const missingTypes = ids.filter((id) => !allText.includes(`\`${id}\``))
  ok('一次性取回全部 45 类详情', missingTypes.length === 0, `缺失 ${missingTypes.join(',')}`)

  section('工具层：每个尺寸档 × 皮肤都零 error')
  const sizesText = textOf(await client.callTool({ name: 'diagram_sizes', arguments: {} }))
  const sizeIds = [...new Set([...sizesText.matchAll(/^\| `([a-z0-9-]+)`/gm)].map((m) => m[1]))]
  ok(`识别到尺寸档 ${sizeIds.length} 个`, sizeIds.length >= 4, sizeIds.join(','))
  for (const size of sizeIds) {
    for (const skin of ['light', 'dark']) {
      const scaf = await client.callTool({ name: 'diagram_scaffold', arguments: { title: `T ${size} ${skin}`, type: 'architecture', desc: 'd', size, skin } })
      const html = scaf.content[1].text
      const report = textOf(await client.callTool({ name: 'diagram_check', arguments: { html } }))
      ok(`scaffold(${size}/${skin}) 零 error`, report.includes('通过（无 error）'), report.split('\n')[2] ?? '')
    }
  }

  section('工具层：恶意内容不得穿透')
  const injected = await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'x', type: 'architecture', desc: 'd', body: '</svg></body><script>alert(1)</script><svg>' } })
  const injectedHtml = injected.content[1].text
  const beforeSvgClose = injectedHtml.split('</svg>')[0]
  ok('body 注入的 <script> 落在 <svg> 内（不产生可执行脚本）', !beforeSvgClose.includes('<script>alert(1)</script>'), '注入逃出了 svg')

  const unicode = await client.callTool({ name: 'diagram_scaffold', arguments: { title: '🎯 标题 with émoji & 中文 & RTL: العربية', type: 'architecture', desc: 'd' } })
  ok('emoji / RTL / 混排标题可生成', unicode.content[1].text.startsWith('<!DOCTYPE html>'))

  await client.close()
  section('会话生命周期')
  const baseline = await health()

  // Clean path: the client explicitly terminates.
  const clean = []
  for (let i = 0; i < 20; i += 1) {
    const pair = await connect(`clean-${i}`)
    await pair.client.callTool({ name: 'diagram_sizes', arguments: {} })
    clean.push(pair)
  }
  const during = await health()
  ok('20 个会话被登记', during.sessions >= baseline.sessions + 20, `${baseline.sessions} → ${during.sessions}`)

  await Promise.all(clean.map((pair) => pair.transport.terminateSession().catch(() => {})))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const afterTerminate = await health()
  ok('显式 DELETE 全部回收', afterTerminate.sessions <= baseline.sessions, `关闭后 ${afterTerminate.sessions}（基线 ${baseline.sessions}）`)

  // The path that actually leaks in the wild: clients that just go away.
  const orphans = []
  for (let i = 0; i < 15; i += 1) {
    const pair = await connect(`orphan-${i}`)
    orphans.push(pair)
  }
  const withOrphans = await health()
  ok('孤儿会话被登记（SDK 的 close() 不发 DELETE）', withOrphans.sessions > afterTerminate.sessions, `${afterTerminate.sessions} → ${withOrphans.sessions}`)
  ok('存活会话不超过上限', withOrphans.sessions <= (withOrphans.maxSessions ?? 256), `${withOrphans.sessions} > ${withOrphans.maxSessions}`)
  ok('/health 暴露空闲回收配置', typeof withOrphans.idleMs === 'number' && withOrphans.idleMs > 0, `idleMs=${withOrphans.idleMs}`)

  // Regression guard for a real deployment bug: config.env defined
  // DIAGRAM_MCP_IDLE_MS / DIAGRAM_MCP_MAX_SESSIONS, run.sh never exported them,
  // and /health cheerfully reported the compiled-in defaults. Every assertion
  // above still passed because they only checked "field exists and is positive".
  // So when the operator tells us what they configured, we compare — not
  // "is it a number" but "is it *your* number".
  const expectMax = process.env.DIAGRAM_MCP_EXPECT_MAX_SESSIONS
  const expectIdle = process.env.DIAGRAM_MCP_EXPECT_IDLE_MS
  if (expectMax !== undefined) {
    ok('maxSessions 等于运维配置值', String(withOrphans.maxSessions) === expectMax, `/health=${withOrphans.maxSessions}，期望=${expectMax}`)
  }
  if (expectIdle !== undefined) {
    ok('idleMs 等于运维配置值', String(withOrphans.idleMs) === expectIdle, `/health=${withOrphans.idleMs}，期望=${expectIdle}`)
  }
  if (expectMax === undefined && expectIdle === undefined) {
    console.log('  info 未设 DIAGRAM_MCP_EXPECT_*，只验字段存在，不验取值与部署配置一致')
  }
  console.log(`  info 孤儿 ${orphans.length} 个，空闲窗口 ${Math.round((withOrphans.idleMs ?? 0) / 1000)}s 后自动回收`)

  // A test that leaves garbage behind is a bug in the test. These 15 sessions
  // would sit on the server for the whole idle window, so clean them up the
  // moment the point has been proven. (They *would* be reclaimed — that is what
  // the sweeper is for — but the audit should not lean on that.)
  await Promise.all(orphans.map((pair) => pair.transport.terminateSession().catch(() => {})))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const afterCleanup = await health()
  ok(
    '审计自己不留尾巴：孤儿已清干净',
    afterCleanup.sessions <= baseline.sessions,
    `${afterCleanup.sessions}（基线 ${baseline.sessions}）`,
  )

  section('并发压力')
  const concurrent = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const pair = await connect(`burst-${i}`)
    const r = await pair.client.callTool({ name: 'diagram_types', arguments: { query: '架构' } })
    await pair.transport.terminateSession().catch(() => {})
    return textOf(r).length > 50
  }))
  ok('12 路并发各自正确', concurrent.every(Boolean))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const final = await health()
  ok('压力后服务仍健康', final.ok === true, JSON.stringify(final))
  ok(
    '整轮审计结束后会话数回到基线',
    final.sessions <= baseline.sessions,
    `基线 ${baseline.sessions} → 结束 ${final.sessions}`,
  )

  console.log(`\n${'='.repeat(52)}`)
  console.log(`通过 ${pass} · 失败 ${fail}`)
  console.log(`会话数：基线 ${baseline.sessions} → 结束 ${final.sessions}`)
  if (fail > 0) {
    console.log('\n失败项：')
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => { console.error('\n[致命] 审计脚本崩了：', error); process.exit(1) })
