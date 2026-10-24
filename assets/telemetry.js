#!/usr/bin/env node
/**
 * requirement-spec 遥测：采集、回填、汇聚与统计。
 *
 * 用途：把 skill 的执行过程（阶段耗时、返工、评审判定、缺陷、停点、独立性违规）
 * 落成可聚合的结构化事件，用来回答「团队用这个 skill 的效率如何、该改哪一段」。
 *
 * 三条铁律（协议里同样写死）：
 *   1. 只读侧信道：数据只从流程里流出，绝不回灌给任何子 agent，也不写进任务包。
 *   2. 失败不影响主流程：写入类命令永远退出码 0，内部异常只告警到 stderr。
 *   3. 不替代编排记录：编排记录.md 是给人看的审计留痕，这里是给机器算的。
 *
 * 存储位置（按 git 仓库维度）：
 *   优先：<仓库根>/docs/requirements/.telemetry/events.jsonl
 *   降级：~/.dsh/telemetry/requirement-spec/<目录名>/events.jsonl（不在 git 仓库里时）
 *   .gitignore 里加一行 `docs/requirements/.telemetry/` 即可整份退出版本控制。
 *
 * 用法：
 *   node assets/telemetry.js init   --req <需求标识> [--mode 主动|自动] [--tier S|M|L|不分级]
 *   node assets/telemetry.js stage-start --run <run_id> --stage 5a --role 评审
 *   node assets/telemetry.js stage-end   --run <run_id> --stage 5a --status 完成 [--rework 1]
 *   node assets/telemetry.js rework     --run <run_id> --stage 3 --round 1 --gaps "接口未定稿,缺回滚方案"
 *   node assets/telemetry.js issue      --run <run_id> --id CR-1 --level 阻断 --verdict 已修复
 *   node assets/telemetry.js recheck   --run <run_id> --round 1 --result 通过
 *   node assets/telemetry.js defect    --run <run_id> --source 6 --severity 严重 --introduced yes
 *   node assets/telemetry.js stop      --run <run_id> --type 硬阻塞 [--count 1] [--wait 600]
 *   node assets/telemetry.js violation --run <run_id> --type 复审新起实例 --stage 5d
 *   node assets/telemetry.js close     --run <run_id> --result 验收通过 [--agents 8]
 *   node assets/telemetry.js report    [--path <仓库或目录>]... [--json]
 *   node assets/telemetry.js parse    [--path docs/requirements/<需求标识>] [--force]
 *   node assets/telemetry.js where
 *
 * 退出码：
 *   0  成功（写入类命令即便内部失败也返回 0，不阻塞主流程）
 *   2  参数错误
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const HOME_DIR = os.homedir();
const CONFIG_PATH = path.join(HOME_DIR, '.dsh', 'telemetry', 'requirement-spec', 'config.json');
const FALLBACK_ROOT = path.join(HOME_DIR, '.dsh', 'telemetry', 'requirement-spec');

const WRITE_CMDS = new Set([
  'init', 'stage-start', 'stage-end', 'rework', 'issue', 'recheck',
  'defect', 'stop', 'abort', 'violation', 'close',
]);

const DEFAULTS = {
  // 按使用者选择：需求标识与作者明文存储。将来要脱敏改这里即可。
  maskReqId: false,
  anonymizeAuthor: false,
  // report --all 时扫描的根目录列表
  scanPaths: [],
};

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let k = a.slice(2);
    let v = null;
    const eq = k.indexOf('=');
    if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
    if (v === null) {
      const n = argv[i + 1];
      if (n !== undefined && !n.startsWith('--')) { v = n; i++; } else { v = 'true'; }
    }
    out[k] = v;
  }
  return out;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- 环境与存储

function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

function gitRoot(cwd) {
  return sh('git', ['rev-parse', '--show-toplevel'], cwd);
}

function skillSha() {
  return sh('git', ['rev-parse', '--short', 'HEAD'], SKILL_DIR) || 'unknown';
}

function author() {
  const cfg = loadConfig();
  if (cfg.anonymizeAuthor) return 'anon';
  return sh('git', ['config', 'user.name'], process.cwd()) || process.env.USER || 'unknown';
}

function loadConfig() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function resolveStore(cwd) {
  const root = gitRoot(cwd);
  if (root) {
    return {
      file: path.join(root, 'docs', 'requirements', '.telemetry', 'events.jsonl'),
      repo: path.basename(root),
      root,
      inGit: true,
    };
  }
  const name = path.basename(path.resolve(cwd)) || 'unknown';
  return { file: path.join(FALLBACK_ROOT, name, 'events.jsonl'), repo: name, root: null, inGit: false };
}

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

function appendEvent(file, evt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(evt) + '\n');
}

function maskReq(req) {
  const cfg = loadConfig();
  if (!cfg.maskReqId || !req) return req;
  return 'r_' + crypto.createHash('sha256').update(String(req)).digest('hex').slice(0, 12);
}

function nowIso() {
  return new Date().toISOString();
}

function makeRunId(req) {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(3).toString('hex');
  return `${String(req || 'req').replace(/[^a-zA-Z0-9_-]/g, '')}-${t}-${r}`;
}

// ---------------------------------------------------------------- 事件构造

function baseEvent(evt, run, extra) {
  return Object.assign({
    v: 1,
    ts: nowIso(),
    evt,
    run: run || null,
  }, extra || {});
}

function emit(evt) {
  try {
    const store = resolveStore(process.cwd());
    evt.repo = evt.repo || store.repo;
    appendEvent(store.file, evt);
    return evt;
  } catch (e) {
    process.stderr.write(`[telemetry] 写入失败（已忽略，不影响主流程）：${e.message}\n`);
    return evt;
  }
}

// 找到同 run 同 stage 最近一次未配对的 stage.start，用于算耗时
function lastPendingStart(file, run, stage) {
  const events = readEvents(file);
  let ts = null;
  for (const e of events) {
    if (e.run !== run || e.stage !== stage) continue;
    if (e.evt === 'stage.start') ts = e.ts;
    else if (e.evt === 'stage.end') ts = null;
  }
  return ts;
}

function runStartTime(file, run) {
  const events = readEvents(file);
  for (const e of events) {
    if (e.run === run && e.evt === 'run.start') return e.ts;
  }
  return null;
}

function durMs(fromIso, toIso) {
  // 两端都必须有值：缺 toIso 时曾经返回 0，会让「跑到一半中断」的需求伪装成 0 秒交付
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

// ---------------------------------------------------------------- 写入命令

function cmdInit(args) {
  const req = args.req || args._[0];
  if (!req) { process.stderr.write('[telemetry] init 需要 --req <需求标识>\n'); process.exit(2); }
  const store = resolveStore(process.cwd());
  const run = makeRunId(req);
  const evt = baseEvent('run.start', run, {
    req: maskReq(req),
    repo: store.repo,
    mode: args.mode || null,
    tier: args.tier || null,
    project: store.repo,
    author: args.author || author(),
    skill_sha: skillSha(),
    host: os.hostname(),
    src: 'l1',
  });
  emit(evt);
  process.stdout.write(run + '\n');
  return evt;
}

function cmdStageStart(args) {
  const run = args.run;
  const stage = args.stage;
  if (!run || !stage) { process.stderr.write('[telemetry] stage-start 需要 --run 与 --stage\n'); process.exit(2); }
  return emit(baseEvent('stage.start', run, {
    stage: String(stage),
    role: args.role || null,
    attempt: numOrNull(args.attempt) || 1,
  }));
}

function cmdStageEnd(args) {
  const run = args.run;
  const stage = args.stage;
  if (!run || !stage) { process.stderr.write('[telemetry] stage-end 需要 --run 与 --stage\n'); process.exit(2); }
  const store = resolveStore(process.cwd());
  const from = lastPendingStart(store.file, run, String(stage));
  const ts = nowIso();
  return emit(baseEvent('stage.end', run, {
    stage: String(stage),
    status: args.status || null,
    rework: numOrNull(args.rework),
    artifacts: numOrNull(args.artifacts),
    dur_ms: durMs(from, ts),
    ts,
  }));
}

function cmdRework(args) {
  if (!args.run || !args.stage) { process.stderr.write('[telemetry] rework 需要 --run 与 --stage\n'); process.exit(2); }
  const gaps = String(args.gaps || '')
    .split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
  return emit(baseEvent('stage.rework', args.run, {
    stage: String(args.stage),
    round: numOrNull(args.round) || 1,
    gaps,
    gap_count: gaps.length,
  }));
}

function cmdIssue(args) {
  if (!args.run) { process.stderr.write('[telemetry] issue 需要 --run\n'); process.exit(2); }
  return emit(baseEvent('review.issue', args.run, {
    id: args.id || null,
    level: args.level || null,      // 阻断 / 应修 / 建议
    verdict: args.verdict || null,   // 已修复 / 不修 / 误报 / 待决策
    stage: args.stage || '5a',
  }));
}

function cmdRecheck(args) {
  if (!args.run) { process.stderr.write('[telemetry] recheck 需要 --run\n'); process.exit(2); }
  return emit(baseEvent('review.recheck', args.run, {
    round: numOrNull(args.round) || 1,
    result: args.result || null,
  }));
}

function cmdDefect(args) {
  if (!args.run) { process.stderr.write('[telemetry] defect 需要 --run\n'); process.exit(2); }
  return emit(baseEvent('defect', args.run, {
    source: args.source ? String(args.source) : null,   // 6 测试 / 7 验收
    severity: args.severity || null,                   // 严重 / 一般 / 轻微
    introduced: yn(args.introduced),                   // 本需求引入
    out_of_scope: yn(args.out_of_scope),                // 范围外发现
  }));
}

function cmdStop(args) {
  if (!args.run) { process.stderr.write('[telemetry] stop 需要 --run\n'); process.exit(2); }
  return emit(baseEvent('stop', args.run, {
    type: args.type || null,
    count: numOrNull(args.count) || 1,
    wait_ms: numOrNull(args.wait),
    stage: args.stage ? String(args.stage) : null,
  }));
}

/**
 * 中断：额度耗尽（429）、子 agent 失败、用户放弃、环境错误等。
 * 这是唯一能把「跑到一半死了」的需求从统计里捞出来的事件——
 * 没有它，中断的需求既不出 stage.end 也不出 run.end，会在报告里彻底隐形。
 */
function cmdAbort(args) {
  if (!args.run) { process.stderr.write('[telemetry] abort 需要 --run\n'); process.exit(2); }
  const store = resolveStore(process.cwd());
  const ts = nowIso();
  // 找出中断时还在进行中的阶段：有 start 没有 end 的那个
  const events = readEvents(store.file);
  const open = [];
  const seen = new Map();
  for (const e of events) {
    if (e.run !== args.run) continue;
    if (e.evt === 'stage.start') seen.set(e.stage, e.ts);
    else if (e.evt === 'stage.end') seen.delete(e.stage);
  }
  for (const [stage, startTs] of seen) open.push({ stage, since_ms: durMs(startTs, ts) });
  return emit(baseEvent('abort', args.run, {
    reason: args.reason || null,   // 额度耗尽 / 子agent失败 / 用户放弃 / 环境错误 / 其它
    stage: args.stage ? String(args.stage) : (open.length ? open[0].stage : null),
    open_stages: open.map((o) => o.stage),
    dur_ms: durMs(runStartTime(store.file, args.run), ts),
    ts,
  }));
}

function cmdViolation(args) {
  if (!args.run || !args.type) { process.stderr.write('[telemetry] violation 需要 --run 与 --type\n'); process.exit(2); }
  return emit(baseEvent('violation', args.run, {
    type: args.type,
    stage: args.stage ? String(args.stage) : null,
  }));
}

function cmdClose(args) {
  if (!args.run) { process.stderr.write('[telemetry] close 需要 --run\n'); process.exit(2); }
  const store = resolveStore(process.cwd());
  const ts = nowIso();
  return emit(baseEvent('run.end', args.run, {
    result: args.result || null,
    agents: numOrNull(args.agents),
    dur_ms: durMs(runStartTime(store.file, args.run), ts),
    ts,
  }));
}

function yn(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toLowerCase();
  if (['yes', 'y', 'true', '1', '是', 'y'].includes(s)) return true;
  return false;
}

// ---------------------------------------------------------------- 解析回填（L3）

/**
 * 从「编排记录.md」重建事件。它是主流程必写的文件，即使主流程完全忘了打点，
 * 只要流程跑完，阶段状态、返工次数、评审判定、停点都能回填出来。
 */
function cmdParse(args) {
  const target = args.path || args._[0] || 'docs/requirements';
  const base = path.resolve(process.cwd(), target);
  const dirs = [];
  if (fs.existsSync(path.join(base, '编排记录.md'))) {
    dirs.push(base);
  } else if (fs.existsSync(base)) {
    for (const name of fs.readdirSync(base)) {
      const d = path.join(base, name);
      if (fs.existsSync(path.join(d, '编排记录.md'))) dirs.push(d);
    }
  }
  if (!dirs.length) {
    process.stdout.write(`[telemetry] ${target} 下没有找到 编排记录.md\n`);
    return [];
  }

  const store = resolveStore(process.cwd());
  const existing = readEvents(store.file);
  const known = new Set(existing.map((e) => e.run));
  let written = 0;
  let skipped = 0;

  for (const dir of dirs) {
    const file = path.join(dir, '编排记录.md');
    const text = fs.readFileSync(file, 'utf8');
    const req = pickBullet(text, '需求标识') || path.basename(dir);
    const stat = fs.statSync(file);
    const run = 'p-' + crypto.createHash('sha256')
      .update(`${store.repo}|${req}|${stat.mtimeMs}`).digest('hex').slice(0, 16);
    if (known.has(run) && !args.force) { skipped++; continue; }

    const meta = {
      req: maskReq(req),
      repo: store.repo,
      mode: pickBullet(text, '调用方式'),
      tier: pickBullet(text, '规模档位'),
      agents: numOrNull(pickBullet(text, '起用的 agent 数')),
      skill_sha: skillSha(),
      author: author(),
      src: 'parse',
    };
    const out = [baseEvent('run.start', run, meta)];

    for (const row of tableRows(text, ['阶段', '执行 agent'])) {
      const stage = normalizeStage(row[0]);
      if (!stage) continue;
      const status = normalizeStatus(row[2]);
      const rework = numOrNull(row[4]);
      out.push(baseEvent('stage.start', run, { stage, role: null }));
      out.push(baseEvent('stage.end', run, {
        stage, status, rework, dur_ms: null, src: 'parse',
      }));
      if (rework && rework > 0) {
        out.push(baseEvent('stage.rework', run, { stage, round: rework, gap_count: null }));
      }
    }

    for (const row of tableRows(text, ['编号', '级别'])) {
      out.push(baseEvent('review.issue', run, {
        id: row[0], level: normalizeLevel(row[1]), verdict: normalizeVerdict(row[2]), stage: '5a',
      }));
    }

    for (const row of tableRows(text, ['时间', '类型'])) {
      out.push(baseEvent('stop', run, { type: row[1], count: 1, wait_ms: null }));
    }

    for (const e of out) { e.repo = store.repo; appendEvent(store.file, e); }
    written += out.length;
    process.stdout.write(`[telemetry] ${req}：回填 ${out.length} 条（run=${run}）\n`);
  }
  process.stdout.write(`[telemetry] 回填完成：${written} 条，跳过已存在 ${skipped} 个需求目录\n`);
  return { written, skipped };
}

function pickBullet(text, key) {
  const re = new RegExp('^\\s*[-*]\\s*' + key + '\\s*[:：]\\s*(.+?)\\s*$', 'm');
  const m = text.match(re);
  return m ? m[1] : null;
}

/** 抓 Markdown 表格的数据行（跳过表头与分隔行），表头需包含给定的列名。 */
function tableRows(text, mustInclude) {
  const lines = text.split('\n');
  const rows = [];
  let header = null;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) { header = null; continue; }
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
    if (header === null) {
      if (mustInclude.every((k) => cells.some((c) => c.includes(k)))) header = cells;
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

function normalizeStage(s) {
  if (!s) return null;
  const m = String(s).match(/^\s*(\d+\s*[a-dA-D]?)/);
  if (!m) return null;
  return m[1].replace(/\s+/g, '').toLowerCase();
}

function normalizeStatus(s) {
  const v = String(s || '');
  if (v.includes('阻塞')) return '阻塞';
  if (v.includes('部分')) return '部分完成';
  if (v.includes('完成')) return '完成';
  return v || null;
}

function normalizeLevel(s) {
  const v = String(s || '');
  if (v.includes('阻断')) return '阻断';
  if (v.includes('应修')) return '应修';
  if (v.includes('建议')) return '建议';
  return v || null;
}

function normalizeVerdict(s) {
  const v = String(s || '');
  if (v.includes('已修复')) return '已修复';
  if (v.includes('误报')) return '误报';
  if (v.includes('待决策')) return '待决策';
  if (v.includes('不修')) return '不修';
  return v || null;
}

// ---------------------------------------------------------------- 统计

const STAGE_NAMES = {
  '1': '产品需求', '2': '设计', '3': '技术方案', '4': '开发',
  '5a': '代码评审', '5c': '修正', '5d': '复审', '6': '测试', '7': '验收', '8': '复盘',
};

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function fmtDur(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs ? rs + 's' : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtPct(x, total) {
  if (!total) return '—';
  return `${Math.round((x / total) * 100)}%`;
}

function collectFiles(args) {
  const paths = [];
  const raw = [];
  if (args.path) raw.push(...(Array.isArray(args.path) ? args.path : [args.path]));
  if (args.all) raw.push(...loadConfig().scanPaths);
  if (args._.length) raw.push(...args._);
  if (!raw.length) raw.push(process.cwd());

  for (const p of raw) {
    const abs = path.resolve(process.cwd(), p);
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { continue; }
    if (st.isFile() && abs.endsWith('events.jsonl')) { paths.push(abs); continue; }
    if (!st.isDirectory()) continue;
    const direct = path.join(abs, 'docs', 'requirements', '.telemetry', 'events.jsonl');
    if (fs.existsSync(direct)) { paths.push(direct); continue; }
    // 目录下递归找（限制深度，避免扫整个 home）
    walk(abs, 0, 6, paths);
  }
  // fallback：本机降级目录
  if (args.all && fs.existsSync(FALLBACK_ROOT)) walk(FALLBACK_ROOT, 0, 3, paths);
  return Array.from(new Set(paths));
}

function walk(dir, depth, max, out) {
  if (depth > max) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.telemetry') {
        const f = path.join(p, 'events.jsonl');
        if (fs.existsSync(f)) out.push(f);
        continue;
      }
      walk(p, depth + 1, max, out);
    } else if (e.name === 'events.jsonl') {
      out.push(p);
    }
  }
}

function aggregate(events) {
  const runs = new Map();
  const pending = new Map(); // run|stage -> start ts
  for (const e of events) {
    if (!e || !e.run) continue;
    if (!runs.has(e.run)) {
      runs.set(e.run, {
        run: e.run, req: null, repo: e.repo || null, mode: null, tier: null,
        author: null, skill_sha: null, src: null, agents: null,
        start: null, end: null, result: null,
        stages: [], issues: [], defects: [], stops: [], violations: [], rechecks: [],
        aborts: [], finished: false, aborted: false, lastTs: null,
        startedStages: new Set(),
      });
    }
    const r = runs.get(e.run);
    if (e.ts && (!r.lastTs || e.ts > r.lastTs)) r.lastTs = e.ts;
    switch (e.evt) {
      case 'run.start':
        r.start = e.ts; r.req = e.req || r.req; r.repo = e.repo || r.repo;
        r.mode = e.mode || null; r.tier = e.tier || null; r.author = e.author || null;
        r.skill_sha = e.skill_sha || null; r.src = e.src || 'l1'; r.agents = e.agents || null;
        break;
      case 'run.end':
        r.end = e.ts; r.result = e.result || null; r.agents = e.agents || r.agents;
        r.dur_ms = e.dur_ms !== undefined ? e.dur_ms : durMs(r.start, e.ts);
        r.finished = true;
        break;
      case 'abort':
        r.aborts.push(e); r.aborted = true;
        if (!r.end) r.end = e.ts;
        r.dur_ms = r.dur_ms !== undefined && r.dur_ms !== null
          ? r.dur_ms : (e.dur_ms !== undefined ? e.dur_ms : durMs(r.start, e.ts));
        break;
      case 'stage.start':
        pending.set(`${e.run}|${e.stage}`, e.ts);
        r.startedStages.add(String(e.stage));
        break;
      case 'stage.end': {
        const key = `${e.run}|${e.stage}`;
        const from = pending.get(key);
        if (from) pending.delete(key);
        r.stages.push({
          stage: String(e.stage),
          status: e.status || null,
          rework: e.rework,
          dur_ms: e.dur_ms !== undefined ? e.dur_ms : durMs(from, e.ts),
        });
        break;
      }
      case 'stage.rework':
        r.stages.push({ stage: String(e.stage), rework_e: true, gaps: e.gaps || [] });
        break;
      case 'review.issue': r.issues.push(e); break;
      case 'review.recheck': r.rechecks.push(e); break;
      case 'defect': r.defects.push(e); break;
      case 'stop': r.stops.push(e); break;
      case 'violation': r.violations.push(e); break;
      default: break;
    }
  }
  return Array.from(runs.values()).map(markInterrupted).map((r) => r);
}

/**
 * 推断「跑到一半死了」的需求。
 *
 * 主流程遭遇 429 / 崩溃时，往往连 abort 都来不及打，于是这个需求既没有
 * run.end 也没有 abort——如果不主动推断，它会从报告里彻底消失，
 * 既不算失败也不算成功，等于没发生过。这里用「最后一条事件距今的静默时长」
 * 判定：超过阈值且无结束信号，就算中断。
 */
const SILENCE_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟无任何事件
function markInterrupted(r) {
  if (r.finished || r.aborted) return r;
  const ref = r.lastTs || r.start;
  if (!ref) return r;
  const silence = Date.now() - new Date(ref).getTime();
  if (Number.isFinite(silence) && silence > SILENCE_THRESHOLD_MS) {
    r.inferred_abort = true;
    r.silence_ms = silence;
  }
  return r;
}

/** 把 stage.end 与 stage.rework 合并成每个阶段一条记录 */
function stageRecords(run) {
  const map = new Map();
  for (const s of run.stages) {
    if (!map.has(s.stage)) map.set(s.stage, { stage: s.stage, ends: [], reworks: 0, gaps: [] });
    const rec = map.get(s.stage);
    if (s.rework_e) { rec.reworks += 1; rec.gaps.push(...(s.gaps || [])); }
    else rec.ends.push(s);
  }
  return Array.from(map.values()).map((rec) => {
    const last = rec.ends[rec.ends.length - 1] || {};
    const declared = typeof last.rework === 'number' ? last.rework : null;
    return {
      stage: rec.stage,
      status: last.status || null,
      dur_ms: last.dur_ms !== undefined ? last.dur_ms : null,
      rework: declared !== null ? declared : rec.reworks,
      gaps: rec.gaps,
    };
  });
}

function buildReport(runs, files) {
  const totalRuns = runs.length;
  const l1Runs = runs.filter((r) => r.src !== 'parse').length;
  const parseRuns = totalRuns - l1Runs;
  const closed = runs.filter((r) => r.result);
  const aborted = runs.filter((r) => r.aborted || r.inferred_abort);

  // 北极星 1：一次通过交付率
  let firstPass = 0;
  for (const r of closed) {
    const hardStop = r.stops.some((s) => ['硬阻塞', '返工超限'].includes(s.type));
    const severe = r.defects.some((d) => d.severity === '严重' && d.out_of_scope !== true);
    const reworked = stageRecords(r).some((s) => (s.rework || 0) > 0);
    if (r.result === '验收通过' && !hardStop && !severe && !reworked) firstPass++;
  }

  // 北极星 2：交付时长
  // 交付时长只统计正常收尾的：中断的需求时长是「到死为止」，混进来会拉低 P50
  const durs = runs.filter((r) => r.finished).map((r) => r.dur_ms)
    .concat(runs.filter((r) => !r.finished && r.aborted).map((r) => r.dur_ms))
    .filter((d) => typeof d === 'number' && Number.isFinite(d))
    .sort((a, b) => a - b);

  // 阶段效率
  const stageMap = new Map();
  for (const r of runs) {
    for (const s of stageRecords(r)) {
      if (!stageMap.has(s.stage)) stageMap.set(s.stage, { stage: s.stage, n: 0, firstPass: 0, reworkSum: 0, durs: [], blocked: 0, gaps: [] });
      const g = stageMap.get(s.stage);
      g.n += 1;
      const rw = s.rework || 0;
      g.reworkSum += rw;
      if (rw === 0 && s.status !== '阻塞') g.firstPass += 1;
      if (s.status === '阻塞') g.blocked += 1;
      if (typeof s.dur_ms === 'number') g.durs.push(s.dur_ms);
      g.gaps.push(...(s.gaps || []));
    }
  }
  const stages = Array.from(stageMap.values()).sort((a, b) => stageSort(a.stage) - stageSort(b.stage));
  const stageP50Sum = stages.reduce((acc, g) => acc + (pct(g.durs.slice().sort((a, b) => a - b), 50) || 0), 0);

  // 评审质量
  const issues = runs.flatMap((r) => r.issues);
  const byLevel = {};
  const byVerdict = {};
  for (const i of issues) {
    if (i.level) byLevel[i.level] = (byLevel[i.level] || 0) + 1;
    if (i.verdict) byVerdict[i.verdict] = (byVerdict[i.verdict] || 0) + 1;
  }
  const judged = issues.filter((i) => i.verdict).length;
  const falsePositiveRate = judged ? (byVerdict['误报'] || 0) / judged : 0;
  const noFixRate = judged ? (byVerdict['不修'] || 0) / judged : 0;
  const blockingFixed = issues.filter((i) => i.level === '阻断' && i.verdict === '已修复').length;

  // 缺陷与逃逸
  const defects = runs.flatMap((r) => r.defects);
  const severeEscaped = defects.filter((d) => d.severity === '严重' && d.out_of_scope !== true).length;
  const foundInReview = issues.filter((i) => ['阻断', '应修'].includes(i.level)).length;
  const escapeRate = (foundInReview + severeEscaped)
    ? severeEscaped / (foundInReview + severeEscaped) : null;

  // 停点
  const stopMap = new Map();
  for (const r of runs) {
    for (const s of r.stops) {
      if (!stopMap.has(s.type)) stopMap.set(s.type, { type: s.type, n: 0, runs: new Set(), waits: [] });
      const g = stopMap.get(s.type);
      g.n += (s.count || 1);
      g.runs.add(r.run);
      if (typeof s.wait_ms === 'number') g.waits.push(s.wait_ms);
    }
  }

  // 独立性违规
  const violMap = new Map();
  for (const r of runs) {
    for (const v of r.violations) {
      if (!violMap.has(v.type)) violMap.set(v.type, { type: v.type, n: 0, stages: new Set() });
      const g = violMap.get(v.type);
      g.n += 1;
      if (v.stage) g.stages.add(v.stage);
    }
  }

  // 规模与成本
  const tierMap = {};
  const modeMap = {};
  const shaMap = new Map();
  for (const r of runs) {
    if (r.tier) tierMap[r.tier] = (tierMap[r.tier] || 0) + 1;
    if (r.mode) modeMap[r.mode] = (modeMap[r.mode] || 0) + 1;
    if (r.skill_sha) shaMap.set(r.skill_sha, (shaMap.get(r.skill_sha) || 0) + 1);
  }
  const agentsArr = runs.map((r) => r.agents).filter((a) => typeof a === 'number');

  return {
    meta: {
      generated_at: nowIso(),
      files: files,
      runs: totalRuns,
      events_source: { l1_runs: l1Runs, parse_runs: parseRuns, l1_coverage: totalRuns ? l1Runs / totalRuns : null },
    },
    north_star: {
      first_pass_delivery_rate: closed.length ? firstPass / closed.length : null,
      first_pass_count: firstPass,
      closed_count: closed.length,
      duration_p50: pct(durs, 50),
      duration_p90: pct(durs, 90),
      duration_samples: durs.length,
      // 第三个北极星：跑不完这件事本身，比慢更值得优先修
      abort_rate: totalRuns ? aborted.length / totalRuns : null,
      aborted_count: aborted.length,
    },
    stages: stages.map((g) => {
      const sorted = g.durs.slice().sort((a, b) => a - b);
      const p50 = pct(sorted, 50);
      return {
        stage: g.stage,
        name: STAGE_NAMES[g.stage] || '',
        samples: g.n,
        first_pass_rate: g.n ? g.firstPass / g.n : null,
        avg_rework: g.n ? g.reworkSum / g.n : null,
        blocked: g.blocked,
        dur_p50: p50,
        dur_p90: pct(sorted, 90),
        dur_share: stageP50Sum && p50 ? p50 / stageP50Sum : null,
        top_gaps: topN(g.gaps, 3),
      };
    }),
    review: {
      total_issues: issues.length,
      by_level: byLevel,
      by_verdict: byVerdict,
      false_positive_rate: falsePositiveRate,
      no_fix_rate: noFixRate,
      blocking_fixed: blockingFixed,
      recheck_rounds: runs.flatMap((r) => r.rechecks.map((x) => x.round)).filter(Boolean),
    },
    defects: {
      total: defects.length,
      severe_escaped: severeEscaped,
      out_of_scope: defects.filter((d) => d.out_of_scope === true).length,
      escape_rate: escapeRate,
      by_source: countBy(defects.map((d) => d.source)),
    },
    // 中断：按原因与中断发生的阶段分别聚合
    aborts: {
      total: aborted.length,
      explicit: runs.filter((r) => r.aborted).length,
      inferred: runs.filter((r) => r.inferred_abort).length,
      by_reason: countBy(runs.flatMap((r) => r.aborts.map((a) => a.reason))),
      by_stage: countBy(aborted.map((r) => lastStageOf(r))),
      detail: aborted.map((r) => ({
        run: r.run, req: r.req,
        reason: (r.aborts[0] && r.aborts[0].reason) || (r.inferred_abort ? '静默超时（推断）' : null),
        stage: lastStageOf(r),
        explicit: !!r.aborted,
        silence_ms: r.silence_ms || null,
      })),
    },
    stops: Array.from(stopMap.values()).map((g) => ({
      type: g.type, count: g.n, runs: g.runs.size,
      avg_wait_ms: g.waits.length ? g.waits.reduce((a, b) => a + b, 0) / g.waits.length : null,
    })).sort((a, b) => b.count - a.count),
    violations: Array.from(violMap.values()).map((g) => ({
      type: g.type, count: g.n, stages: Array.from(g.stages),
    })).sort((a, b) => b.count - a.count),
    scale: {
      by_tier: tierMap,
      by_mode: modeMap,
      avg_agents: agentsArr.length ? agentsArr.reduce((a, b) => a + b, 0) / agentsArr.length : null,
      skill_versions: Array.from(shaMap.entries()).map(([sha, n]) => ({ sha, runs: n })),
    },
  };
}

/**
 * 中断发生在哪个阶段。
 * 关键是算上「起了但没结束」的阶段——正是这类悬空的 start 标记着 429 断在哪里，
 * 只看有 stage.end 的阶段会把中断位置错报成上一个已完成阶段。
 */
function lastStageOf(run) {
  if (run.aborts.length && run.aborts[0].stage) return String(run.aborts[0].stage);
  const done = new Set(stageRecords(run).map((s) => s.stage));
  const dangling = Array.from(run.startedStages || []).filter((s) => !done.has(s));
  const pool = dangling.length ? dangling : Array.from(done);
  if (!pool.length) return null;
  return pool.sort((a, b) => stageSort(b) - stageSort(a))[0];
}

function countBy(arr) {
  const m = {};
  for (const v of arr) { if (v) m[v] = (m[v] || 0) + 1; }
  return m;
}

function topN(arr, n) {
  const m = countBy(arr);
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ item: k, n: v }));
}

function stageSort(s) {
  const m = String(s).match(/^(\d+)([a-d]?)$/);
  if (!m) return 999;
  const letter = m[2] ? m[2].charCodeAt(0) - 96 : 0;
  return Number(m[1]) * 10 + letter;
}

function printReport(rep) {
  const L = [];
  const p = (s) => L.push(s);
  p('# requirement-spec 使用效率报告');
  p('');
  p(`生成时间：${rep.meta.generated_at}`);
  p(`数据范围：${rep.meta.files.length} 个事件文件，${rep.meta.runs} 个需求`);
  const c = rep.meta.events_source;
  p(`采集来源：L1 主动打点 ${c.l1_runs} 个需求 / L3 编排记录回填 ${c.parse_runs} 个（L1 覆盖率 ${Math.round((c.l1_coverage || 0) * 100)}%）`);
  if (c.parse_runs > 0 && c.l1_coverage < 0.8) {
    p('');
    p('> ⚠️ L1 覆盖率偏低：多数数据来自事后回填，耗时与缺陷字段缺失。优先把打点补进主流程的阶段边界。');
  }
  p('');

  const ns = rep.north_star;
  p('## 北极星');
  p('');
  p(`- **一次通过交付率**：${ns.closed_count ? Math.round(ns.first_pass_delivery_rate * 100) : '—'}%（${ns.first_pass_count}/${ns.closed_count}）`);
  p(`- **交付时长**：P50 ${fmtDur(ns.duration_p50)} / P90 ${fmtDur(ns.duration_p90)}（样本 ${ns.duration_samples}）`);
  p(`- **中断率**：${Math.round((ns.abort_rate || 0) * 100)}%（${ns.aborted_count}/${rep.meta.runs}）`);
  p('');
  p('三者成对看——只看时长会诱导牺牲质量，只看通过率会让中断的需求隐形。');
  p('');

  p('## 阶段效率');
  p('');
  p('| 阶段 | 样本 | 首次通过率 | 平均返工 | 阻塞 | 耗时P50 | 耗时P90 | 耗时占比 | 高频缺口 |');
  p('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of rep.stages) {
    p(`| ${s.stage} ${s.name} | ${s.samples} | ${fmtPct(Math.round((s.first_pass_rate || 0) * 100), 100)} | ${s.avg_rework !== null ? s.avg_rework.toFixed(2) : '—'} | ${s.blocked} | ${fmtDur(s.dur_p50)} | ${fmtDur(s.dur_p90)} | ${fmtPct(Math.round((s.dur_share || 0) * 100), 100)} | ${s.top_gaps.map((g) => g.item).join('、') || '—'} |`);
  }
  p('');

  const rv = rep.review;
  p('## 评审质量');
  p('');
  p(`- 问题总数：**${rv.total_issues}**（${Object.entries(rv.by_level).map(([k, v]) => `${k} ${v}`).join(' / ') || '无分级数据'}）`);
  p(`- 判定分布：${Object.entries(rv.by_verdict).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`);
  p(`- **误报率 ${Math.round(rv.false_positive_rate * 100)}%**、**不修率 ${Math.round(rv.no_fix_rate * 100)}%**（误报高=角色卡有问题；不修高=评审在提超范围意见）`);
  p(`- 阻断项已修复：${rv.blocking_fixed}`);
  p('');

  const df = rep.defects;
  p('## 缺陷与逃逸');
  p('');
  p(`- 缺陷总数 ${df.total}，其中严重 ${df.severe_escaped}，范围外发现 ${df.out_of_scope}`);
  p(`- **缺陷逃逸率 ${df.escape_rate !== null ? Math.round(df.escape_rate * 100) + '%' : '—'}**（阶段 5 没拦住、漏到测试/验收的比例；升高说明评审该收紧）`);
  p(`- 来源分布：${Object.entries(df.by_source).map(([k, v]) => `阶段${k} ${v}`).join(' / ') || '—'}`);
  p('');

  const ab = rep.aborts;
  p('## 中断');
  p('');
  if (!ab.total) {
    p('- 未发现中断');
  } else {
    p(`- **中断 ${ab.total} 个需求**（显式记录 ${ab.explicit} / 静默超时推断 ${ab.inferred}）`);
    p(`- 按原因：${Object.entries(ab.by_reason).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`);
    p(`- 按中断所在阶段：${Object.entries(ab.by_stage).map(([k, v]) => `阶段${k} ${v}`).join(' / ') || '—'}`);
    if (ab.inferred > 0) {
      p('');
      p('> ⚠️ 有需求是**静默中断**（超过 30 分钟无任何事件且无结束信号），主流程连中断都来不及记录——通常是 429 额度耗尽或进程被杀。这类最该优先看：它们曾经在报告里是完全隐形的。');
    }
    p('');
    p('| 需求 | 中断阶段 | 原因 | 来源 |');
    p('| --- | --- | --- | --- |');
    for (const d of ab.detail) {
      p(`| ${d.req || d.run} | ${d.stage || '—'} | ${d.reason || '—'} | ${d.explicit ? '显式记录' : '静默推断'} |`);
    }
  }
  p('');

  p('## 停点与阻塞');
  p('');
  if (!rep.stops.length) p('- 无停点记录');
  else {
    p('| 类型 | 次数 | 涉及需求 | 平均等待 |');
    p('| --- | --- | --- | --- |');
    for (const s of rep.stops) p(`| ${s.type} | ${s.count} | ${s.runs} | ${fmtDur(s.avg_wait_ms)} |`);
  }
  p('');

  p('## 独立性违规');
  p('');
  if (!rep.violations.length) p('- 未记录到独立性违规');
  else {
    p('| 类型 | 次数 | 涉及阶段 |');
    p('| --- | --- | --- |');
    for (const v of rep.violations) p(`| ${v.type} | ${v.count} | ${v.stages.join('、') || '—'} |`);
  }
  p('');

  const sc = rep.scale;
  p('## 规模与成本');
  p('');
  p(`- 档位分布：${Object.entries(sc.by_tier).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`);
  p(`- 调用方式：${Object.entries(sc.by_mode).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`);
  p(`- 平均起用 agent 数：${sc.avg_agents !== null ? sc.avg_agents.toFixed(1) : '—'}`);
  p(`- skill 版本分布：${sc.skill_versions.map((v) => `${v.sha}(${v.runs})`).join(' / ') || '—'}（改版前后按 sha 分段对比，可验证改进是否真的有效）`);
  p('');

  process.stdout.write(L.join('\n') + '\n');
}

function cmdReport(args) {
  const files = collectFiles(args);
  const events = files.flatMap((f) => readEvents(f));
  if (!events.length) {
    process.stdout.write('[telemetry] 暂无数据。先在需求流程里跑打点，或用 parse 从 编排记录.md 回填。\n');
    return null;
  }
  const rep = buildReport(aggregate(events), files);
  if (args.json) process.stdout.write(JSON.stringify(rep, null, 2) + '\n');
  else printReport(rep);
  return rep;
}

function cmdWhere() {
  const s = resolveStore(process.cwd());
  process.stdout.write(JSON.stringify(s, null, 2) + '\n');
}

// ---------------------------------------------------------------- 入口

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/**')[1] + '\n');
    return;
  }

  const table = {
    init: cmdInit,
    'stage-start': cmdStageStart,
    'stage-end': cmdStageEnd,
    rework: cmdRework,
    issue: cmdIssue,
    recheck: cmdRecheck,
    defect: cmdDefect,
    stop: cmdStop,
    abort: cmdAbort,
    violation: cmdViolation,
    close: cmdClose,
    report: cmdReport,
    parse: cmdParse,
    where: cmdWhere,
  };

  const fn = table[cmd];
  if (!fn) {
    process.stderr.write(`[telemetry] 未知命令：${cmd}\n`);
    process.exit(2);
  }

  // 写入类命令：失败也必须退出 0，绝不阻塞主流程
  if (WRITE_CMDS.has(cmd)) {
    try { fn(args); } catch (e) {
      process.stderr.write(`[telemetry] ${cmd} 失败（已忽略）：${e.message}\n`);
    }
    process.exit(0);
  }

  try {
    fn(args);
  } catch (e) {
    process.stderr.write(`[telemetry] ${cmd} 失败：${e.message}\n`);
    process.exit(1);
  }
}

main();
