#!/usr/bin/env node
// Which session is doing what, right now.
//
//   node bin/board.mjs                127.0.0.1:8740
//   node bin/board.mjs --port 9000
//
// Sessions don't talk to the board. Each just writes its own log under
// ~/.claude/projects/<slug of its working dir>/<session>.jsonl, and the board reads those
// from outside — nothing is attached to the sessions.
//
// Read-only. Logs contain whole conversations: keep it on localhost.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync,
  mkdirSync, writeFileSync, appendFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAgents } from './lib/agents.mjs';
import { projectSlug, leaf, claudeHome, isMain } from './lib/paths.mjs';
import { kitOf } from './lib/kit.mjs';
import { read as readLedger, open as openClaims, ledgerGroups, ledgerPath } from './ledger.mjs';
import { tally } from './cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 8740;

const sessionDir = () => join(claudeHome(), 'sessions');
export const logDirOf = dir => join(claudeHome(), 'projects', projectSlug(resolve(dir)));

/** The registry's .json files (a .key sibling lives there too). Half-written files are skipped. */
function sessionFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch { /* half-written */ }
  }
  return out.filter(j => j && j.sessionId);
}

/** sessionId → the name a person gave the window (/rename). Resumed sessions leave two files; latest wins. */
export function sessionNames(dir = sessionDir()) {
  const best = new Map();
  for (const j of sessionFiles(dir)) {
    if (!j.name || j.nameSource !== 'user') continue;
    const at = j.updatedAt ?? 0;
    if ((best.get(j.sessionId)?.at ?? -1) >= at) continue;
    best.set(j.sessionId, { name: String(j.name).trim(), at });
  }
  return new Map([...best].map(([k, v]) => [k, v.name]));
}

/**
 * Every Claude Code window open on this machine, any repo. The registry file is deleted when a
 * window closes, so what remains is what is open.
 * ponytail: a crashed window can leave a ghost; we don't delete it, we send updatedAt so the page can dim it.
 */
export function liveSessions(dir = sessionDir(), mine = new Set()) {
  const best = new Map();
  for (const j of sessionFiles(dir)) {
    const at = j.updatedAt ?? j.startedAt ?? 0;
    if ((best.get(j.sessionId)?.updatedAt ?? -1) >= at) continue;
    best.set(j.sessionId, {
      pid: j.pid ?? null, id: j.sessionId,
      name: j.name ? String(j.name).trim() : null, named: j.nameSource === 'user',
      project: leaf(j.cwd), cwd: j.cwd ?? null, status: j.status ?? null,
      startedAt: j.startedAt ?? null, updatedAt: at, here: mine.has(j.sessionId),
    });
  }
  return [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One line → what was done, in a few words. A tool use beats text: what it is doing matters more. */
export function describe(row) {
  const m = row?.message;
  if (!m) return null;
  if (typeof m.content === 'string') {
    const t = m.content.trim();
    return t ? { role: m.role, kind: 'text', text: t } : null;
  }
  if (!Array.isArray(m.content)) return null;
  const tool = m.content.find(c => c.type === 'tool_use');
  if (tool) {
    const i = tool.input ?? {};
    return { role: m.role, kind: 'tool', tool: tool.name,
      text: i.description ?? i.command ?? i.file_path ?? i.pattern ?? i.prompt ?? i.query ?? i.url ?? i.action ?? '' };
  }
  const text = m.content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
  if (text) return { role: m.role, kind: 'text', text };
  if (m.content.some(c => c.type === 'tool_result')) return { role: m.role, kind: 'result', text: '' };
  return null;
}

// Per file: last result, keyed by size and mtime. The board asks every 2 s; most logs haven't moved.
const TAIL = new Map();

/** Last lines only: logs reach tens of MB. Read the final 512 KB and split — and if one huge line
 *  (a screenshot, say) fills that window, widen it (up to 8 MB) until a few whole lines show. */
export function tailLines(file, want = 400) {
  const st = statSync(file);
  const hit = TAIL.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs && hit.want === want) return hit.lines;
  let lines = [];
  for (let span = 512 * 1024; ; span *= 4) {
    span = Math.min(st.size, span);
    const buf = Buffer.alloc(span);
    const h = openSync(file, 'r');
    try { readSync(h, buf, 0, span, st.size - span); } finally { closeSync(h); }
    lines = buf.toString('utf8').split('\n');
    if (st.size > span) lines.shift();           // first line was cut mid-way
    lines = lines.filter(Boolean);
    if (lines.length >= Math.min(want, 20) || span >= st.size || span >= 8 * 1024 * 1024) break;
  }
  lines = lines.slice(-want);
  TAIL.set(file, { size: st.size, mtime: st.mtimeMs, want, lines });
  return lines;
}

/** First lines — the first thing a person asked is the best name for an unnamed window. */
function headLines(file, want = 60) {
  const size = statSync(file).size;
  const span = Math.min(size, 128 * 1024);
  const buf = Buffer.alloc(span);
  const h = openSync(file, 'r');
  try { readSync(h, buf, 0, span, 0); } finally { closeSync(h); }
  const lines = buf.toString('utf8').split('\n');
  if (size > span) lines.pop();
  return lines.filter(Boolean).slice(0, want);
}

/** A slash command arrives wrapped in tags; pull out "/ops verify". */
export function commandOf(text) {
  const m = /<command-name>([^<]*)<\/command-name>/.exec(text ?? '');
  if (!m) return null;
  const a = /<command-args>([^<]*)<\/command-args>/.exec(text) ?? [, ''];
  return (m[1].trim() + ' ' + a[1].trim()).trim();
}

// Skill preambles, hooks and system notes arrive as "user" too. They are not the person.
const NOT_HUMAN = [/^</, /^Caveat:/, /^Base directory for this skill:/];
export function askedByHuman(d) {
  if (!d || d.role !== 'user' || d.kind !== 'text') return false;
  if (commandOf(d.text)) return true;
  return !NOT_HUMAN.some(re => re.test(d.text));
}
const label = text => commandOf(text) ?? text;
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();

const MOVING_MS = 20_000;              // log grew within this: moving
export const STOPPED_MS = 10 * 60 * 1000;   // quiet this long: stopped
export const STEPS = 5;                // recent moves on a card
const STEP_CUT = 120;

/**
 * Where a window is, from its log rather than self-report — a dead window can't keep reporting,
 * but a file's mtime doesn't lie.
 *   moving · waiting (last word was the assistant's: the person's turn) · busy (asked, no answer yet:
 *   thinking or a permission prompt) · stopped
 */
export function phaseOf(last, idle) {
  if (idle < MOVING_MS) return 'moving';
  if (idle >= STOPPED_MS) return 'stopped';
  return last?.role === 'assistant' ? 'waiting' : 'busy';
}

/** Sessions in one log folder. Missing folder (role never opened) → []. Broken lines are skipped. */
export function sessions(dir, now = Date.now(), role = null, names = sessionNames()) {
  if (!dir || !existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir); } catch { return []; }   // unreadable (EACCES, cloud placeholder): show the rest
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const file = join(dir, f);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (!st.isFile() || st.size === 0) continue;
    let rows = [];
    try { rows = tailLines(file).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    catch { continue; }
    if (!rows.length) continue;
    if (rows.some(r => r.entrypoint === 'sdk-cli')) continue;   // `claude -p` runs are not windows

    let last = null;
    for (let i = rows.length - 1; i >= 0 && !last; i--) {
      const d = describe(rows[i]);
      if (d && d.kind !== 'result') last = { ...d, at: rows[i].timestamp };
    }
    const steps = [];
    for (let i = rows.length - 1; i >= 0 && steps.length < STEPS; i--) {
      const d = describe(rows[i]);
      if (!d || d.role !== 'assistant' || (d.kind !== 'tool' && d.kind !== 'text')) continue;
      steps.push({ kind: d.kind, tool: d.tool ?? null, text: squash(d.text).slice(0, STEP_CUT), at: rows[i].timestamp });
    }
    steps.reverse();
    const sends = [];
    for (const r of rows) {
      if (r.message?.role !== 'assistant' || !Array.isArray(r.message.content)) continue;
      for (const c of r.message.content) {
        if (c.type !== 'tool_use' || c.name !== 'SendMessage') continue;
        const i = c.input ?? {};
        sends.push({ at: r.timestamp, to: i.to ?? '', summary: i.summary ?? '', message: String(i.message ?? '').slice(0, 4000) });
      }
    }
    const heard = new Set();
    for (const r of rows) {
      if (r.message?.role !== 'user') continue;
      const c = r.message.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('') : '';
      const m = /^<cross-session-message from="([^"]*)"/.exec(t.trim());
      if (m) heard.add(m[1]);
    }
    let asked = null;
    for (let i = rows.length - 1; i >= 0 && !asked; i--) {
      const d = describe(rows[i]);
      if (askedByHuman(d)) asked = label(d.text);
    }
    let first = null;
    try {
      for (const l of headLines(file)) {
        let d = null;
        try { d = describe(JSON.parse(l)); } catch { continue; }
        if (askedByHuman(d)) { first = label(d.text); break; }
      }
    } catch { /* head unreadable: show the rest */ }
    const idle = now - st.mtimeMs;
    const id = basename(f, '.jsonl');
    out.push({
      id, role, sends, heard: [...heard],
      name: names.get(id) ?? (first ? squash(first).slice(0, 30) : null),
      titled: names.has(id), first,
      branch: rows.find(r => r.gitBranch)?.gitBranch ?? null,
      cwd: rows.find(r => r.cwd)?.cwd ?? null,
      turns: rows.filter(r => r.type === 'assistant').length,
      phase: phaseOf(last, idle), idleMs: idle, last, steps, asked,
      cost: tally(file),
    });
  }
  return out.sort((a, b) => a.idleMs - b.idleMs);
}

// ── chat drawer ────────────────────────────────────────────────
const LOG_SPAN = 2 * 1024 * 1024;
const LOG_CUT = 6000;

/** Session id → log file among the given folders. The id comes from a URL, so check its shape first. */
export function logFile(id, dirs) {
  if (!/^[0-9a-f-]{36}$/.test(id ?? '')) return null;
  for (const d of dirs) {
    const f = join(d, id + '.jsonl');
    if (existsSync(f)) return f;
  }
  return null;
}

/** Log rows → chat items. Consecutive tool uses fold into one group. */
export function chatItems(rows) {
  const out = [];
  for (const r of rows) {
    const m = r.message;
    if (!m || r.isSidechain) continue;
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
    if (m.role === 'user') {
      const text = parts.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (!text) continue;
      const cross = /^<cross-session-message from="([^"]*)"/.exec(text);
      if (cross) out.push({ who: 'in', from: cross[1], at: r.timestamp, text: text.replace(/<\/?cross-session-message[^>]*>/g, '').trim().slice(0, LOG_CUT) });
      else if (askedByHuman({ role: 'user', kind: 'text', text })) out.push({ who: 'me', at: r.timestamp, text: label(text).slice(0, LOG_CUT) });
      continue;
    }
    if (m.role !== 'assistant') continue;
    for (const c of parts) {
      if (c.type === 'text' && c.text.trim()) out.push({ who: 'claude', at: r.timestamp, text: c.text.trim().slice(0, LOG_CUT) });
      else if (c.type === 'tool_use') {
        const i = c.input ?? {};
        const t = { name: c.name, text: squash(i.description ?? i.command ?? i.file_path ?? i.pattern ?? i.to ?? i.query ?? i.url ?? i.skill ?? '').slice(0, 200) };
        const last = out.at(-1);
        if (last?.who === 'tools') last.tools.push(t); else out.push({ who: 'tools', at: r.timestamp, tools: [t] });
      }
    }
  }
  return out;
}

/** A slice of a log as chat items: the tail, the slice before `before`, or everything after `from`. */
export function chatLog(file, { before = null, from = null } = {}) {
  const size = statSync(file).size;
  let start, end;
  if (from != null) { start = Math.min(from, size); end = Math.min(size, start + LOG_SPAN); }
  else { end = before != null ? Math.min(before, size) : size; start = Math.max(0, end - LOG_SPAN); }
  const buf = Buffer.alloc(end - start);
  const h = openSync(file, 'r');
  try { readSync(h, buf, 0, buf.length, start); } finally { closeSync(h); }
  let lo = 0;
  // No whole line inside the slice (one screenshot line longer than the slice): skip it all, or we loop.
  if (from == null && start > 0) { const nl = buf.indexOf(10); lo = nl < 0 || nl + 1 === buf.length ? 0 : nl + 1; }
  const lastNl = buf.lastIndexOf(10);
  let hi = lastNl < lo ? lo : lastNl + 1;
  if (from != null && hi === lo && buf.length === LOG_SPAN) hi = lo = buf.length;
  const rows = buf.subarray(lo, hi).toString('utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { items: chatItems(rows), start: start + lo, end: start + hi, size };
}

/**
 * Who leads. Taken from the logs: main is the role named main (from agents.json) or, failing that,
 * a session that sent orders. Subs are sessions of other roles, ones main named, or ones that heard from it.
 */
export function teamOf(sess) {
  const nm = s => s.name || s.id.slice(0, 8);
  const main = sess.find(s => s.role === 'main') ?? sess.find(s => /main/i.test(s.name ?? '') || s.sends.length > 0);
  if (!main) return { main: null, subs: [] };
  const me = nm(main);
  const subs = sess.filter(s => s !== main
    && ((s.role && s.role !== 'main') || s.heard.includes(me) || main.sends.some(m => m.to && m.to === s.name)));
  return {
    main: main.id,
    subs: subs.map(s => {
      const o = main.sends.filter(m => m.to === s.name).at(-1);
      return { id: s.id, order: o ? { text: o.summary || o.message.split('\n')[0], at: o.at } : null };
    }),
  };
}

function git(root, ...a) {
  try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
/** Branch, head commit, uncommitted paths, commits ahead of upstream (null = no upstream, not 0). */
export function repoState(root) {
  const [hash, when, ...rest] = (git(root, 'log', '-1', '--format=%h%x09%cI%x09%s') ?? '').split('\t');
  const ahead = git(root, 'rev-list', '--count', '@{upstream}..HEAD');
  return {
    // symbolic-ref works on a fresh repo with no commits yet; rev-parse covers a detached HEAD.
    branch: git(root, 'symbolic-ref', '--short', '-q', 'HEAD') ?? git(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    head: hash ? { hash, subject: rest.join('\t'), when } : null,
    dirty: (git(root, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).map(l => ({ how: l.slice(0, 2).trim(), path: l.slice(3) })),
    ahead: ahead === null ? null : +ahead,
  };
}

/** Roles from agents.json; without one, the repo alone as main so the board still works. */
function rolesOf(root) {
  try { return loadAgents(root).roles; }
  catch { return [{ name: 'main', dir: resolve(root), branch: null, what: '', skills: [], plugins: {}, isMain: true }]; }
}

export function board(root, now = Date.now()) {
  const roles = rolesOf(root);
  const names = sessionNames();
  const declared = new Set(roles.flatMap(r => r.skills));
  const views = roles.map(r => ({ name: r.name, dir: r.dir, branch: r.branch, what: r.what,
    isMain: r.isMain, logDir: logDirOf(r.dir), kit: kitOf(r, declared) }));
  const sess = views.flatMap(v => sessions(v.logDir, now, v.name, names)).sort((a, b) => a.idleMs - b.idleMs);
  for (const v of views) v.sessionIds = sess.filter(s => s.role === v.name).map(s => s.id);
  const talk = sess.flatMap(s => s.sends.map(m => ({ ...m, from: s.name || s.id.slice(0, 8), role: s.role })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
  const team = teamOf(sess);
  for (const s of sess) { delete s.sends; delete s.heard; }
  const lf = ledgerPath();
  const all = readLedger(lf);
  const unpriced = sess.reduce((a, s) => a + (s.cost?.unpriced ?? 0), 0);
  return {
    now, roles: views, sessions: sess, team, talk,
    live: liveSessions(sessionDir(), new Set(sess.map(s => s.id))),
    spend: sess.reduce((a, s) => a + (s.cost?.usd ?? 0), 0), unpriced,
    repo: repoState(root),
    open: openClaims(lf), groups: ledgerGroups(all),
    counts: { claims: all.filter(r => r.kind === 'claim').length, verdicts: all.filter(r => r.kind === 'verdict').length },
  };
}

// Read on every request so edits show without a restart; it is one small file.
const PAGE = () => readFileSync(join(HERE, 'board.html'), 'utf8');
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

/** Serve only requests addressed to us. Binding to 127.0.0.1 alone doesn't stop DNS rebinding:
 *  a hostile page can point its own name at 127.0.0.1 and read transcripts. The Host header gives it away. */
export function hostOk(host, port, extra = null) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(host ?? ''));
  if (!m || Number(m[2] ?? 80) !== Number(port)) return false;
  const name = m[1].replace(/^\[|\]$/g, '').toLowerCase();
  return LOCAL.has(name) || (extra != null && name === String(extra).toLowerCase());
}

function main(argv) {
  const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const port = Number(flag('port', DEFAULT_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('--port needs a number between 1 and 65535'); process.exit(1); }
  const host = flag('host', '127.0.0.1');
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel') ?? process.cwd();
  createServer((req, res) => {
    if (!hostOk(req.headers.host, port, LOCAL.has(host) ? null : host)) return res.writeHead(403).end();
    const path = req.url.split('?')[0];
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    try {
      if (path === '/api/board') return json(board(root));
      if (path === '/api/log') {
        const q = new URL(req.url, 'http://x').searchParams;
        const file = logFile(q.get('id'), rolesOf(root).map(r => logDirOf(r.dir)));
        if (!file) return res.writeHead(404).end();
        const num = k => (q.has(k) && /^\d+$/.test(q.get(k)) ? Number(q.get(k)) : null);
        return json(chatLog(file, { before: num('before'), from: num('from') }));
      }
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(PAGE());
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e.message));
    }
  }).listen(port, host, () => {
    console.log(`\n  agentsemble board  http://${LOCAL.has(host) ? host : '127.0.0.1'}:${port}\n  repo  ${root}\n`);
    if (!LOCAL.has(host)) {
      console.log(`  WARNING: the board shows full session transcripts. Anyone who can reach ${host}:${port} can read them.\n`);
    }
  });
}

if (isMain(import.meta.url)) main(process.argv.slice(2));

export function selftest(ok) {
  const D = describe;
  ok('text is text', D({ message: { role: 'user', content: 'hi' } }).text === 'hi');
  ok('blank text is nothing', D({ message: { role: 'user', content: '   ' } }) === null);
  const both = D({ message: { role: 'assistant', content: [{ type: 'text', text: 'running' },
    { type: 'tool_use', name: 'Bash', input: { description: 'run tests' } }] } });
  ok('tool beats text', both.kind === 'tool' && both.tool === 'Bash' && both.text === 'run tests');
  ok('command when no description', D({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git log' } }] } }).text === 'git log');
  ok('tool result is a result', D({ message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }).kind === 'result');
  ok('unknown row is null', D({}) === null && D({ message: {} }) === null);

  const A = { role: 'assistant' }, U = { role: 'user' };
  ok('just grew: moving', phaseOf(A, 1_000) === 'moving' && phaseOf(U, 1_000) === 'moving');
  ok('assistant spoke last, quiet: waiting', phaseOf(A, 60_000) === 'waiting');
  ok('asked, no answer: busy', phaseOf(U, 60_000) === 'busy' && phaseOf(null, 60_000) === 'busy');
  ok('long quiet: stopped', phaseOf(A, STOPPED_MS) === 'stopped');

  ok('slash command extracted', commandOf('<command-name>/ops</command-name> <command-args>verify</command-args>') === '/ops verify'
     && commandOf('<command-name>/clear</command-name>') === '/clear' && commandOf('plain') === null && commandOf(null) === null);
  ok('hooks and skill preambles are not the person',
     !askedByHuman({ role: 'user', kind: 'text', text: '<system-reminder>x</system-reminder>' })
     && !askedByHuman({ role: 'user', kind: 'text', text: 'Base directory for this skill: C:\\x' })
     && askedByHuman({ role: 'user', kind: 'text', text: 'fix this' })
     && askedByHuman({ role: 'user', kind: 'text', text: '<command-name>/ops</command-name>' }));

  const t = mkdtempSync(join(tmpdir(), 'as-board-'));
  const at = i => new Date(1_000_000_000_000 + i * 1000).toISOString();
  try {
    const hb = join(t, 'hb.jsonl');
    writeFileSync(hb, ['{"a":1}', '{"a":2}', '{"a":3}', JSON.stringify({ shot: 'x'.repeat(700 * 1024) })].join('\n') + '\n');
    const tl = tailLines(hb);
    ok('a huge last line does not hide the lines before it', tl.length === 4 && tl[0] === '{"a":1}', String(tl.length));
    const c1 = tailLines(hb);
    ok('unchanged file is served from cache', c1 === tl);
    appendFileSync(hb, '{"a":5}\n');
    ok('a grown file is read again', tailLines(hb).at(-1) === '{"a":5}');

    const reg = join(t, 'reg'); mkdirSync(reg);
    const put = (f, o) => writeFileSync(join(reg, f), typeof o === 'string' ? o : JSON.stringify(o));
    put('1.json', { sessionId: 'aaa', name: 'old', nameSource: 'user', updatedAt: 1 });
    put('2.json', { sessionId: 'aaa', name: 'new', nameSource: 'user', updatedAt: 2 });
    put('3.json', { sessionId: 'bbb', name: 'auto name', nameSource: 'auto', updatedAt: 9 });
    put('4.json', { sessionId: 'ccc', updatedAt: 9, cwd: 'C:\\Users\\x\\MAIN\\일본여행' });
    put('5.json', 'not json'); put('6.key', 'x');
    const N = sessionNames(reg);
    ok('user-given name, latest wins; auto names ignored', N.get('aaa') === 'new' && !N.has('bbb') && N.size === 1);
    const L = liveSessions(reg, new Set(['aaa']));
    ok('open windows include unnamed ones, one row per session', L.length === 3 && L.filter(x => x.id === 'aaa').length === 1);
    ok('this repo\'s windows are marked', L.find(x => x.id === 'aaa').here && !L.find(x => x.id === 'bbb').here);
    ok('project is the last folder of a windows path', L.find(x => x.id === 'ccc').project === '일본여행');
    ok('missing registry is empty', liveSessions(join(t, 'nope')).length === 0 && sessionNames(join(t, 'nope')).size === 0);

    const flow = join(t, 'flow'); mkdirSync(flow);
    const rows = [
      { message: { role: 'user', content: [{ type: 'text', text: 'do this' }] }, timestamp: at(0) },
      ...Array.from({ length: 7 }, (_, i) => ({ type: 'assistant', timestamp: at(i + 1),
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo ' + i } }] } })),
      { type: 'assistant', timestamp: at(9), message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'SendMessage', input: { to: 'ui', message: 'fix contrast\nmore', summary: 'contrast' } }] } },
    ];
    writeFileSync(join(flow, '11111111-2222-3333-4444-555555555555.jsonl'),
      rows.map(r => JSON.stringify(r)).join('\n') + '\n{"message":{"role":"assi');       // half-written last line
    writeFileSync(join(flow, 'bbbbbbbb-0000-0000-0000-000000000000.jsonl'),
      JSON.stringify({ entrypoint: 'sdk-cli', message: { role: 'user', content: 'auto' } }) + '\n');
    const S = sessions(flow, Date.now(), 'main', new Map());
    ok('claude -p runs are not windows; broken last line skipped', S.length === 1, String(S.length));
    ok('five most recent moves, oldest first', S[0].steps.length === STEPS && S[0].steps.at(-1).tool === 'SendMessage'
       && S[0].steps.every((s, i) => i === 0 || s.at >= S[0].steps[i - 1].at));
    ok('sent orders are collected', S[0].sends.length === 1 && S[0].sends[0].to === 'ui');
    ok('name falls back to the first ask', S[0].name === 'do this' && S[0].role === 'main');
    ok('missing log folder is not fatal', sessions(join(t, 'never-opened')).length === 0 && sessions(null).length === 0);
    writeFileSync(join(t, 'not-a-dir'), 'x');
    ok('unreadable log folder is not fatal', sessions(join(t, 'not-a-dir')).length === 0);
    ok('only local Host headers are served (DNS rebinding)',
       hostOk('127.0.0.1:8740', 8740) && hostOk('localhost:8740', 8740) && hostOk('[::1]:8740', 8740)
       && !hostOk('attacker.example:8740', 8740) && !hostOk(undefined, 8740) && !hostOk('127.0.0.1:9999', 8740)
       && hostOk('box.lan:8740', 8740, 'box.lan'));

    const Ss = (id, name, extra = {}) => ({ id: id.padEnd(8, '0'), name, role: null, sends: [], heard: [], ...extra });
    const tm = teamOf([
      Ss('m', 'lead', { role: 'main', sends: [{ to: 'ui', message: 'a', at: 'a' }, { to: 'ui', summary: 'again', message: 'x', at: 'b' }] }),
      Ss('u', 'ui'), Ss('t', 'trainer', { heard: ['lead'] }), Ss('w', null, { role: 'train' }), Ss('o', 'other'),
    ]);
    ok('main comes from the main role', tm.main === 'm0000000');
    ok('subs: named, heard, or another role', tm.subs.map(x => x.id[0]).join('') === 'utw', tm.subs.map(x => x.id).join());
    ok('each sub carries main\'s last order', tm.subs[0].order.text === 'again' && tm.subs[1].order === null);
    ok('no main, no subs', teamOf([Ss('x', 'a')]).subs.length === 0);

    const C = chatItems([
      { message: { role: 'user', content: '<system-reminder>x</system-reminder>' } },
      { message: { role: 'user', content: 'fix contrast' }, timestamp: at(0) },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a' } }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a' } }] } },
      { isSidechain: true, message: { role: 'assistant', content: 'side' } },
      { message: { role: 'user', content: '<cross-session-message from="main">work</cross-session-message>' } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    ]);
    ok('chat: me, claude, tool group, incoming, claude', C.map(c => c.who).join() === 'me,claude,tools,in,claude', C.map(c => c.who).join());
    ok('consecutive tools fold', C[2].tools.length === 2 && C[3].from === 'main' && C[3].text === 'work');
    ok('odd ids never touch the disk', logFile('../../etc/passwd', [t]) === null && logFile(null, [t]) === null);
    const cf = join(t, 'chat.jsonl');
    const big = { message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(LOG_SPAN + 10) }] } };
    writeFileSync(cf, [JSON.stringify({ message: { role: 'user', content: 'first' } }), JSON.stringify(big),
      JSON.stringify({ message: { role: 'user', content: 'last' } })].join('\n') + '\n');
    const tail = chatLog(cf);
    ok('tail slice ends with the last words', tail.items.length === 1 && tail.items[0].text === 'last' && tail.end === tail.size);
    let b = tail.start, seen = [], moved = true;
    for (let i = 0; i < 5 && b > 0; i++) { const p = chatLog(cf, { before: b }); moved &&= p.start < b; seen.push(...p.items); b = p.start; }
    ok('"more" walks backwards past a huge line', moved && seen.some(x => x.text === 'first'));
    ok('nothing new after the end', chatLog(cf, { from: tail.end }).items.length === 0);

    // A whole repo: agents.json with a sub role whose window was never opened.
    const repo = join(t, 'app'); mkdirSync(repo);
    execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({ main: { dir: '.' }, ui: { dir: '../app-ui', branch: 'u', skills: ['taste'] } }));
    const old = process.env.CLAUDE_HOME, oldL = process.env.OPS_LEDGER;
    process.env.CLAUDE_HOME = join(t, 'home'); process.env.OPS_LEDGER = join(t, 'ledger.jsonl');
    try {
      const bd = board(repo);
      const ui = bd.roles.find(r => r.name === 'ui');
      ok('role whose window was never opened is shown, not fatal', ui && ui.sessionIds.length === 0 && ui.kit.skills[0].st === 'plan');
      ok('log dir comes from the role path', ui.logDir.endsWith(projectSlug(join(t, 'app-ui'))));
      ok('board carries repo, ledger, spend', bd.repo.branch === 'main' && Array.isArray(bd.open) && bd.spend === 0 && bd.groups);
      rmSync(join(repo, 'agents.json'));
      ok('no agents.json: repo alone as main', board(repo).roles.map(r => r.name).join() === 'main');
    } finally {
      if (old === undefined) delete process.env.CLAUDE_HOME; else process.env.CLAUDE_HOME = old;
      if (oldL === undefined) delete process.env.OPS_LEDGER; else process.env.OPS_LEDGER = oldL;
    }
  } finally { rmSync(t, { recursive: true, force: true }); }

  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = src.slice(0, src.indexOf('export function selftest'));
  ok('board never writes files outside its selftest', !/\b(writeFileSync|appendFileSync|rmSync|mkdirSync)\(/.test(body));
}
