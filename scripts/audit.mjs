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

// No default: this script talks to a *deployed* instance, and a placeholder
// default that silently points at localhost turns every run into an opaque
// ECONNREFUSED (that is exactly how it broke once). Same contract as TOKEN.
const RAW_URL = process.env.DIAGRAM_MCP_URL ?? ''
const BASE = RAW_URL.replace(/\/mcp$/, '')
const URL_ = `${BASE}/mcp`
const TOKEN = process.env.DIAGRAM_MCP_TOKEN ?? ''
if (RAW_URL.length === 0) {
  console.error('DIAGRAM_MCP_URL 未设置——这是打远端部署实例的脚本，必须显式给地址，例如：')
  console.error('  DIAGRAM_MCP_URL=http://<host>:8400/mcp')
  process.exit(2)
}
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

/**
 * Terminate sessions and REPORT failures instead of swallowing them.
 *
 * The previous version was `.catch(() => {})` on every call. When one DELETE
 * failed, the only visible symptom was "session count came back one higher than
 * the baseline" — a number that looked like a server-side leak, with no clue
 * that the cleanup itself had quietly failed. A cleanup that hides its own
 * errors turns a test bug into a false product bug.
 */
async function terminateAll(pairs, label) {
  const results = await Promise.all(pairs.map((pair) => pair.transport.terminateSession()
    .then(() => null)
    .catch((error) => String(error?.message ?? error))))
  const failed = results.filter((entry) => entry !== null)
  if (failed.length > 0) {
    console.log(`  info ${label}：${failed.length}/${pairs.length} 个终止失败 — ${failed.slice(0, 2).join('; ')}`)
  }
  return failed.length
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
  const { client, transport: mainTransport } = await connect()

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

  // ── 承诺是否兑现：不只是"没报错" ─────────────────────────────────────────
  // 上面那轮只断言自检无 error。自检判不了对比度，所以旧版"深画布 + 白盒 +
  // 暗字"的暗色文档同样能过——这条链路曾经对缺陷全绿。下面直接验用户能看到
  // 的东西：暗色文档必须真的是暗的，皮肤必须真的传到了图元上。
  section('工具层：皮肤承诺真的兑现（暗色得是暗的）')
  const lum = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '')
    if (m === null) return null
    const n = Number.parseInt(m[1], 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const paperOf = (html) => html.match(/--color-paper:\s*(#[0-9a-f]{6})/i)?.[1]
  const inkOf = (html) => html.match(/--color-ink:\s*(#[0-9a-f]{6})/i)?.[1]
  const bodyOf = (html) => html.slice(html.indexOf('<body>'))

  const lightDoc = (await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'skin light', type: 'architecture', desc: 'd', skin: 'light' } })).content[1].text
  const darkDoc = (await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'skin dark', type: 'architecture', desc: 'd', skin: 'dark' } })).content[1].text
  const lp = paperOf(lightDoc); const dp = paperOf(darkDoc)
  const li = inkOf(lightDoc); const di = inkOf(darkDoc)

  ok('两种皮肤的 --color-paper 不同', lp !== dp, `light=${lp} dark=${dp}`)
  ok('亮色 paper 确实是浅色（亮度 > 0.5）', (lum(lp) ?? -1) > 0.5, `luminance=${lum(lp)?.toFixed(3)}`)
  ok('暗色 paper 确实是深色（亮度 < 0.5）', (lum(dp) ?? 9) < 0.5, `luminance=${lum(dp)?.toFixed(3)}`)
  // 文字与底色的明暗必须相反，否则就是"暗底暗字"那种不可读文档。
  ok('亮色：深字压浅底', (lum(li) ?? 9) < (lum(lp) ?? -1), `ink=${li} paper=${lp}`)
  ok('暗色：浅字压深底', (lum(di) ?? -1) > (lum(dp) ?? 9), `ink=${di} paper=${dp}`)

  // 皮肤必须传到图元，而不是只改背景那一格。
  ok('暗色 body 里不残留亮色 paper/ink 硬编码', !bodyOf(darkDoc).includes(lp) && !bodyOf(darkDoc).includes(li),
    'body 段出现了亮色硬编码 → skin 没有贯穿到图元')
  ok('结构色走 CSS 变量（body 引用 var(--color-*)）', /var\(--color-/.test(bodyOf(darkDoc)),
    'body 段没有 var(--color-*) 引用')

  // ── 生成器必须发出检查器需要的钩子 ──────────────────────────────────────
  // 遮罩门禁曾经永远通过：它数"任意正尺寸矩形"，而节点盒子必然存在；它找的
  // class="arrow-label" 生成器又从未输出过。这条断言把两侧的契约钉在一起。
  section('工具层：生成器 ↔ 检查器契约（标签遮罩）')
  const maskedBody = [
    '<rect class="label-mask" x="160" y="104" width="80" height="16" fill="var(--color-paper)"/>',
    '<text class="arrow-label" x="200" y="116" font-size="8" text-anchor="middle">GET /v2</text>',
  ].join('\n')
  const maskedDoc = (await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'masked', type: 'architecture', desc: 'd', body: maskedBody } })).content[1].text
  const maskedReport = textOf(await client.callTool({ name: 'diagram_check', arguments: { html: maskedDoc } }))
  ok('有遮罩的标签不报 connector-label-mask', !maskedReport.includes('connector-label-mask'), '误报')

  const bareDoc = (await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'bare', type: 'architecture', desc: 'd', body: '<text class="arrow-label" x="200" y="116" font-size="8" text-anchor="middle">GET /v2</text>' } })).content[1].text
  const bareReport = textOf(await client.callTool({ name: 'diagram_check', arguments: { html: bareDoc } }))
  ok('没有遮罩的标签必须报 connector-label-mask', bareReport.includes('connector-label-mask'),
    '门禁放过了没有遮罩的标签 → 这条检查恒真')

  const offsetDoc = (await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'offset', type: 'architecture', desc: 'd', body: ['<rect class="label-mask" x="600" y="104" width="80" height="16" fill="var(--color-paper)"/>', '<text class="arrow-label" x="200" y="116" font-size="8" text-anchor="middle">GET /v2</text>'].join('\n') } })).content[1].text
  const offsetReport = textOf(await client.callTool({ name: 'diagram_check', arguments: { html: offsetDoc } }))
  ok('遮罩没盖住标签时仍要报（几何判定，不是数矩形）', offsetReport.includes('connector-label-mask'),
    '只问"图里有没有矩形"，没做几何覆盖判定')

  section('工具层：恶意内容不得穿透')
  const injected = await client.callTool({ name: 'diagram_scaffold', arguments: { title: 'x', type: 'architecture', desc: 'd', body: '</svg></body><script>alert(1)</script><svg>' } })
  const injectedHtml = injected.content[1].text
  const beforeSvgClose = injectedHtml.split('</svg>')[0]
  ok('body 注入的 <script> 落在 <svg> 内（不产生可执行脚本）', !beforeSvgClose.includes('<script>alert(1)</script>'), '注入逃出了 svg')

  const unicode = await client.callTool({ name: 'diagram_scaffold', arguments: { title: '🎯 标题 with émoji & 中文 & RTL: العربية', type: 'architecture', desc: 'd' } })
  ok('emoji / RTL / 混排标题可生成', unicode.content[1].text.startsWith('<!DOCTYPE html>'))

  // The audit's OWN client must not be left behind either. `client.close()`
  // does not send DELETE (that is the very behaviour asserted above), so a bare
  // close leaked exactly one session per run — and because the assertion below
  // compared against a same-run baseline, the accumulation was invisible:
  // 12 → 13 → 14 across three consecutive runs, every one "passing".
  await terminateAll([{ transport: mainTransport }], '审计主客户端')
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

  await terminateAll(clean, 'clean 组')
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
  await terminateAll(orphans, 'orphan 组')
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
    const failure = await pair.transport.terminateSession().then(() => null).catch((error) => String(error?.message ?? error))
    if (failure !== null) console.log(`  info burst-${i} 终止失败 — ${failure}`)
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
  // Absolute check against the count taken BEFORE this audit connected.
  // The same-run baseline above cannot see accumulation across runs — it moved
  // in lockstep with the leak and stayed green while the server crept up one
  // session per invocation.
  ok(
    '审计没有给服务留下净增量（跨轮绝对基线）',
    final.sessions <= before.sessions,
    `审计前 ${before.sessions} → 审计后 ${final.sessions}`,
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

main().catch((error) => {
  // A raw "fetch failed / ECONNREFUSED" reads like a server bug and sends you
  // digging through logs. In practice it is almost always one of three boring
  // things, so name them instead of dumping the stack and hoping.
  //
  // NOTE on the haystack: `AggregateError.cause` from undici has an empty
  // `message`, so `cause?.message ?? error?.message` yields "" and matches
  // nothing. Collect every candidate string instead of picking one.
  const cause = error?.cause
  const haystack = [
    error?.message,
    cause?.message,
    ...(Array.isArray(cause?.errors) ? cause.errors.map((e) => e?.message ?? e?.code) : [cause?.code]),
  ].filter(Boolean).join(' | ')
  const networkish = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EPIPE|Failed to parse URL|Invalid URL/i.test(haystack)

  console.error('\n[致命] 审计没跑完：', error?.message ?? error)
  if (networkish) {
    console.error('\n连不上目标。按这个顺序查，别先翻日志：')
    console.error(`  1. DIAGRAM_MCP_URL 现在指向 ${BASE || '(空)'} —— 地址对了吗？端口对吗？`)
    console.error('  2. 服务活着吗：curl <host>:<port>/health 应该返回 {"ok":true,...}')
    if (RAW_URL.length > 0 && !/^https?:\/\//i.test(RAW_URL)) {
      console.error(`  3. URL 缺 http(s) 前缀：${JSON.stringify(RAW_URL)}`)
    }
    console.error('  4. 代理：本机若设了 HTTP_PROXY，局域网地址会被代理拦掉，')
    console.error('     要加 env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy')
    if (cause?.code) console.error(`  (底层错误码 ${cause.code})`)
  }
  process.exit(1)
})
