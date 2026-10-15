/**
 * Build the diagram-type catalogue from the reference skill's own type docs.
 *
 * WHY GENERATE INSTEAD OF HAND-WRITING
 * ------------------------------------
 * The catalogue has 45 entries, each with a "best for", a per-type budget, and
 * a list of anti-patterns. Transcribing those by hand is how a catalogue drifts
 * away from the documents it summarises — the failure mode the reference
 * project itself documents. Parsing the shipped docs keeps one source of truth.
 *
 * PORTED FROM dsh-diagram-design/tools/build-catalog.mjs and extended for the
 * L0 retrofit: an L0 agent cannot open references/*.md, so what the catalogue
 * carries IS the whole specification surface. Three additions:
 *   1. `sections` — the type docs' remaining rule-bearing chapters (Containment,
 *      Consultant special, Connector style, Dark mode, Focal rule, …), harvested
 *      under per-section and per-type caps so the JSON stays loadable.
 *   2. `semanticPatterns` — full pattern entries (triggers / required primitives /
 *      budget / anti-patterns / static fallback), not just the routing row.
 *   3. `budgetTable` — the per-type budget rows from layout-budget.md.
 *
 * Three parsing hazards this handles, each found the hard way against the real
 * documents (the first two silently produced a plausible-looking but wrong
 * catalogue, which is exactly why they are guarded rather than assumed):
 *   1. Headings carry numeric prefixes (`## 7. Anti-patterns`).
 *   2. Type docs embed YAML/SVG fences whose contents contain `#` lines that
 *      look like headings. Fences must be tracked.
 *   3. A section ends at the next heading of the SAME OR HIGHER level, not at
 *      the next heading of any level — otherwise a `###` sub-heading truncates
 *      the table above it.
 *
 * The generated JSON is committed, so a normal install needs no build step and
 * no reference checkout. Re-run only when the reference updates:
 *
 *   node scripts/build-catalog.mjs <path-to-reference-skill-dir>
 *
 * @module diagram-design-mcp/scripts/build-catalog
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const refDir = process.argv[2] ?? join(here, '..', '..', '_ref', 'diagram-design', 'skills', 'diagram-design')
const outFile = join(here, '..', 'src', 'core', 'catalog.json')

/** Split markdown into lines, marking which are inside a fenced code block. */
function fenceAwareLines(md) {
  let fence = null
  return md.split(/\r?\n/).map((line) => {
    const open = line.match(/^\s*(```+|~~~+)/)
    if (open !== null) {
      if (fence === null) fence = open[1][0]
      else if (fence === open[1][0]) fence = null
      return { line, inFence: true, isHeading: false, level: 0, text: '' }
    }
    const inFence = fence !== null
    const heading = inFence ? null : line.match(/^(#{1,6})\s+(.*)$/)
    return {
      line,
      inFence,
      isHeading: heading !== null,
      level: heading === null ? 0 : heading[1].length,
      text: heading === null ? '' : heading[2].trim(),
    }
  })
}

/** Normalize a heading for matching: drop a leading `1.` / `2.1` numbering. */
function normalizeHeading(text) {
  return text.replace(/^\d+(\.\d+)*\.?\s*/, '').trim()
}

/**
 * Body of the first heading whose normalized text matches `name` (case-insensitive,
 * trailing parenthetical allowed). Stops at the next heading of the same or
 * higher level.
 */
function section(md, name) {
  const lines = fenceAwareLines(md)
  const start = lines.findIndex(
    (entry) => entry.isHeading && normalizeHeading(entry.text).toLowerCase().startsWith(name.toLowerCase()),
  )
  if (start === -1) return ''
  const level = lines[start].level
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].isHeading && lines[i].level <= level) break
    body.push(lines[i].line)
  }
  return body.join('\n').trim()
}

/** Markdown bullets ("- x", "* x") as a plain string list, fence-aware. */
function bullets(text) {
  return fenceAwareLines(text)
    .filter((entry) => !entry.inFence)
    .map((entry) => entry.line.match(/^\s*[-*]\s+(.*)$/)?.[1])
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => plain(value))
}

/**
 * A section written as EITHER bullets or a two-column table, as `{ head, body }`.
 *
 * The type docs use both forms for the same kind of content — `type-loop.md`
 * lists its anti-patterns in a table while `type-sequence.md` writes its budget
 * as bullets. Reading only one form silently drops whole sections, which is how
 * the first pass produced a catalogue that looked complete and was not.
 *
 * A few docs (`deployment`, `story-map`) write their layout conventions as
 * prose instead. Those fall through to whole paragraphs, so a section is never
 * silently empty just because it chose the third form.
 */
function items(text) {
  const fromBullets = bullets(text).map((value) => ({ head: value, body: '' }))
  if (fromBullets.length > 0) return fromBullets
  const fromTable = tableRows(text)
    .filter((cells) => !/^(anti-pattern|limit)$/i.test(plain(cells[0])))
    .map((cells) => ({ head: plain(cells[0]), body: plain(cells[1] ?? '') }))
  if (fromTable.length > 0) return fromTable
  // Prose fallback: one item per paragraph, fence-aware.
  return fenceAwareLines(text)
    .filter((entry) => !entry.inFence)
    .map((entry) => entry.line)
    .join('\n')
    .split(/\n\s*\n/)
    .map((block) => plain(block))
    .filter((block) => block.length > 0)
    .map((block) => ({ head: block, body: '' }))
}

/** Markdown table rows (skipping the header row and the `---` separator). */
function tableRows(text) {
  const rows = fenceAwareLines(text)
    .filter((entry) => !entry.inFence && entry.line.trim().startsWith('|'))
    .map((entry) => entry.line.split('|').slice(1, -1).map((cell) => cell.trim()))
  return rows.filter(
    (cells) => cells.length > 1 && !cells.every((cell) => /^:?-+:?$/.test(cell) || cell === ''),
  )
}

/** Strip inline markdown emphasis/links/code from a single cell. */
function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dereference upstream document names before shipping.
 *
 * An L0 agent never gets the file system the upstream docs live on: what the
 * catalogue says is all it can know. Every `references/*.md` name therefore has
 * to name something reachable — a tool (`diagram_tokens` …) or the one doc this
 * package actually ships (SKILL.md). The hand-built catalogue this replaces was
 * dereferenced field by field; doing it mechanically here is what makes
 * regeneration safe to repeat, and the shipment gate in test/tools.test.mjs
 * enforces the same rule. Specific citation shapes run first, bare file names
 * after, then whitespace artifacts from the deletions are collapsed.
 */
function derefText(text) {
  let out = text
  // `references/` prefixes add nothing once the target is a tool name.
  out = out.replace(/references\//g, '')
  // Citation shapes that need more than a name swap.
  out = out.replace(/\(§6, primitives-core\.md\)/gi, '(§6; values from `diagram_tokens`)')
  out = out.replace(/\(SKILL\.md; markup (?:in|from) primitives-core\.md\)/gi, '(SKILL.md §6; values from `diagram_tokens`)')
  out = out.replace(/\(primitives-core\.md rule \d+\)/gi, '') // the sentence stands alone; the rule number is unreachable for L0
  out = out.replace(/semantic-patterns\.md\s*§\s*/gi, 'the `diagram_types` semantic-pattern routing for ')
  out = out.replace(/§\s*7\s+budget table in layout-budget\.md/gi, 'the per-type budget table in `diagram_types`')
  out = out.replace(/style-guide\.md\s*§\s*Node type → treatment/gi, 'the `diagram_tokens` nodeTreatments table')
  out = out.replace(/\(see primitive-annotation\.md\)/gi, '(callout role; see `diagram_tokens`)')
  out = out.replace(/\(see export-registry\.md\)/gi, '(export metadata)')
  out = out.replace(/recorded in the repository as ADR (\d+)/gi, 'recorded upstream as ADR $1')
  out = out.replace(/scripts\/[\w-]+\.py in the repository/gi, 'an upstream generator script (not in this package)')
  out = out.replace(/the pinned controller from assets\/template-motion\.html/gi, 'the pinned upstream motion controller')
  // Bare file names → the tool or section that actually carries them.
  out = out.replace(/`?type-([a-z0-9-]+)\.md`?('s)?/gi, 'the `$1` type$2')
  out = out.replace(/semantic-patterns\.md/gi, 'the `diagram_types` semantic-pattern routing')
  out = out.replace(/layout-budget\.md/gi, 'the per-type budget table in `diagram_types`')
  out = out.replace(/style-guide\.md/gi, '`diagram_tokens`')
  out = out.replace(/output-spec\.md/gi, '`diagram_sizes`')
  out = out.replace(/primitive-icons\.md/gi, 'the `diagram_icons` index')
  out = out.replace(/primitives-core\.md/gi, '`diagram_tokens`')
  out = out.replace(/primitive-annotation\.md/gi, 'the `diagram_tokens` callout role')
  out = out.replace(/primitive-terminal\.md/gi, 'the `diagram_tokens` terminal skin')
  out = out.replace(/primitive-sketchy\.md/gi, 'the sketchy variant (not in this package)')
  out = out.replace(/animation\.md/gi, 'the `diagram_tokens` motion budget')
  out = out.replace(/export-registry\.md/gi, 'the export metadata')
  // §-glue left behind when a doc pointer becomes a type pointer.
  out = out.replace(/the `([a-z0-9-]+)` type § /g, "the `$1` type's ")
  out = out.replace(/the `([a-z0-9-]+)` type §\d+(?:\.\d+)*/g, 'the `$1` type')
  // Grammar artifacts: "same as the the …" and a spliced-in phrase starting a
  // new sentence ("canopy. the `exploded` type's …").
  out = out.replace(/\bthe the\b/g, 'the')
  out = out.replace(/([.!?]\s+)the (`[a-z0-9-]+` type)/g, '$1The $2')
  // Whitespace / punctuation artifacts from the deletions.
  return out.replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+([).,;:])/g, '$1').replace(/ ,/g, ',')
}

/** Apply derefText to every string in the tree, except the provenance fields. */
function dereference(node, key = '') {
  if (typeof node === 'string') return derefText(node)
  if (Array.isArray(node)) return node.map((item) => dereference(item, key))
  if (node !== null && typeof node === 'object') {
    const out = {}
    for (const [childKey, value] of Object.entries(node)) {
      out[childKey] = childKey === 'upstreamDoc' || childKey === 'catalogNote' ? value : dereference(value, childKey)
    }
    return out
  }
  return node
}

/** Section names that hold a per-type complexity budget, in priority order. */
const BUDGET_SECTIONS = ['Complexity budget', 'Budget', 'Over-limit column']

/**
 * Headings already harvested into their own fields — anything else at `##`
 * level is a rule-bearing chapter the L0 catalogue must carry (an L0 agent has
 * no way to open the type doc itself). `Examples` is excluded on purpose: it
 * links asset files this package does not distribute.
 */
const COVERED_HEADINGS = new Set([
  'layout conventions', 'inputs — the parameter contract', 'complexity budget', 'budget',
  'over-limit column', 'anti-patterns', 'examples', 'message kinds', 'operators',
])

/** Per-section and per-type caps, so one long doc cannot balloon the JSON. */
const SECTION_ITEM_CAP = 20
const SECTION_CHAR_CAP = 2400
const TYPE_SECTION_CHAR_CAP = 6000

/** Every non-covered `##` chapter of a type doc, capped, in document order. */
function extraSections(md) {
  const lines = fenceAwareLines(md)
  const out = []
  let totalChars = 0
  for (let i = 0; i < lines.length; i += 1) {
    const entry = lines[i]
    if (!entry.isHeading || entry.level !== 2) continue
    const title = normalizeHeading(entry.text)
    if (COVERED_HEADINGS.has(title.toLowerCase())) continue
    const body = []
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].isHeading && lines[j].level <= 2) break
      body.push(lines[j].line)
    }
    const kept = []
    let chars = 0
    let truncated = false
    for (const item of items(body.join('\n'))) {
      const text = item.head + (item.body.length > 0 ? ` — ${item.body}` : '')
      if (kept.length >= SECTION_ITEM_CAP || chars + text.length > SECTION_CHAR_CAP) {
        truncated = true
        break
      }
      kept.push(text)
      chars += text.length
    }
    if (kept.length === 0) continue
    if (truncated) kept.push('（此处有截断）')
    if (totalChars + chars > TYPE_SECTION_CHAR_CAP) break
    totalChars += chars
    out.push({ title, items: kept })
  }
  return out
}

/**
 * Chinese aliases for each type id.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upstream catalogue is English-only, and this plugin's primary user is
 * Chinese. A search for 「时序」 or 「架构」 against an English-only catalogue
 * returns nothing, which makes the panel's search box and the `diagram_types`
 * query filter dead for exactly the audience the plugin is for.
 *
 * Found by TESTING, not by reading: the E2E query test passed against English
 * keywords and would have shipped a search box that silently failed in Chinese.
 * Kept as an explicit map rather than machine translation so each alias is a
 * term a user would actually type, not a literal gloss.
 */
const ZH_ALIASES = {
  architecture: ['架构', '架构图', '系统架构', '系统图', '组件图'],
  'architecture-delta': ['架构变更', '架构对比', '前后对比', '重构对比'],
  'it-state': ['it现状', '遗留系统', '现状图', 'it景观'],
  flowchart: ['流程图', '流程', '决策', '分支', '算法'],
  sequence: ['时序', '时序图', '交互', '消息', '调用链', 'api调用'],
  state: ['状态机', '状态', '状态图', '生命周期'],
  er: ['er图', '实体关系', '数据模型', '数据库设计'],
  timeline: ['时间线', '时间轴', '大事记', '里程碑'],
  swimlane: ['泳道', '跨职能', '交接'],
  quadrant: ['象限', '四象限', '优先级', '定位矩阵', '2x2'],
  radar: ['雷达图', '蜘蛛图', '多维评分', '能力评估'],
  polar: ['极坐标', '周期数据'],
  loop: ['循环', '飞轮', '增强回路', '反馈'],
  nested: ['嵌套', '包含', '层级包含', '范围'],
  tree: ['树', '树形', '层级', '父子', '分解'],
  'org-chart': ['组织架构', '组织图', '汇报关系', '团队'],
  layers: ['分层', '层叠', '技术栈', '抽象层'],
  exploded: ['爆炸图', '拆解', '装配'],
  'axonometric-plan': ['轴测', '平面图', '俯视图', '户型'],
  venn: ['韦恩图', '集合', '重叠', '交集'],
  pyramid: ['金字塔', '漏斗', '转化', '层级排名'],
  bar: ['柱状图', '条形图', '对比', '排名'],
  waterfall: ['瀑布图', '桥接', '增减', '预算'],
  treemap: ['树图', '矩形树图', '占比'],
  heatmap: ['热力图', '热图', '矩阵', '密度'],
  line: ['折线', '折线图', '趋势', '斜率图', '排行变化'],
  gantt: ['甘特', '甘特图', '排期', '计划', '进度'],
  scatter: ['散点', '散点图', '相关性', '气泡图', '分布'],
  'high-level': ['总览', '概览', '数据栈', '全景'],
  process: ['流程', '多角色', '顺序流程', '数据交接'],
  medallion: ['奖章', '数据分层', '质量层级'],
  'data-flow': ['数据流', '数据流图', '数据流向'],
  'dp-integration': ['数据平台', '集成拓扑', '源到消费者'],
  'dp-security-matrix': ['权限矩阵', '访问矩阵', '角色权限'],
  sankey: ['桑基', '桑基图', '流量', '分流', '汇聚'],
  fishbone: ['鱼骨', '鱼骨图', '根因', '因果'],
  wardley: ['wardley', '价值链', '演进图', '自建还是购买'],
  kanban: ['看板', 'wip', '在制品', '任务状态'],
  journey: ['用户旅程', '旅程图', '体验', '情绪曲线'],
  'service-blueprint': ['服务蓝图', '前后台', '可见线', '客户视角'],
  deployment: ['部署', '部署图', '拓扑', 'zone主机', '副本'],
  dependency: ['依赖', '依赖图', '调用关系', '扇入', '循环依赖'],
  'uml-class': ['uml', '类图', '继承', '组合'],
  'story-map': ['故事地图', '需求拆分', '发布规划'],
  'db-schema': ['数据库', '表结构', 'schema', '字段', '索引'],
}

const files = (await readdir(join(refDir, 'references'))).filter((name) => /^type-.*\.md$/.test(name))
const types = []
const sparse = []

for (const file of files.sort()) {
  const md = await readFile(join(refDir, 'references', file), 'utf8')
  const id = file.replace(/^type-/, '').replace(/\.md$/, '')
  const title = plain(md.match(/^#\s+(.+)$/m)?.[1] ?? id)
  const bestFor = plain(md.match(/^\*\*Best for:\*\*\s*(.+)$/m)?.[1] ?? '')

  // Anti-patterns: table or bullets, depending on the doc's generation.
  const antiPatterns = items(section(md, 'Anti-patterns'))

  // Budget: whichever of the known heading names this type uses.
  let budgetText = ''
  for (const name of BUDGET_SECTIONS) {
    const found = section(md, name)
    if (found.length > 0) {
      budgetText = found
      break
    }
  }
  const budget = items(budgetText)

  // Layout: conventional name, or the geometry-contract name the newer docs use.
  const layoutText = section(md, 'Layout conventions') || section(md, 'Inputs — the parameter contract')
  const layout = items(layoutText).map((item) => item.head)

  // Every remaining rule-bearing chapter (Containment, Consultant special, …).
  const sections = extraSections(md)

  const kinds = tableRows(section(md, 'Message kinds')).map((cells) => cells.map(plain))
  const operators = tableRows(section(md, 'Operators')).map((cells) => cells.map(plain))

  const zh = ZH_ALIASES[id] ?? []
  const entry = {
    id,
    title,
    bestFor,
    ...(zh.length > 0 ? { zh: { title: zh[0], aliases: zh } } : {}),
    upstreamDoc: `references/${file}`,
    layout,
    ...(sections.length > 0 ? { sections } : {}),
    antiPatterns,
    budget,
  }
  if (kinds.length > 0 || operators.length > 0) {
    entry.tables = { ...(kinds.length > 0 ? { messageKinds: kinds } : {}), ...(operators.length > 0 ? { operators } : {}) }
  }
  types.push(entry)

  // An entry with no "best for" or no anti-patterns is a parse miss, not a
  // type that genuinely lacks them. Surface it instead of shipping a gap.
  if (bestFor.length === 0 || antiPatterns.length === 0) {
    sparse.push(`${id}(${bestFor.length === 0 ? 'no-best-for' : ''}${antiPatterns.length === 0 ? ' no-anti' : ''})`)
  }
}

// The selection guide and the semantic-pattern router live in SKILL.md §3, as
// two tables in one section: the guide rows carry three cells (showing / use /
// reference), the router rows two (trigger / route). Splitting on the column
// count is what keeps one table's rows out of the other's.
const skill = await readFile(join(refDir, 'SKILL.md'), 'utf8')
const guideSection = section(skill, 'Selection: semantic pattern, then visual type')

const guide = tableRows(guideSection)
  .filter((cells) => cells.length >= 3)
  .map((cells) => ({ showing: plain(cells[0]), use: plain(cells[1]) }))
  .filter((row) => row.showing.length > 0 && !/^if you're showing/i.test(row.showing))

const semanticPatterns = tableRows(guideSection)
  .filter((cells) => cells.length === 2)
  .map((cells) => ({ trigger: plain(cells[0]), route: plain(cells[1]) }))
  .filter((row) => row.route.includes('→') && !/^(semantic pattern|behavioral trigger)/i.test(row.trigger))

// The routing row alone tells an L0 agent WHERE to look, not what the pattern
// requires. Merge in the full entry from semantic-patterns.md (each `## N. Name`
// chapter carries triggers / required primitives / budget / anti-patterns /
// static fallback as bolded labels).
const semanticMd = await readFile(join(refDir, 'references', 'semantic-patterns.md'), 'utf8')
const patternDetails = new Map()
{
  const lines = fenceAwareLines(semanticMd)
  for (let i = 0; i < lines.length; i += 1) {
    const entry = lines[i]
    if (!entry.isHeading || entry.level !== 2) continue
    const numbered = entry.text.match(/^\d+\.\s+(.+)$/)
    if (numbered === null) continue
    const body = []
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].isHeading && lines[j].level <= 2) break
      body.push(lines[j].line)
    }
    const text = body.join('\n')
    const grab = (label) => {
      const found = text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*]+:\\*\\*|$)`))
      return found === null ? '' : plain(found[1])
    }
    patternDetails.set(plain(numbered[1]).toLowerCase(), {
      triggers: grab('Selection triggers'),
      primitives: grab('Required primitives'),
      budget: grab('Complexity budget'),
      antiPatterns: grab('Anti-patterns'),
      staticFallback: grab('Static fallback'),
    })
  }
}
let patternMisses = 0
const semanticPatternsFull = semanticPatterns.map((row) => {
  // The route reads `Pattern name → Nearest visual type`; drop only the LAST
  // arrow segment. One route chains the pattern's own name internally
  // (`Unstructured input → structured artifact → Data flow`), so splitting on
  // the first arrow names the wrong chapter.
  const name = plain(row.route.split('→').slice(0, -1).join('→')).toLowerCase()
  const detail = patternDetails.get(name)
  if (detail === undefined) {
    patternMisses += 1
    return { ...row }
  }
  return { ...row, ...detail }
})

// The per-type budget table lives in layout-budget.md, not in the type docs —
// 29 of 45 type entries have an empty `budget` field for exactly that reason.
const budgetMd = await readFile(join(refDir, 'references', 'layout-budget.md'), 'utf8')
const budgetTable = tableRows(section(budgetMd, 'Complexity budget (per diagram)'))
  .filter((cells) => !/^limit$/i.test(plain(cells[0])))
  .map((cells) => ({ limit: plain(cells[0]), rule: plain(cells[1] ?? '') }))

const catalogue = dereference({
  generatedFrom: 'cathrynlavery/diagram-design (MIT)',
  catalogNote: 'upstreamDoc 记录的是上游 cathrynlavery/diagram-design 里的文档路径，仅用于溯源与再生成；本包不分发这些 .md 文件。给 agent 看的规范已内联在 layout / budget / sections / antiPatterns 字段里，语义模式完整条目在 semanticPatterns，逐类型预算上限在 budgetTable；需要具体数值取 diagram_tokens / diagram_sizes / diagram_icons。',
  typeCount: types.length,
  guide,
  semanticPatterns: semanticPatternsFull,
  budgetTable,
  types,
})
await writeFile(outFile, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8')
console.log(`catalogue: ${types.length} types · ${guide.length} guide rows · ${semanticPatternsFull.length} semantic patterns · ${budgetTable.length} budget rows`)
console.log(`  -> ${outFile}`)

// Mirror of the shipment gate (test/tools.test.mjs, 「目录门禁」): no `.md`
// mention may survive outside the two provenance fields. If this warns, do not
// ship this catalogue — the gate test will fail on the same strings.
{
  const offenders = []
  const scan = (node, path) => {
    if (typeof node === 'string') {
      if (!path.endsWith('.upstreamDoc') && !path.endsWith('.catalogNote')) {
        for (const mention of node.match(/[a-z0-9-]+\.md/g) ?? []) offenders.push(`${path} → ${mention}`)
      }
      return
    }
    if (Array.isArray(node)) { node.forEach((item, index) => scan(item, `${path}[${index}]`)); return }
    if (node !== null && typeof node === 'object') { for (const [key, value] of Object.entries(node)) scan(value, path ? `${path}.${key}` : key) }
  }
  scan(catalogue, '')
  if (offenders.length > 0) console.log(`WARN 目录门禁会挂：${offenders.length} 处悬空引用，如 ${offenders.slice(0, 3).join('；')}`)
  else console.log('OK 无悬空 .md 引用（目录门禁将全绿）')
}
if (sparse.length > 0) console.log(`WARN parse misses: ${sparse.join(', ')}`)
else console.log('OK every type has a best-for and at least one anti-pattern')
if (patternMisses > 0) console.log(`WARN ${patternMisses} semantic pattern rows had no matching detail chapter`)
else console.log(`OK all ${semanticPatternsFull.length} semantic patterns matched their detail chapters`)

// The alias map must cover every type and name nothing that does not exist. A
// typo here is invisible until a user searches that word and gets nothing —
// exactly the failure the map was added to fix.
const missingAliases = types.filter((type) => ZH_ALIASES[type.id] === undefined).map((type) => type.id)
const staleAliases = Object.keys(ZH_ALIASES).filter((id) => !types.some((type) => type.id === id))
if (missingAliases.length > 0) console.log(`WARN no Chinese aliases: ${missingAliases.join(', ')}`)
if (staleAliases.length > 0) console.log(`WARN aliases for unknown types: ${staleAliases.join(', ')}`)
if (missingAliases.length === 0 && staleAliases.length === 0) {
  console.log(`OK all ${types.length} types carry Chinese aliases`)
}
