#!/usr/bin/env node
// Tokens and API list-price estimate for one session log.
//
//   node bin/cost.mjs <session.jsonl>
//
// Logs carry token counts, not money: multiply by list prices below. This is the API list
// price, NOT your bill (subscriptions bill differently). Unknown models count as 0 and are
// reported as unpriced rows — edit PRICES rather than trust a made-up number.
//
// Logs are append-only and can be tens of MB while the board refreshes every 2s, so each file
// is read incrementally: remember where we stopped, read only what was added.
import { statSync, openSync, readSync, closeSync } from 'node:fs';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';   // selftest only
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// USD per 1M tokens. Cache prices are multiples of the input price.
export const PRICES = {
  'claude-opus-5': { in: 5, out: 25, fast: { in: 10, out: 50 } },
  'claude-opus-4-8': { in: 5, out: 25, fast: { in: 10, out: 50 } },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-mythos-5': { in: 10, out: 50 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

// Cache multipliers: read 0.1x input, write 1.25x (5 min) or 2x (1 h).
export const CACHE_READ = 0.1;
export const WRITE_5M = 1.25;
export const WRITE_1H = 2;

const M = 1_000_000;

/** One row's cost. Unknown model -> 0; never invent a price. */
export function rowCost(u, model) {
  const p = PRICES[model];
  if (!p) return 0;
  const rate = u.speed === 'fast' && p.fast ? p.fast : p;
  // Old rows without cache_creation count as 5-minute writes.
  const c = u.cache_creation ?? {};
  const w1h = c.ephemeral_1h_input_tokens ?? 0;
  const w5m = c.ephemeral_5m_input_tokens
    ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (u.input_tokens ?? 0) * rate.in
    + (u.output_tokens ?? 0) * rate.out
    + (u.cache_read_input_tokens ?? 0) * rate.in * CACHE_READ
    + w5m * rate.in * WRITE_5M
    + w1h * rate.in * WRITE_1H
  ) / M;
}

const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0, rows: 0, unpriced: 0 });

/** Add these lines to a running sum. Pure, so it is easy to test. */
export function add(sum, lines) {
  for (const l of lines) {
    if (!l) continue;
    let j = null;
    try { j = JSON.parse(l); } catch { continue; }
    const u = j?.message?.usage;
    if (!u) continue;
    const c = u.cache_creation ?? {};
    sum.in += u.input_tokens ?? 0;
    sum.out += u.output_tokens ?? 0;
    sum.cacheRead += u.cache_read_input_tokens ?? 0;
    sum.cacheWrite += (c.ephemeral_1h_input_tokens ?? 0)
      + (c.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0);
    sum.usd += rowCost(u, j?.message?.model);
    if (!PRICES[j?.message?.model]) sum.unpriced++;
    sum.rows++;
  }
  return sum;
}

// Per file: how far we have counted. The board stays up, so memory is enough.
const SEEN = new Map();

/** Totals for one log, reading only what was appended since last time. A file that shrank was replaced: start over. */
export function tally(file, seen = SEEN) {
  let size = 0;
  try { size = statSync(file).size; } catch { return zero(); }

  let mark = seen.get(file);
  if (!mark || mark.at > size) mark = { at: 0, sum: zero() };

  if (size > mark.at) {
    const span = size - mark.at;
    const buf = Buffer.alloc(span);
    const h = openSync(file, 'r');
    try { readSync(h, buf, 0, span, mark.at); } finally { closeSync(h); }
    // Count up to the last newline; after it is a line still being written.
    // Cutting at a newline also keeps the slice valid UTF-8.
    const cut = buf.lastIndexOf(0x0a);
    if (cut >= 0) {
      add(mark.sum, buf.subarray(0, cut).toString('utf8').split('\n'));
      mark.at += cut + 1;
    }
  }
  seen.set(file, mark);
  return { ...mark.sum };
}

export function selftest(ok) {

  ok('input price', rowCost({ input_tokens: M }, 'claude-opus-5') === 5);
  ok('output price', rowCost({ output_tokens: M }, 'claude-opus-5') === 25);
  ok('cache read is 0.1x',
     rowCost({ cache_read_input_tokens: M }, 'claude-opus-5') === 0.5);
  ok('5m cache write is 1.25x', rowCost({
     cache_creation: { ephemeral_5m_input_tokens: M } }, 'claude-opus-5') === 6.25);
  ok('1h cache write is 2x', rowCost({
     cache_creation: { ephemeral_1h_input_tokens: M } }, 'claude-opus-5') === 10);
  ok('fast mode doubles', rowCost({ input_tokens: M, speed: 'fast' }, 'claude-opus-5') === 10);
  ok('unknown model costs 0', rowCost({ input_tokens: M }, '<synthetic>') === 0
     && rowCost({ input_tokens: M }, undefined) === 0);
  ok('old rows count as 5m writes', rowCost({ cache_creation_input_tokens: M }, 'claude-opus-5') === 6.25);

  const line = (o) => JSON.stringify({ message: { model: 'claude-opus-5', usage: o } });
  const rows = Array.from({ length: 40 }, (_, i) => line({
    input_tokens: i, output_tokens: 100,
    cache_read_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
  }));

  const f = join(tmpdir(), `as-cost-${process.pid}.jsonl`);
  writeFileSync(f, rows.slice(0, 25).join('\n') + '\n');

  const step = new Map();
  const a = tally(f, step);                    // first 25 rows
  appendFileSync(f, rows.slice(25).join('\n') + '\n');
  const b = tally(f, step);                    // only the next 15
  const whole = tally(f, new Map());           // whole file
  ok('counts the first part', a.rows === 25, String(a.rows));
  ok('incremental equals whole read',
     b.rows === whole.rows && Math.abs(b.usd - whole.usd) < 1e-12
     && b.in === whole.in && b.cacheWrite === whole.cacheWrite,
     `${b.rows}/${whole.rows} ${b.usd}/${whole.usd}`);
  ok('never counts twice', b.rows === 40, String(b.rows));

  appendFileSync(f, '{"message":{"model":"claude-opus-5","usage":{"input_tok');
  const half = tally(f, step);
  ok('skips a half-written line', half.rows === 40, String(half.rows));
  appendFileSync(f, 'ens":1000000}}}\n');
  ok('counts it once complete', tally(f, step).rows === 41);

  writeFileSync(f, rows[0] + '\n');
  const fresh = tally(f, step);
  ok('a shrunken file is recounted', fresh.rows === 1, String(fresh.rows));

  unlinkSync(f);
  const g = join(tmpdir(), `as-cost-u-${process.pid}.jsonl`);
  writeFileSync(g, JSON.stringify({ message: { model: 'claude-future-9', usage: { input_tokens: 5 } } }) + '\n');
  const u = tally(g, new Map());
  unlinkSync(g);
  ok('unknown-model rows are reported as unpriced, not priced', u.unpriced === 1 && u.usd === 0 && u.rows === 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const f = process.argv[2];
  if (!f) { console.error('usage: cost.mjs <session.jsonl>'); process.exit(1); }
  const t = tally(f);
  console.log(JSON.stringify({ ...t, usd: +t.usd.toFixed(4) }, null, 2));
}
