#!/usr/bin/env node
// Create each role's git worktree and give it the role's skills and plugins.
//
//   node bin/setup.mjs <role>|--all [--dry-run]
//
// A worktree has its own .claude/, so tools are per role:
//   .claude/skills/<name>        copies of the role's skills (from the skill stores)
//   .claude/settings.local.json  enabledPlugins only — every other key is left alone
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAgents } from './lib/agents.mjs';
import { claudeHome, isMain } from './lib/paths.mjs';

// Setup only ever deletes what it copied itself; the names are kept here, inside the worktree.
const MARK = '.agentsemble.json';

/** Put a role's skills and plugins into its worktree. Returns human-readable lines. */
export function applyRole(role, { stores, shared }) {
  const out = [];
  const sk = join(role.dir, '.claude', 'skills');
  const markFile = join(sk, MARK);
  const sf = join(role.dir, '.claude', 'settings.local.json');
  // Nothing to give and nothing given before: leave the folder untouched.
  if (!role.skills.length && !Object.keys(role.plugins).length && !existsSync(markFile)) return out;
  mkdirSync(sk, { recursive: true });
  let mine = [];
  try { mine = JSON.parse(readFileSync(markFile, 'utf8')).copied ?? []; } catch { /* first run */ }
  // Take out skills this tool copied for an earlier plan. The user's own and repo-tracked ones stay.
  for (const f of [...mine].sort()) {
    if (role.skills.includes(f) || shared.includes(f)) continue;
    rmSync(join(sk, f), { recursive: true, force: true });
    out.push(`- ${f}`);
  }
  const copied = [];
  for (const s of role.skills) {
    const src = stores.map(d => join(d, s)).find(p => existsSync(p));
    if (!src) { out.push(`! ${s} not found (looked in ${stores.join(', ')})`); continue; }
    cpSync(src, join(sk, s), { recursive: true, force: true });
    copied.push(s);
    out.push(`+ ${s}`);
  }
  writeFileSync(markFile, JSON.stringify({ copied }, null, 2) + '\n');
  let cur = {};
  if (existsSync(sf)) {
    // A hand-edited file that doesn't parse would lose the user's permissions if rewritten. Stop instead.
    try { cur = JSON.parse(readFileSync(sf, 'utf8')); }
    catch (e) { throw new Error(`${sf} is not valid JSON (${e.message}); fix it and run setup again`); }
  }
  cur.enabledPlugins = { ...(cur.enabledPlugins ?? {}), ...role.plugins };
  writeFileSync(sf, JSON.stringify(cur, null, 2) + '\n');
  const pl = Object.entries(role.plugins);
  if (pl.length) out.push(`plugins ${pl.map(([k, v]) => k.split('@')[0] + (v ? '' : '(-)')).join(' ')}`);
  return out;
}

const gitOut = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const commonDir = dir => realpathSync(resolve(dir, gitOut(dir, 'rev-parse', '--git-common-dir')));

export function ensureWorktree(repoRoot, role) {
  if (role.isMain) return 'exists';
  if (existsSync(role.dir)) {
    // Only reuse a folder that is a worktree of this repo — never someone else's project next door.
    let same = false;
    try { same = commonDir(role.dir) === commonDir(repoRoot); } catch { /* not a git folder */ }
    if (!same) throw new Error(`${role.dir} exists but is not a worktree of this repo; move it or change "dir" for ${role.name}`);
    return 'exists';
  }
  const has = execFileSync('git', ['-C', repoRoot, 'branch', '--list', role.branch], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-q', role.dir, ...(has ? [role.branch] : ['-b', role.branch])],
    { stdio: 'pipe' });
  return 'created';
}

/** Folders setup would create, so the human sees them before saying yes. */
export const planFolders = roles => roles.filter(r => !r.isMain && !existsSync(r.dir)).map(r => r.dir);

const IGNORE = ['.claude/settings.local.json', '.claude/skills/*'];
/** Keep per-role tool copies out of git in every worktree: info/exclude is shared by all of them,
 *  needs no commit, and leaves the user's tracked .gitignore alone. Returns true when lines were added. */
export function ensureExclude(repoRoot) {
  const f = join(commonDir(repoRoot), 'info', 'exclude');
  mkdirSync(dirname(f), { recursive: true });
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
  if (dry) {
    const nf = planFolders(want);
    console.log(nf.length ? `will create ${nf.length} folder(s), each a full checkout of the repo:\n${nf.map(d => '  ' + d).join('\n')}\n`
      : 'no new folders\n');
  }
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
  if (!dry && ensureExclude(repo)) console.log('git info/exclude: added .claude/settings.local.json and .claude/skills/* (all worktrees)');
  if (wishlist.length) console.log(`\nwishlist (not installed): ${wishlist.join(' · ')}`);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));

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
    mkdirSync(join(ui.dir, '.claude', 'skills', 'users-own'), { recursive: true });
    const out3 = applyRole({ ...ui, skills: [] }, { stores: [store], shared: [] });
    ok('removes only skills setup copied itself', !existsSync(join(ui.dir, '.claude', 'skills', 'taste')) && out3.includes('- taste'));
    ok("never removes a skill it didn't copy", existsSync(join(ui.dir, '.claude', 'skills', 'users-own')));
    const main = roles.find(r => r.isMain);
    applyRole(main, { stores: [store], shared: [] });
    ok('a role with no skills or plugins gets no .claude folder', !existsSync(join(repo, '.claude')));
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({
      main: { dir: '.' }, api: { dir: '../app-team/api', branch: 'agent/api' } }));
    const api = loadAgents(repo).roles.find(r => r.name === 'api');
    ok('plan lists the folders it will create', planFolders(loadAgents(repo).roles).join() === join(t, 'app-team', 'api'));
    ok('creates a worktree inside the team folder', ensureWorktree(repo, api) === 'created' && existsSync(join(t, 'app-team', 'api', 'a.txt')));
    ok('plan is empty once they exist', planFolders(loadAgents(repo).roles).length === 0);
    mkdirSync(join(repo, '.claude', 'skills', 'my-private-skill'), { recursive: true });
    applyRole(main, { stores: [store], shared: [] });
    ok('main checkout keeps untracked skills', existsSync(join(repo, '.claude', 'skills', 'my-private-skill')));
    ok('excludes tool copies in every worktree, once', ensureExclude(repo) === true && ensureExclude(repo) === false
       && !/.claude/.test(execFileSync('git', ['-C', ui.dir, 'status', '--porcelain'], { encoding: 'utf8' })));
    ok('leaves the tracked .gitignore alone', !existsSync(join(repo, '.gitignore')));
    mkdirSync(join(t, 'app-x', '.claude', 'skills', 'keep'), { recursive: true });
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({ main: { dir: '.' }, x: { dir: '../app-x', branch: 'agent/x' } }));
    const x = loadAgents(repo).roles.find(r => r.name === 'x');
    ok('refuses an existing folder that is not our worktree', (() => { try { ensureWorktree(repo, x); return false; } catch (e) { return /not a worktree/.test(e.message); } })()
       && existsSync(join(t, 'app-x', '.claude', 'skills', 'keep')));
    mkdirSync(join(repo, '.claude', 'skills', 'ops'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'ops', 'SKILL.md'), 'ops');
    git('add', '-f', '.claude/skills/ops/SKILL.md'); git('commit', '-qm', 'ops');
    ok('finds repo-tracked skills', sharedSkills(repo).join() === 'ops');
  } finally { rmSync(t, { recursive: true, force: true }); }
}
