#!/usr/bin/env node
// One line per role: does its worktree have what agents.json plans? Exit 1 when something is off.
import { execFileSync } from 'node:child_process';
import { loadAgents } from './lib/agents.mjs';
import { kitOf } from './lib/kit.mjs';

let repo, roles, wishlist;
try {
  repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  ({ roles, wishlist } = loadAgents(repo));
} catch (e) { console.error(repo ? e.message : 'not a git repo'); process.exit(1); }
const declared = new Set(roles.flatMap(r => r.skills));
let bad = 0;
for (const r of roles) {
  const k = kitOf(r, declared);
  const off = [...k.skills, ...k.plugins, ...(k.model ? [{ ...k.model, name: 'model ' + k.model.name + (k.model.now ? ' (now ' + k.model.now + ')' : '') }] : [])]
    .filter(i => i.st === 'miss' || i.st === 'extra');
  bad += off.length;
  console.log(`${r.name.padEnd(8)} ${off.length ? off.map(i => (i.st === 'miss' ? 'missing ' : 'extra ') + i.name).join(', ') : 'ok'}`
    + (k.skills.some(i => i.st === 'plan') ? '  (not set up yet — node bin/setup.mjs ' + r.name + ')' : '')
    + `  [${r.shared ? 'shares main folder · ' : ''}${r.autonomy}${r.model && !off.some(i => i.name.startsWith('model')) ? ' · ' + r.model : ''}]`
    + (k.shared.length ? `  [repo skills: ${k.shared.join(', ')}]` : ''));
}
if (wishlist.length) console.log(`wishlist: ${wishlist.join(' · ')}`);
process.exit(bad ? 1 : 0);
