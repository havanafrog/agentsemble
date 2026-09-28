#!/usr/bin/env node
// The ledger two sessions share: one builds and claims, the other runs it and rules.
//
// Why a file: messages die with context. After a compaction neither side remembers what was
// claimed or ruled. A file stays, and a person can read it later.
//
// One event per line. Later lines never overwrite earlier ones — a reversed verdict is history too.
//   claim    builder says "this is true" and says how to measure it
//   verdict  verifier ran it: confirm · refute · hold
//   note     either side; not a verdict
import { appendFileSync, readFileSync, existsSync, mkdirSync, rmSync, mkdtempSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/paths.mjs';

/** <repo>/ops/ledger.jsonl, or OPS_LEDGER. Resolved per call so tests and the board can point elsewhere. */
export function ledgerPath(cwd = process.cwd()) {
  if (process.env.OPS_LEDGER) return process.env.OPS_LEDGER;
  // Every worktree must share one ledger: use the main checkout, found through the common .git dir.
  // (--show-toplevel would give each worktree its own file, and main would never see sub claims.)
  let root = cwd;
  try {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    root = dirname(realpathSync(resolve(cwd, common)));
  } catch { /* not a repo: use cwd */ }
  return join(root, 'ops', 'ledger.jsonl');
}

export const VERDICTS = ['confirm', 'refute', 'hold'];
// Earlier ledgers were written in Korean; keep reading and accepting them.
const ALIAS = { 확인: 'confirm', 반박: 'refute', 보류: 'hold' };
const canon = v => ALIAS[v] ?? v;
const ROLES = new Set(['builder', 'verifier']);

/** After three verdicts on one claim, stop — it is the human's turn. */
export const MAX_ROUNDS = 3;

export function read(file = ledgerPath()) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a crash mid-append leaves a cut line */ }
  }
  return out;
}

function write(row, file) {
  const first = !existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + '\n');
  if (first) hideFromGit(file);
  return row;
}

/** Keep the ledger out of `git status` via info/exclude — shared by all worktrees, nothing to commit. */
function hideFromGit(file) {
  try {
    const dir = dirname(file);
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const common = resolve(dir, execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    const line = '/' + relative(realpathSync(top), realpathSync(file)).split(sep).join('/');
    const ex = join(common, 'info', 'exclude');
    const cur = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (cur.split(/\r?\n/).includes(line)) return;
    mkdirSync(dirname(ex), { recursive: true });
    appendFileSync(ex, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
  } catch { /* not in a repo: nothing to hide */ }
}

export function nextId(rows) {
  let n = 0;
  for (const r of rows) { const m = /^C(\d+)$/.exec(r.id ?? ''); if (m) n = Math.max(n, +m[1]); }
  return 'C' + (n + 1);
}

export function claim({ what, how, why = null, files = [] }, file = ledgerPath()) {
  if (!what || !how) throw new Error('a claim needs both what and how — a claim nobody can measure is an opinion.');
  return write({ id: nextId(read(file)), kind: 'claim', by: 'builder', what, how, why, files,
    at: new Date().toISOString() }, file);
}

export function verdict({ id, v, note, evidence = null, by = 'verifier' }, file = ledgerPath()) {
  v = canon(v);
  if (!VERDICTS.includes(v)) throw new Error(`verdict is one of ${VERDICTS.join(' · ')}`);
  if (!ROLES.has(by)) throw new Error('by is builder or verifier');
  if (!note) throw new Error('a verdict needs evidence: what you ran and what came out');
  if (!read(file).some(r => r.id === id && r.kind === 'claim')) throw new Error(`no claim ${id}`);
  return write({ id, kind: 'verdict', by, v, note, evidence, at: new Date().toISOString() }, file);
}

export function note({ id = null, by, text }, file = ledgerPath()) {
  if (!ROLES.has(by)) throw new Error('by is builder or verifier');
  return write({ id, kind: 'note', by, text, at: new Date().toISOString() }, file);
}

/** Claims not yet closed. Closed = last verdict confirm. Refute is not an end — the builder fixes and re-claims. */
export function open(file = ledgerPath()) {
  const rows = read(file);
  const out = [];
  for (const c of rows.filter(r => r.kind === 'claim')) {
    const vs = rows.filter(r => r.id === c.id && r.kind === 'verdict');
    const last = vs.at(-1) ?? null;
    if (canon(last?.v) === 'confirm') continue;
    out.push({ ...c, rounds: vs.length, last, stuck: vs.length >= MAX_ROUNDS });
  }
  return out;
}

export function history(id, file = ledgerPath()) {
  return read(file).filter(r => r.id === id).map(r => (r.v ? { ...r, v: canon(r.v) } : r));
}

/**
 * The ledger grouped for the board: a claim with its verdicts and the notes that start with its id;
 * notes without an id grouped by their lead (text before " — "). Newest first.
 */
export function ledgerGroups(rows) {
  const claims = new Map(), notes = new Map();
  for (const r0 of rows) {
    const r = r0.v ? { ...r0, v: canon(r0.v) } : r0;
    const ref = r.id ?? /^(C\d+)\b/.exec(r.text ?? '')?.[1] ?? null;
    if (ref && (r.kind === 'claim' || claims.has(ref))) {
      if (!claims.has(ref)) claims.set(ref, { id: ref, rows: [] });
      claims.get(ref).rows.push(r);
      continue;
    }
    const t = String(r.text ?? r.what ?? '');
    const i = t.indexOf(' — ');
    const label = i > 0 && i <= 24 ? t.slice(0, i) : 'other';
    if (!notes.has(label)) notes.set(label, { label, rows: [] });
    notes.get(label).rows.push(r);
  }
  const lastAt = g => Math.max(...g.rows.map(r => Date.parse(r.at) || 0));
  const newest = (a, b) => lastAt(b) - lastAt(a);
  return {
    claims: [...claims.values()].map(g => {
      const v = g.rows.filter(r => r.kind === 'verdict').at(-1);
      return { ...g, last: v?.v ?? null, done: v?.v === 'confirm' };
    }).sort(newest),
    notes: [...notes.values()].sort(newest),
  };
}

const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s ?? '');
function render(rows) {
  return rows.map(r => {
    if (r.kind === 'claim') return `  ${r.id}  [claim]  ${r.what}\n        measure: ${r.how}`;
    if (r.kind === 'verdict') return `  ${r.id}  [${canon(r.v)}]  ${r.by}\n        ${short(r.note, 300)}`;
    return `  ${r.id ?? '-'}  [note]  ${r.by}: ${short(r.text, 200)}`;
  }).join('\n');
}

function main(argv) {
  const cmd = argv[0];
  const flag = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : null; };
  if (cmd === 'claim') {
    const r = claim({ what: argv[1], how: flag('how'), why: flag('why'), files: (flag('files') ?? '').split(',').filter(Boolean) });
    return console.log(`${r.id} added.\n${render([r])}`);
  }
  if (cmd === 'verdict') {
    const r = verdict({ id: argv[1], v: argv[2], note: argv[3], evidence: flag('evidence'), by: flag('by') ?? 'verifier' });
    const rounds = history(r.id).filter(x => x.kind === 'verdict').length;
    console.log(render([r]));
    if (r.v === 'confirm') console.log(`\n${r.id} closed.`);
    else if (rounds >= MAX_ROUNDS) console.log(`\n${r.id} went back and forth ${rounds} times. Hand it to the human.`);
    return;
  }
  if (cmd === 'note') return console.log(render([note({ id: flag('id'), by: flag('by') ?? 'builder', text: argv[1] })]));
  if (cmd === 'open') {
    const rows = open();
    if (!rows.length) return console.log('No open claims.');
    for (const c of rows) {
      console.log(`  ${c.id}  ${c.what}\n        measure: ${c.how}`);
      if (c.last) console.log(`        last: [${canon(c.last.v)}] ${short(c.last.note, 160)}`);
      if (c.stuck) console.log(`        ${c.rounds} rounds — the human's turn`);
    }
    return;
  }
  if (cmd === 'show') return console.log(render(history(argv[1])));
  if (cmd === 'log') return console.log(render(read()));
  console.log(`ledger — shared by the builder and the verifier session

  ledger.mjs claim "what" --how "command that measures it" [--why "..."] [--files a,b]
  ledger.mjs verdict C1 confirm|refute|hold "what you ran and saw" [--evidence "output"] [--by builder]
  ledger.mjs note "text" [--id C1] [--by verifier]
  ledger.mjs open | show C1 | log`);
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}

export function selftest(ok) {
  const dir = mkdtempSync(join(tmpdir(), 'as-ledger-'));
  const tmp = join(dir, 'ops', 'ledger.jsonl');
  const threw = f => { try { f(); return false; } catch { return true; } };
  try {
    ok('empty ledger is empty', read(tmp).length === 0 && open(tmp).length === 0);
    const c1 = claim({ what: 'classifier 56.3%', how: 'node train.mjs' }, tmp);
    ok('first id is C1', c1.id === 'C1');
    ok('a claim starts open', open(tmp).length === 1 && open(tmp)[0].rounds === 0);
    ok('ids continue', claim({ what: 'second', how: 'echo' }, tmp).id === 'C2');
    verdict({ id: 'C1', v: 'refute', note: 'got 54%' }, tmp);
    ok('refute keeps it open', open(tmp).some(c => c.id === 'C1'));
    ok('open claim carries its last verdict', open(tmp).find(c => c.id === 'C1').last.v === 'refute');
    verdict({ id: 'C1', v: '확인', note: 'seeded, 56.3% reproduced' }, tmp);
    ok('confirm closes (korean alias accepted)', !open(tmp).some(c => c.id === 'C1'));
    ok('alias is stored canonical', history('C1', tmp).at(-1).v === 'confirm');
    ok('reversals stay in history', history('C1', tmp).filter(r => r.kind === 'verdict').length === 2);
    for (let i = 0; i < MAX_ROUNDS; i++) verdict({ id: 'C2', v: 'hold', note: 'unsure ' + i }, tmp);
    ok('three rounds marks it stuck', open(tmp).find(c => c.id === 'C2').stuck === true);
    ok('claim without how is refused', threw(() => claim({ what: 'better now' }, tmp)));
    ok('unknown verdict is refused', threw(() => verdict({ id: 'C1', v: 'nice', note: 'x' }, tmp)));
    ok('verdict without evidence is refused', threw(() => verdict({ id: 'C1', v: 'confirm', note: '' }, tmp)));
    ok('verdict on a missing claim is refused', threw(() => verdict({ id: 'C99', v: 'confirm', note: 'x' }, tmp)));
    appendFileSync(tmp, '{"id":"C3","kind":"claim"');
    ok('half-written last line is skipped', read(tmp).filter(r => r.kind === 'claim').length === 2);
    const repo = join(dir, 'app'), wt = join(dir, 'app-ui');
    const gx = (...a) => execFileSync('git', a, { stdio: 'ignore' });
    mkdirSync(repo); gx('-C', repo, 'init', '-q', '-b', 'main');
    gx('-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'i');
    gx('-C', repo, 'worktree', 'add', '-q', '-b', 'agent/ui', wt);
    const old = process.env.OPS_LEDGER; delete process.env.OPS_LEDGER;
    try {
      ok('every worktree shares the main checkout ledger', ledgerPath(wt) === ledgerPath(repo)
         && ledgerPath(repo) === join(realpathSync(repo), 'ops', 'ledger.jsonl'), `${ledgerPath(wt)} | ${ledgerPath(repo)}`);
      claim({ what: 'x', how: 'echo' }, ledgerPath(repo));
      ok('the ledger folder does not show up in git status',
         execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === '');
    } finally { if (old !== undefined) process.env.OPS_LEDGER = old; }

    const at = i => new Date(1_000_000_000_000 + i * 1000).toISOString();
    const g = ledgerGroups([
      { kind: 'claim', id: 'C1', at: at(0) },
      { kind: 'verdict', id: 'C1', v: 'refute', at: at(1) },
      { kind: 'claim', id: 'C2', at: at(2) },
      { kind: 'verdict', id: 'C1', v: 'confirm', at: at(3) },
      { kind: 'note', id: null, text: 'C1 fix holds but assumes one thing', at: at(4) },
      { kind: 'note', id: null, text: 'Brief 1 — second rater', at: at(5) },
      { kind: 'note', id: null, text: 'Brief 1 — re-run', at: at(6) },
      { kind: 'note', id: null, text: 'Chart UI — tooltip z', at: at(7) },
      { kind: 'note', id: null, text: 'loose remark', at: at(8) },
    ]);
    const c = Object.fromEntries(g.claims.map(x => [x.id, x]));
    ok('last verdict confirm means done', c.C1.done && c.C1.last === 'confirm' && !c.C2.done);
    ok('note starting with an id joins that claim', c.C1.rows.length === 4);
    ok('notes group by their lead', g.notes.map(n => `${n.label}${n.rows.length}`).join() === 'other1,Chart UI1,Brief 12',
       g.notes.map(n => `${n.label}${n.rows.length}`).join());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
