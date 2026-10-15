#!/usr/bin/env node
/**
 * Build `src/core/icons.json` from the upstream primitive icon document.
 *
 * The catalogue shipped in this package instructs the reader to use named icons,
 * but a remote MCP client cannot open `references/primitive-icons.md` — this
 * server runs on a phone and never touches the caller's filesystem. So the icon
 * set has to become data the tools can hand back inline.
 *
 * The source document is NOT part of this repository. Point the script at a
 * local checkout of `cathrynlavery/diagram-design`:
 *
 *   node scripts/build-icons.mjs path/to/references/primitive-icons.md
 *
 * Output is committed like `src/core/catalog.json`, so the package stays
 * self-contained and the provenance stays mechanical instead of hand-copied.
 */

import { readFile, writeFile } from 'node:fs/promises'

const DANGEROUS = [/<script/i, /\son[a-z]+\s*=/i, /javascript:/i, /<(?:iframe|embed|object)\b/i]
const EXTREF = /(?:xlink:)?href=/i

/**
 * Only icon sets whose license permits redistribution are shipped. Upstream
 * marks five icons `Direct fetch / <host> — verify license before use`; an
 * unverified license cannot be re-published from this MIT package, so those are
 * dropped rather than guessed at.
 */
const REDISTRIBUTABLE = /^(.+) \/ `(.+?)` \((.+)\)$/

/**
 * Chinese search aliases. Upstream's icon descriptions are English only, but the
 * readers of this server are not: an agent asked to draw 「数据库」 searches for
 * 「数据库」, and without these aliases it gets zero matches. Same reason
 * `catalog.json` carries `zh.aliases` per type.
 */
const ZH = {
  laptop: ['笔记本', '工作站'], phone: ['手机', '移动端'], desktop: ['桌面机', '电脑'],
  server: ['服务器', '宿主机'], container: ['容器'], vm: ['虚拟机'],
  user: ['用户', '人员'], users: ['用户群', '多用户', '团队'], admin: ['管理员'], robot: ['机器人', 'AI', '自动化'],
  cloud: ['云'], internet: ['互联网', '外网'], cdn: ['内容分发', '加速'], firewall: ['防火墙'],
  vpn: ['专线', '虚拟网络'], 'load-balancer': ['负载均衡'], gateway: ['网关'], dns: ['域名解析'],
  database: ['数据库'], file: ['文件'], log: ['日志'], queue: ['队列', '消息队列'], cache: ['缓存'],
  bucket: ['对象存储', '存储桶'], backup: ['备份'], search: ['检索', '搜索'],
  pod: ['容器组'], node: ['节点'], service: ['服务'], deployment: ['部署'], ingress: ['入口', '流量入口'], volume: ['存储卷', '数据卷'],
  api: ['接口'], request: ['请求'], response: ['响应'], sync: ['同步', '复制'], lock: ['锁', '幂等'],
  key: ['密钥', '鉴权', '凭证'], alert: ['告警'],
  'git-branch': ['分支', '版本控制'], terminal: ['终端', '命令行'], pipeline: ['流水线', '管道'],
  bug: ['缺陷', '故障'], monitoring: ['监控', '可观测'], test: ['测试'],
  docker: ['容器'], terraform: ['基础设施即代码'], aws: ['亚马逊云'], azure: ['微软云'],
  github: ['代码托管'], kubernetes: ['K8s', '集群'], gcp: ['谷歌云'], postgres: ['数据库'],
  redis: ['缓存'], nginx: ['反向代理'], gitea: ['代码托管'], keycloak: ['身份认证', '单点登录'],
  'active-directory': ['域控', 'AD'], minio: ['对象存储'], mysql: ['数据库'], oracle: ['数据库'],
  sqlserver: ['数据库'], sqlite: ['嵌入式数据库'], hive: ['数据仓库'], starrocks: ['分析型数据库'],
  nifi: ['数据流', 'ETL'], airflow: ['调度', '编排'], trino: ['查询引擎', '联邦查询'],
  superset: ['可视化', 'BI'], redash: ['报表', 'BI'], tableau: ['可视化', 'BI'], powerbi: ['微软 BI'], jupyter: ['笔记本', '建模'],
  python: ['脚本', '编程语言'], r: ['统计语言'], sql: ['查询语言'],
  spss: ['统计分析'], rstudio: ['开发环境'], qgis: ['地理信息', 'GIS'],
  excel: ['表格', 'xlsx'], csv: ['csv 文件'], txt: ['纯文本'],
}

function fail(message) {
  console.error(`build-icons: ${message}`)
  process.exit(1)
}

const source = process.argv[2]
if (!source) fail('用法：node scripts/build-icons.mjs <primitive-icons.md>')
// Upstream is checked out with CRLF on Windows; a stray \r breaks every
// anchored pattern below (`^```$` in particular), silently producing zero icons.
const text = (await readFile(source, 'utf8')).replace(/\r\n?/g, '\n')

const lines = text.split('\n')
const groups = []
let current = null
let pending = null

const usage = []
const skipped = []
for (const line of lines) {
  if (/^## (.+)$/.test(line) && !/^### /.test(line)) {
    const title = /^## (.+)$/.exec(line)[1].trim()
    if (title === 'Usage') { current = { title: null, usage: true }; continue }
    if (title === 'License attribution') { current = null; continue }
    current = { name: title, icons: [] }
    groups.push(current)
    continue
  }

  const iconTitle = /^### (.+)$/.exec(line)
  if (iconTitle && current?.icons) { pending = { name: iconTitle[1].trim(), desc: '', svg: '', source: '' }; continue }
  if (!pending) {
    if (current?.usage && line.trim().length > 0) usage.push(line.trim())
    continue
  }

  if (/^```svg/.test(line)) { pending.svg = ''; pending.inFence = true; continue }
  if (pending.inFence) {
    if (/^```$/.test(line)) { pending.inFence = false; continue }
    pending.svg += line.trim()
    continue
  }
  if (/^Source: /.test(line)) {
    pending.source = line.slice('Source: '.length).trim()
    current.icons.push(pending)
    pending = null
    continue
  }
  if (pending.svg.length === 0 && pending.desc.length === 0 && line.trim().length > 0) {
    pending.desc = line.trim()
  }
}

const licenses = []
for (const line of lines) {
  const m = /^- \*\*(.+?)\*\* — (.+?) — (.+)$/.exec(line.trim())
  if (m) licenses.push({ library: m[1], license: m[2], url: m[3] })
}

const out = { groups: [] }
for (const group of groups) {
  if (group.icons.length === 0) continue
  const icons = []
  for (const icon of group.icons) {
    if (icon.svg.length === 0) fail(`「${icon.name}」没有 svg 代码块`)
    for (const pattern of DANGEROUS) {
      if (pattern.test(icon.svg)) fail(`「${icon.name}」的标记里有可执行内容：${pattern}`)
    }
    if (EXTREF.test(icon.svg)) fail(`「${icon.name}」引用了外部资源（href），不接受`)
    if (!/^<svg\b/.test(icon.svg) || !/<\/svg>$/.test(icon.svg)) fail(`「${icon.name}」不是完整 <svg>`)
    const sourceMatch = REDISTRIBUTABLE.exec(icon.source)
    if (!sourceMatch) { skipped.push({ name: icon.name, group: group.name, source: icon.source }); continue }
    icons.push({
      name: icon.name,
      desc: icon.desc,
      zh: ZH[icon.name] ?? [],
      group: group.name,
      style: /stroke-width="1\.5"/.test(icon.svg) ? 'stroked' : 'filled',
      svg: icon.svg,
      upstream: sourceMatch[2],
      license: sourceMatch[3],
      library: sourceMatch[1],
    })
  }
  out.groups.push({ name: group.name, icons })
}

const flat = out.groups.flatMap((group) => group.icons)
// A parser that returns "success, zero rows" is how a format change becomes a
// silently empty shipped dataset.
if (flat.length === 0) fail('一个图标都没解析出来：源文档的结构可能已经变了，不要提交空数据集')
if (licenses.length === 0) fail('没解析到 License attribution 条目')
const names = new Set(flat.map((icon) => icon.name))
if (names.size !== flat.length) fail('图标名有重复')
const strayAlias = Object.keys(ZH).filter((key) => !names.has(key))
if (strayAlias.length > 0) fail(`中文别名表里有不存在的图标名（打错了？）：${strayAlias.join('、')}`)
const noAlias = flat.filter((icon) => icon.zh.length === 0).map((icon) => `${icon.group}/${icon.name}`)
if (noAlias.length > 0) console.log(`提示：${noAlias.length} 个图标没有中文别名 → ${noAlias.join('、')}`)

// Upstream's usage paragraph points at the markdown document's own structure
// (`### name` headings, fenced snippets) — that document is not shipped here, so
// those sentences would send the reader to a file that does not exist.
const usageText = `${usage
  .join('\n\n')
  .replace(/Find the icon by name[^.]*\.\s*Copy the fenced[^.]*\.\s*/g, '')
  .trim()}\n\n图标名就是这里的 \`name\` 字段；把要用的名字放进 \`diagram_icons\` 的 \`names\` 参数即可取到可直接嵌进图的 \`<svg>\` 标记。`

const json = {
  generatedFrom: 'cathrynlavery/diagram-design · skills/diagram-design/references/primitive-icons.md (MIT)',
  iconCount: flat.length,
  usage: usageText,
  licenses,
  excluded: skipped,
  icons: flat.map(({ name, desc, zh, group, style, svg, upstream, license, library }) => ({ name, desc, zh, group, style, svg, upstream, license, library })),
}

const target = new URL('../src/core/icons.json', import.meta.url)
await writeFile(target, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
console.log(`icons.json：${json.iconCount} 个图标 / ${out.groups.length} 组 / ${flat.filter((i) => i.style === 'stroked').length} 描边 · ${flat.filter((i) => i.style === 'filled').length} 填充`)
console.log(`许可来源：${licenses.map((l) => `${l.library}(${l.license})`).join(' · ')}`)
if (skipped.length > 0) console.log(`已剔除（许可证未确认，不可再分发）：${skipped.length} 个 → ${skipped.map((icon) => `${icon.group}/${icon.name}`).join('、')}`)
