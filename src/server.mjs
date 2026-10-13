/**
 * Streamable HTTP MCP server for the diagram tools.
 *
 * WHY THIS SHAPE
 * --------------
 * The host's other MCP servers are long-lived LAN services addressed by URL with
 * a Bearer token, so this one matches that contract instead of inventing a new
 * one. Sessions are stateful (`Mcp-Session-Id`) because that is what the
 * existing servers do and what clients are tested against.
 *
 * The server is deliberately stateless about *content*: it holds no user files.
 * See `src/tools.js` for why.
 *
 * @module workbuddy-diagram-design/src/server
 */

import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS } from './tools.js'

const NAME = 'workbuddy-diagram-design'
const VERSION = '1.0.0'

/** Refuse anything bigger than this. A gallery payload is the largest thing we expect. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const PORT = Number.parseInt(process.env.DIAGRAM_MCP_PORT ?? '8400', 10)
const HOST = process.env.DIAGRAM_MCP_BIND ?? '0.0.0.0'
const TOKEN = process.env.DIAGRAM_MCP_TOKEN ?? ''

if (TOKEN.length === 0) {
  console.error('[fatal] DIAGRAM_MCP_TOKEN 未设置——拒绝以无鉴权方式启动。')
  process.exit(2)
}

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]))

/** Constant-time bearer check. Length is compared first because timingSafeEqual throws on mismatch. */
function authorized(req) {
  const header = req.headers.authorization ?? ''
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  const offered = Buffer.from(header.slice(prefix.length).trim())
  const expected = Buffer.from(TOKEN)
  if (offered.length !== expected.length) return false
  return timingSafeEqual(offered, expected)
}

/** One MCP server instance per session, wired to the shared tool table. */
function buildServer() {
  const server = new Server(
    {
      name: NAME,
      version: VERSION,
      title: 'Diagram Design',
      description: '编辑级图表设计系统：设计规范、类型目录、合规骨架、机械自检、结构提取、图库页。',
    },
    {
      capabilities: { tools: {} },
      instructions: '用 diagram_types 选型，diagram_scaffold 起手，diagram_check 收尾。所有工具都是内容进、内容出，不读写调用方的文件系统。',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    if (tool === undefined) {
      return { content: [{ type: 'text', text: `未知工具：${request.params.name}` }], isError: true }
    }
    try {
      return { content: await tool.handler(request.params.arguments ?? {}) }
    } catch (error) {
      // A tool that throws must not kill the session: the caller gets a readable
      // failure and can correct its arguments.
      return {
        content: [{ type: 'text', text: `${tool.name} 执行失败：${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  })

  return server
}

/** sessionId → { server, transport, lastSeen, sessionId } */
const sessions = new Map()

/**
 * Session lifetime.
 *
 * A session is only removed when the client sends DELETE — and most clients
 * never do. The MCP SDK's own `client.close()` skips it (verified: an explicit
 * `terminateSession()` drops the count, `close()` does not), and a client that
 * is killed or loses the network cannot send anything at all. On a phone left
 * running for weeks that is an unbounded leak: one `Server` plus one transport
 * per conversation, forever. A single audit run took this from 11 to 63 live
 * sessions and nothing ever reclaimed them.
 *
 * So sessions now expire on inactivity, which is what the other MCP servers on
 * this host already do. `DIAGRAM_MCP_IDLE_MS` tunes the window;
 * `DIAGRAM_MCP_MAX_SESSIONS` is a hard ceiling that evicts the least recently
 * used session so a burst of connects cannot exhaust memory either.
 */
const IDLE_MS = Number.parseInt(process.env.DIAGRAM_MCP_IDLE_MS ?? String(30 * 60 * 1000), 10)
const MAX_SESSIONS = Number.parseInt(process.env.DIAGRAM_MCP_MAX_SESSIONS ?? '256', 10)

/** Idempotent teardown: whichever path gets here first wins. */
function closeSession(sessionId, reason) {
  const entry = sessions.get(sessionId)
  if (entry === undefined) return false
  sessions.delete(sessionId)
  try { entry.transport.close?.() } catch { /* already torn down */ }
  void entry.server.close().catch(() => {})
  console.log(`[session] closed ${sessionId} (${reason}, 共 ${sessions.size})`)
  return true
}

/** Make room by dropping the least recently used sessions. */
function evictForRoom() {
  while (sessions.size >= MAX_SESSIONS) {
    let victimId = null
    let oldest = Number.POSITIVE_INFINITY
    for (const [id, entry] of sessions) {
      if (entry.lastSeen < oldest) { oldest = entry.lastSeen; victimId = id }
    }
    if (victimId === null) return
    closeSession(victimId, 'evicted: at capacity')
  }
}

// Sweep at a quarter of the idle window, clamped to something sane.
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeen > IDLE_MS) closeSession(id, `idle > ${Math.round(IDLE_MS / 1000)}s`)
  }
}, Math.max(1000, Math.min(60000, Math.floor(IDLE_MS / 4))))
sweeper.unref()

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

/**
 * Read the request body with a hard size cap.
 *
 * On overflow this rejects and stops buffering — it deliberately does NOT
 * destroy the socket, because the caller still has to write a 413 to it and a
 * destroyed request cannot carry a response.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (chunk) => {
      if (aborted) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        aborted = true
        const error = new Error(`请求体超过上限 ${MAX_BODY_BYTES} 字节`)
        error.status = 413
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/** Open a session: fresh server + transport, registered once the id is assigned. */
function newSession() {
  let entry
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      entry.sessionId = sessionId
      entry.lastSeen = Date.now()
      evictForRoom()
      sessions.set(sessionId, entry)
      console.log(`[session] opened ${sessionId} (共 ${sessions.size})`)
    },
    onsessionclosed: (sessionId) => {
      closeSession(sessionId, 'client DELETE')
    },
  })
  const server = buildServer()
  entry = { server, transport, lastSeen: Date.now(), sessionId: undefined }
  transport.onerror = (error) => console.error('[transport]', error.message)
  // A transport that dies without a DELETE would otherwise stay in the map.
  transport.onclose = () => {
    if (typeof entry.sessionId === 'string') closeSession(entry.sessionId, 'transport closed')
  }
  return { server, transport }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      name: NAME,
      version: VERSION,
      tools: TOOLS.length,
      sessions: sessions.size,
      maxSessions: MAX_SESSIONS,
      idleMs: IDLE_MS,
    })
    return
  }

  if (url.pathname !== '/mcp') {
    json(res, 404, { ok: false, error: 'use /mcp' })
    return
  }

  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }))
    return
  }

  const sessionId = req.headers['mcp-session-id']
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    const existing = sessions.get(sessionId)
    if (existing === undefined) {
      json(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null })
      return
    }
    // Any traffic keeps the session alive; only silence expires it.
    existing.lastSeen = Date.now()
    try {
      await existing.transport.handleRequest(req, res)
    } catch (error) {
      console.error('[mcp] session request failed:', error instanceof Error ? error.message : error)
      if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
    }
    return
  }

  // No session id: this must be an initialize, which is always a POST.
  if (req.method !== 'POST') {
    json(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Mcp-Session-Id required' }, id: null })
    return
  }

  let parsedBody
  try {
    const raw = await readBody(req)
    parsedBody = raw.length === 0 ? undefined : JSON.parse(raw)
  } catch (error) {
    const status = error?.status ?? 400
    const message = error instanceof Error ? error.message : String(error)
    json(res, status, { jsonrpc: '2.0', error: { code: status === 413 ? -32001 : -32700, message: status === 413 ? message : `Parse error: ${message}` }, id: null })
    return
  }

  const { server, transport } = newSession()
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, parsedBody)
  } catch (error) {
    console.error('[mcp] initialize failed:', error instanceof Error ? error.message : error)
    // A session that failed to initialise must not linger.
    if (typeof transport.sessionId === 'string') closeSession(transport.sessionId, 'initialize failed')
    if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
  }
})

httpServer.listen(PORT, HOST, () => {
  console.log(`${NAME} ${VERSION} listening on http://${HOST}:${PORT}/mcp · ${TOOLS.length} tools · auth=Bearer`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[shutdown] ${signal}`)
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
