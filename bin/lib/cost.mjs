// What a window has cost, from the usage Claude Code logs with every API response.
//
// The token counts are the API's own; the dollars are ours: tokens × the list prices below.
// So it is what the same traffic would cost on the API — on a subscription plan nobody is billed it.
// Not in the log, so not counted: Claude Code's side calls (titles, compaction summaries) and
// anything a window spent before its log began.
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync, mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// $ per million tokens: input, 5m cache write, 1h cache write, cache read, output.
// platform.claude.com/docs/en/about-claude/pricing, 2026-10. First match wins, so newer before older.
// ponytail: hand-copied table, goes stale when prices change; unknown models show as unpriced, not $0.
export const PRICES = [
  [/^claude-(fable|mythos)-5-1/, [10, 12.5, 20, 0.25, 50]],
  [/^claude-(fable|mythos)-5/, [10, 12.5, 20, 1, 50]],
  [/^claude-opus-5-5/, [4, 5, 8, 0.2, 20]],
  [/^claude-opus-(5|4-[5-8])/, [5, 6.25, 10, 0.5, 25]],
  [/^claude-opus-4/, [15, 18.75, 30, 1.5, 75]],
  [/^claude-sonnet-5-5/, [2, 2.5, 4, 0.1, 10]],
  [/^claude-sonnet-5/, [2, 2.5, 4, 0.2, 10]],
  [/^claude-sonnet-4/, [3, 3.75, 6, 0.3, 15]],
  [/^claude-haiku-5-5/, [0.1, 0.125, 0.2, 0.01, 0.5]],
  [/^claude-haiku-4/, [1, 1.25, 2, 0.1, 5]],
  [/^claude-3-5-haiku/, [0.8, 1, 1.6, 0.08, 4]],
];
const HAIKU_LONG = 100_000;     // Haiku 5.5 prompts over this pay 5× on every category
const SEARCH_USD = 0.01;        // web search: $10 per 1,000

/** One response's usage → dollars, or null when the model isn't in the table. */
export function costOf(usage, model) {
  const id = String(model ?? '').replace(/\[.*\]$/, '');
  const p = PRICES.find(([re]) => re.test(id))?.[1];
  if (!p || !usage) return null;
  const inp = usage.input_tokens ?? 0, read = usage.cache_read_input_tokens ?? 0, out = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = usage.cache_creation ? usage.cache_creation.ephemeral_5m_input_tokens ?? 0 : cw;
  let usd = (inp * p[0] + w5m * p[1] + w1h * p[2] + read * p[3] + out * p[4]) / 1e6;
  if (/^claude-haiku-5-5/.test(id) && inp + cw + read > HAIKU_LONG) usd *= 5;
  if (usage.speed === 'fast') usd *= 2;
  if (usage.inference_geo === 'us') usd *= 1.1;
  return usd + (usage.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD;
}

// Per file: how far we've read and what it summed to. Logs only grow, so each tick reads the new tail.
const FILES = new Map();
const CHUNK = 4 * 1024 * 1024;

/** Sum one log. A response is logged once per content block, so count each message id once. */
export function fileCost(file) {
  let st;
  try { st = statSync(file); } catch { return null; }
  let c = FILES.get(file);
  if (!c || st.size < c.pos) c = { pos: 0, ids: new Set(), usd: 0, tokens: 0, out: 0, unpriced: 0, ctx: 0, model: null };
  if (st.size > c.pos) {
    const h = openSync(file, 'r');
    try {
      while (c.pos < st.size) {
        const buf = Buffer.alloc(Math.min(CHUNK, st.size - c.pos));
        readSync(h, buf, 0, buf.length, c.pos);
        const end = buf.lastIndexOf(10);          // whole lines only; a half-written one waits for next time
        if (end < 0) { if (buf.length < CHUNK) break; c.pos += buf.length; continue; }   // one line over 4 MB: skip it
        for (const l of buf.subarray(0, end).toString('utf8').split('\n')) add(c, l);
        c.pos += end + 1;
      }
    } finally { closeSync(h); }
  }
  FILES.set(file, c);
  return c;
}

function add(c, line) {
  if (!line.includes('"usage"')) return;
  let r;
  try { r = JSON.parse(line); } catch { return; }
  const m = r.message, u = m?.usage;
  if (!u || m.role !== 'assistant') return;
  const key = m.id ?? r.requestId ?? r.uuid;
  if (key && c.ids.has(key)) return;
  if (key) c.ids.add(key);
  const prompt = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  c.tokens += prompt + (u.output_tokens ?? 0);
  c.out += u.output_tokens ?? 0;
  const usd = costOf(u, m.model);
  if (usd === null) { if (prompt + (u.output_tokens ?? 0) > 0) c.unpriced++; }
  else c.usd += usd;
  if (!r.isSidechain && prompt > 0) { c.ctx = prompt; c.model = m.model; }   // what the window carries now
}

/**
 * A window's cost: its own log plus the subagents it spawned (<id>/subagents/*.jsonl).
 * → { usd, tokens, out, ctx, model, unpriced, subUsd } or null when there is no log.
 */
export function sessionCost(dir, id) {
  const own = fileCost(join(dir, id + '.jsonl'));
  if (!own) return null;
  const sub = join(dir, id, 'subagents');
  let subUsd = 0, subTok = 0, unpriced = own.unpriced;
  if (existsSync(sub)) {
    let fs = [];
    try { fs = readdirSync(sub).filter(f => f.endsWith('.jsonl')); } catch { /* unreadable: own log only */ }
    for (const f of fs) {
      const s = fileCost(join(sub, f));
      if (s) { subUsd += s.usd; subTok += s.tokens; unpriced += s.unpriced; }
    }
  }
  return { usd: own.usd + subUsd, tokens: own.tokens + subTok, out: own.out, ctx: own.ctx, model: own.model, unpriced, subUsd };
}

export function selftest(ok) {
  const u = { input_tokens: 2, cache_creation_input_tokens: 64209, cache_read_input_tokens: 31588, output_tokens: 604,
    cache_creation: { ephemeral_1h_input_tokens: 64209, ephemeral_5m_input_tokens: 0 }, speed: 'standard', inference_geo: 'global' };
  const want = (2 * 4 + 64209 * 8 + 31588 * 0.2 + 604 * 20) / 1e6;
  ok('opus 5.5 response priced from the table', Math.abs(costOf(u, 'claude-opus-5-5') - want) < 1e-12);
  ok('opus 5.5 is not priced as opus 5', costOf(u, 'claude-opus-5-5') < costOf(u, 'claude-opus-5'));
  ok('fast mode doubles, US-only adds 10%', Math.abs(costOf({ ...u, speed: 'fast' }, 'claude-opus-5-5') - 2 * want) < 1e-12
     && Math.abs(costOf({ ...u, inference_geo: 'us' }, 'claude-opus-5-5') - 1.1 * want) < 1e-12);
  ok('no TTL breakdown: writes priced as 5m', costOf({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-4-6') === 3.75);
  ok('haiku 5.5 over 100k prompt pays 5×', costOf({ input_tokens: 200_000 }, 'claude-haiku-5-5') === 0.1);
  ok('web search adds a cent each', Math.abs(costOf({ server_tool_use: { web_search_requests: 3 } }, 'claude-sonnet-5-5') - 0.03) < 1e-12);
  ok('[1m] suffix ignored, unknown model is null', costOf({ output_tokens: 1e6 }, 'claude-opus-5-5[1m]') === 20
     && costOf({ output_tokens: 1 }, '<synthetic>') === null);

  const t = mkdtempSync(join(tmpdir(), 'as-cost-'));
  try {
    const row = (id, out, extra = {}) => JSON.stringify({ message: { id, role: 'assistant', model: 'claude-opus-5-5',
      usage: { input_tokens: 1000, output_tokens: out } }, ...extra }) + '\n';
    const f = join(t, 's1.jsonl');
    writeFileSync(f, row('a', 100) + row('a', 100) + row('b', 200));
    const one = (1000 * 4 + 100 * 20) / 1e6, two = (1000 * 4 + 200 * 20) / 1e6;
    ok('a response logged twice counts once', Math.abs(sessionCost(t, 's1').usd - (one + two)) < 1e-12);
    appendFileSync(f, row('c', 300, { isSidechain: true }) + '{"message":{"usage"');
    const c = sessionCost(t, 's1');
    ok('appended lines are added, a half-written line waits', Math.abs(c.usd - (one + two + (1000 * 4 + 300 * 20) / 1e6)) < 1e-12);
    ok('context is the last main-chain prompt', c.ctx === 1000 && c.model === 'claude-opus-5-5');
    mkdirSync(join(t, 's1', 'subagents'), { recursive: true });
    writeFileSync(join(t, 's1', 'subagents', 'x.jsonl'), row('d', 0));
    ok('subagent logs add to the window', Math.abs(sessionCost(t, 's1').subUsd - 0.004) < 1e-12);
    ok('no log is null', sessionCost(t, 'nope') === null);
  } finally { rmSync(t, { recursive: true, force: true }); }
}
