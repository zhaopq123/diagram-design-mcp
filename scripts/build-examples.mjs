/**
 * Build every example diagram plus the gallery page, through the real MCP
 * service over the network.
 *
 * This is the "does the product actually deliver" script: it exercises the
 * same path a user takes (scaffold → fill → check → gallery), and it FAILS
 * LOUDLY if any produced document has a mechanical error. A generator whose
 * own examples do not pass its own gate is teaching the wrong thing.
 *
 * Run:
 *   DIAGRAM_MCP_TOKEN=<token> node scripts/build-examples.mjs
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const URL_ = process.env.DIAGRAM_MCP_URL ?? 'http://192.168.3.35:8400/mcp'
const TOKEN = process.env.DIAGRAM_MCP_TOKEN ?? ''
if (TOKEN.length === 0) {
  console.error('DIAGRAM_MCP_TOKEN 未设置')
  process.exit(2)
}

const text = (result) => (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

const client = new Client({ name: 'wbdd-build-examples', version: '1.0.0' }, { capabilities: {} })
await client.connect(new StreamableHTTPClientTransport(new globalThis.URL(URL_), {
  requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
}))

const files = (await readdir('examples')).filter((name) => name.endsWith('.mjs')).sort()
await mkdir('examples', { recursive: true })

const built = []
let failed = 0

for (const file of files) {
  const module = await import(`../examples/${file}`)
  if (module.SPEC === undefined || module.BODY === undefined) {
    console.log(`跳过 ${file}（没有导出 SPEC / BODY）`)
    continue
  }
  const { slug, title, type, desc } = module.SPEC

  const scaffold = await client.callTool({
    name: 'diagram_scaffold',
    arguments: { title, type, desc, size: 'doc-inline', skin: 'light', fonts: 'web', body: module.BODY, legend: module.LEGEND ?? [] },
  })
  const html = scaffold.content[1].text

  const report = await client.callTool({ name: 'diagram_check', arguments: { html, label: `${slug}.html`, type } })
  const reportText = text(report)
  const verdict = reportText.split('\n')[2] ?? ''
  const errors = Number(/— (\d+) 个 error/.exec(reportText)?.[1] ?? '0')
  const warnings = Number(/· (\d+) 个 warn/.exec(reportText)?.[1] ?? '0')

  await writeFile(`examples/${slug}.html`, html, 'utf8')
  await writeFile(`examples/${slug}.check.md`, reportText, 'utf8')

  if (errors > 0) failed += 1
  console.log(`${errors === 0 ? '✔' : '✘'} ${slug.padEnd(16)} ${String(Buffer.byteLength(html)).padStart(6)} 字节  error=${errors} warn=${warnings}  ${verdict.replace(/\*\*/g, '')}`)
  if (errors > 0) console.log(reportText)

  built.push({ slug, title, html })
}

if (built.length > 0) {
  const gallery = await client.callTool({
    name: 'diagram_gallery',
    arguments: { title: 'Diagram Design 示例图库', entries: built.map((item) => ({ name: `${item.slug}.html`, path: `examples/${item.slug}.html`, html: item.html })) },
  })
  await writeFile('examples/gallery.html', gallery.content[1].text, 'utf8')
  console.log(`\n图库：examples/gallery.html（${built.length} 张图）`)
}

await client.close()

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 张图有 error`}`)
process.exit(failed === 0 ? 0 : 1)
