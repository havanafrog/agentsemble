#!/usr/bin/env node
// Create each role's git worktree and give it the role's skills and plugins.
//
//   node bin/setup.mjs <role>|--all [--dry-run]
//
// A worktree has its own .claude/, so tools are per role:
//   .claude/skills/<name>        copies of the role's skills (from the skill stores)
//   .claude/settings.local.json  enabledPlugins only — every other key is left alone
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAgents } from './lib/agents.mjs';
import { claudeHome } from './lib/paths.mjs';

/** Put a role's skills and plugins into its worktree. Returns human-readable lines. */
export function applyRole(role, { stores, shared }) {
  const out = [];
  const sk = join(role.dir, '.claude', 'skills');
  mkdirSync(sk, { recursive: true });
  // Skills from another role are taken out. Repo-tracked ones (shared) stay.
  for (const f of readdirSync(sk).sort()) {
    if (!shared.includes(f) && !role.skills.includes(f)) { rmSync(join(sk, f), { recursive: true, force: true }); out.push(`- ${f}`); }
  }
  for (const s of role.skills) {
    const src = stores.map(d => join(d, s)).find(p => existsSync(p));
    if (!src) { out.push(`! ${s} not found (looked in ${stores.join(', ')})`); continue; }
    cpSync(src, join(sk, s), { recursive: true, force: true });
    out.push(`+ ${s}`);
  }
  const sf = join(role.dir, '.claude', 'settings.local.json');
  let cur = {};
  try { cur = JSON.parse(readFileSync(sf, 'utf8')); } catch { /* missing or broken: start fresh */ }
  cur.enabledPlugins = { ...(cur.enabledPlugins ?? {}), ...role.plugins };
  writeFileSync(sf, JSON.stringify(cur, null, 2) + '\n');
  const pl = Object.entries(role.plugins);
  if (pl.length) out.push(`plugins ${pl.map(([k, v]) => k.split('@')[0] + (v ? '' : '(-)')).join(' ')}`);
  return out;
}

export function ensureWorktree(repoRoot, role) {
  if (role.isMain || existsSync(role.dir)) return 'exists';
  const has = execFileSync('git', ['-C', repoRoot, 'branch', '--list', role.branch], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-q', role.dir, ...(has ? [role.branch] : ['-b', role.branch])],
    { stdio: 'pipe' });
  return 'created';
}

const IGNORE = ['.claude/settings.local.json', '.claude/skills/*'];
/** Keep per-role tool copies out of git. Returns true when lines were added. */
export function ensureGitignore(dir) {
  const f = join(dir, '.gitignore');
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const lines = cur.split(/\r?\n/);
  const add = IGNORE.filter(l => !lines.includes(l));
  if (!add.length) return false;
  writeFileSync(f, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '# agentsemble\n' + add.join('\n') + '\n');
  return true;
}

/** Skills the repo itself tracks under .claude/skills — every role keeps them. */
export function sharedSkills(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '.claude/skills'], { encoding: 'utf8' });
  return [...new Set(out.split('\n').filter(Boolean).map(p => p.split('/')[2]).filter(Boolean))];
}

export const skillStores = () => [join(claudeHome(), 'skill-store'), join(claudeHome(), 'skills')];

function main(argv) {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { roles, wishlist } = loadAgents(repo);
  const dry = argv.includes('--dry-run');
  const want = argv.includes('--all') ? roles : roles.filter(r => r.name === argv.find(a => !a.startsWith('--')));
  if (!want.length) {
    console.error(`usage: setup.mjs <${roles.map(r => r.name).join('|')}>|--all [--dry-run]`);
    process.exit(1);
  }
  const stores = skillStores(), shared = sharedSkills(repo);
  for (const r of want) {
    if (dry) {
      console.log(`${r.name} → ${r.dir}  (${r.isMain || existsSync(r.dir) ? 'exists' : 'would create'})`);
      console.log(`  skills ${r.skills.join(', ') || '-'}  plugins ${Object.keys(r.plugins).join(', ') || '-'}`);
      continue;
    }
    console.log(`${r.name} → ${r.dir}  (${ensureWorktree(repo, r)})`);
    for (const l of applyRole(r, { stores, shared })) console.log('  ' + l);
    if (!r.isMain) console.log(`  open it:  cd "${r.dir}" && claude    then  /rename ${r.name}`);
  }
  if (!dry && ensureGitignore(repo)) console.log('.gitignore: added .claude/settings.local.json and .claude/skills/*');
  if (wishlist.length) console.log(`\nwishlist (not installed): ${wishlist.join(' · ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));

export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-setup-'));
  const repo = join(t, 'app'), store = join(t, 'store');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  try {
    mkdirSync(repo); git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
    for (const s of ['taste', 'lexicon']) { mkdirSync(join(store, s), { recursive: true }); writeFileSync(join(store, s, 'SKILL.md'), s); }
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({
      main: { dir: '.' }, ui: { dir: '../app-ui', branch: 'agent/ui', skills: ['taste', 'ghost'],
      plugins: { 'p@m': true, 'q@m': false } } }));
    const { roles } = loadAgents(repo), ui = roles.find(r => r.name === 'ui');
    ok('creates the worktree', ensureWorktree(repo, ui) === 'created' && existsSync(join(t, 'app-ui', 'a.txt')));
    ok('second run does not recreate', ensureWorktree(repo, ui) === 'exists');
    mkdirSync(join(ui.dir, '.claude'), { recursive: true });
    writeFileSync(join(ui.dir, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Read(x)'] }, enabledPlugins: { 'other@x': true } }));
    const out1 = applyRole(ui, { stores: [store], shared: [] });
    const s1 = JSON.parse(readFileSync(join(ui.dir, '.claude', 'settings.local.json'), 'utf8'));
    ok('copies role skills', existsSync(join(ui.dir, '.claude', 'skills', 'taste', 'SKILL.md')));
    ok('reports missing skill with where it looked', out1.some(l => l.startsWith('! ghost') && l.includes(store)), out1.join(' | '));
    ok('leaves other settings alone', s1.permissions.allow[0] === 'Read(x)' && s1.enabledPlugins['other@x'] === true);
    ok('sets role plugins', s1.enabledPlugins['p@m'] === true && s1.enabledPlugins['q@m'] === false);
    const out2 = applyRole(ui, { stores: [store], shared: [] });
    ok('idempotent', JSON.stringify(out2) === JSON.stringify(out1), JSON.stringify([out1, out2]));
    mkdirSync(join(ui.dir, '.claude', 'skills', 'stale'), { recursive: true });
    mkdirSync(join(ui.dir, '.claude', 'skills', 'repo-skill'), { recursive: true });
    const out3 = applyRole(ui, { stores: [store], shared: ['repo-skill'] });
    ok('removes skills of other roles', !existsSync(join(ui.dir, '.claude', 'skills', 'stale')) && out3.includes('- stale'));
    ok('keeps repo-tracked skills', existsSync(join(ui.dir, '.claude', 'skills', 'repo-skill')));
    ok('adds gitignore lines once', ensureGitignore(repo) === true && ensureGitignore(repo) === false);
    mkdirSync(join(repo, '.claude', 'skills', 'ops'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'ops', 'SKILL.md'), 'ops');
    git('add', '-f', '.claude/skills/ops/SKILL.md'); git('commit', '-qm', 'ops');
    ok('finds repo-tracked skills', sharedSkills(repo).join() === 'ops');
  } finally { rmSync(t, { recursive: true, force: true }); }
}
