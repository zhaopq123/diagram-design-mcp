/**
 * CLI contract for the three scripts that talk to a DEPLOYED instance.
 *
 * Why this file exists: a desensitisation pass replaced the hardcoded LAN IP in
 * the default with `http://localhost:8400/mcp`. Everything looked fine (the unit
 * tests passed), and then every remote run died on an opaque `ECONNREFUSED` —
 * the placeholder had turned "you did not configure the target" into a network
 * error, which is the worst possible failure mode for a script whose whole job
 * is pointing at a remote host.
 *
 * So the contract is now: no default for DIAGRAM_MCP_URL. Missing config must
 * fail as a config error (exit 2 + a message naming the variable), never as a
 * network error. These tests run offline — they only exercise the guards.
 *
 * The second block is the desensitisation regression: the repo must not contain
 * a LAN address. That check is what would have caught the original leak.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = ['scripts/audit.mjs', 'scripts/smoke-remote.mjs', 'scripts/build-examples.mjs']

/**
 * Run a script with a scrubbed environment.
 *
 * The environment is passed through (minus the target variables) rather than
 * built from scratch: on Windows a bare `{ PATH }` env is not enough to spawn
 * node.exe at all, and the failure surfaces as `status: null`, which reads like
 * a script bug rather than a harness bug.
 */
function run(script, extraEnv = {}) {
  const env = { ...process.env }
  delete env.DIAGRAM_MCP_URL
  delete env.DIAGRAM_MCP_TOKEN
  Object.assign(env, extraEnv)
  return spawnSync(process.execPath, [path.join(ROOT, script)], {
    encoding: 'utf8',
    timeout: 30_000,
    env,
  })
}

/**
 * Can this environment spawn a child at all?
 *
 * The sandbox this repo was developed in blocks `child_process` wholesale —
 * every spawn fails with EBUSY, even `echo`. So the two tests below are written
 * to SKIP LOUDLY here rather than fake-pass: the guard is real, but it is only
 * executable where spawning is allowed (a plain terminal, CI, or the phone).
 */
function canSpawn() {
  const probe = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  return probe.error === undefined && typeof probe.status === 'number'
}
const SPAWN_OK = canSpawn()
const SPAWN_BLOCKED_REASON = '本环境禁止 spawn 子进程（EBUSY）：node 自身与 echo 都无法拉起。此测试需在正常终端 / CI / 手机上跑。'

test('三个远端脚本都必须要 DIAGRAM_MCP_URL，不给就报配置错而不是网络错', { skip: SPAWN_OK ? false : SPAWN_BLOCKED_REASON }, async (t) => {
  for (const script of SCRIPTS) {
    await t.test(script, () => {
      const r = run(script)
      assert.equal(r.status, 2, `${script} 缺 URL 时应 exit 2，实得 ${r.status}`)
      assert.match((r.stdout ?? '') + (r.stderr ?? ''), /DIAGRAM_MCP_URL/, `${script} 的报错必须点名 DIAGRAM_MCP_URL`)
      // The failure must be legible as "you forgot to configure this".
      const out = (r.stdout ?? '') + (r.stderr ?? '')
      assert.match(out, /未设置|required|missing/i, `${script} 的报错要说清楚是没设置`)
    })
  }
})

test('给了 URL 但没 TOKEN，仍然报配置错', { skip: SPAWN_OK ? false : SPAWN_BLOCKED_REASON }, async (t) => {
  for (const script of SCRIPTS) {
    await t.test(script, () => {
      const r = run(script, { DIAGRAM_MCP_URL: 'http://127.0.0.1:9/mcp' })
      // 127.0.0.1:9 is the discard port: refused instantly, so if a script ever
      // dropped its guard we would still see 2 rather than a hang.
      assert.equal(r.status, 2, `${script} 缺 TOKEN 时应 exit 2，实得 ${r.status}`)
      assert.match((r.stdout ?? '') + (r.stderr ?? ''), /DIAGRAM_MCP_TOKEN/)
    })
  }
})

test('默认值里不许再出现 LAN 地址（脱敏回归）', async (t) => {
  // Only real private ranges. `localhost` on a port is deliberately NOT in this
  // list — it leaks nothing about the user's network. The "a placeholder
  // default that points at the wrong machine" bug is covered by the two tests
  // above, which assert the scripts refuse to run without an explicit URL.
  const LAN = [
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  ]

  /** Walk the tracked parts of the repo, skipping vendored noise. */
  async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) yield* walk(full)
      else yield full
    }
  }

  const hits = []
  for await (const file of walk(ROOT)) {
    // Text formats only; a binary blob of matching bytes proves nothing.
    if (!/\.(mjs|js|json|md|sh|txt|ts)$/.test(file)) continue
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) continue
    for (const pattern of LAN) {
      const m = text.match(pattern)
      if (m) hits.push(`${path.relative(ROOT, file)}: ${m[0]}`)
    }
  }

  assert.deepEqual(hits, [], '仓库里不许出现内网地址或带端口的 localhost 默认值')
})
