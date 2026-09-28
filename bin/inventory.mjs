#!/usr/bin/env node
// What this machine has installed: plugins (on/off) and skills, so /agentsemble can propose
// from real tools. A script, because a sandboxed session may not be allowed to read ~/.claude itself.
//
//   node bin/inventory.mjs
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeHome, isMain } from './lib/paths.mjs';

const json = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const dirs = d => { try { return readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };

/** { plugins: [{ id, on, skills }], skills: [{ name, where }] } */
export function inventory(home = claudeHome()) {
  const enabled = json(join(home, 'settings.json'))?.enabledPlugins ?? {};
  const installed = json(join(home, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  const plugins = Object.entries(installed).map(([id, installs]) => {
    // Prefer the user-scope install; project-scope ones belong to one repo.
    const i = installs.find(x => x.scope === 'user') ?? installs[0] ?? {};
    return { id, on: enabled[id] === true, skills: i.installPath ? dirs(join(i.installPath, 'skills')) : [] };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const skills = ['skills', 'skill-store'].flatMap(w => dirs(join(home, w)).map(name => ({ name, where: w })));
  return { plugins, skills };
}

function main() {
  const { plugins, skills } = inventory();
  console.log('plugins (on = enabled for every session unless a role switches it off):');
  for (const p of plugins) console.log(`  ${p.on ? 'on ' : 'off'}  ${p.id}${p.skills.length ? '  skills: ' + p.skills.join(', ') : ''}`);
  console.log('\nskills:');
  for (const s of skills) console.log(`  ${s.name}  (${s.where === 'skills' ? 'global — every session gets it' : 'skill-store — only roles that list it'})`);
  if (!plugins.length && !skills.length) console.log('  none found');
}

if (isMain(import.meta.url)) main();

export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-inv-'));
  try {
    ok('empty home is empty, not an error', (() => { const r = inventory(t); return !r.plugins.length && !r.skills.length; })());
    mkdirSync(join(t, 'plugins', 'cache', 'p', 'skills', 'ops'), { recursive: true });
    writeFileSync(join(t, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'p@m': [{ scope: 'local', installPath: join(t, 'nowhere') }, { scope: 'user', installPath: join(t, 'plugins', 'cache', 'p') }],
      'q@m': [{ scope: 'user', installPath: join(t, 'gone') }] } }));
    writeFileSync(join(t, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true, 'q@m': false } }));
    mkdirSync(join(t, 'skills', 'taste'), { recursive: true });
    mkdirSync(join(t, 'skill-store', 'lexicon'), { recursive: true });
    const r = inventory(t);
    ok('lists plugins with on/off', r.plugins.map(p => `${p.id}:${p.on}`).join() === 'p@m:true,q@m:false');
    ok('reads plugin skills from the user-scope install', r.plugins[0].skills.join() === 'ops');
    ok('a missing install path gives no skills, not a crash', r.plugins[1].skills.length === 0);
    ok('lists global and store skills', r.skills.map(s => `${s.name}@${s.where}`).join() === 'taste@skills,lexicon@skill-store');
  } finally { rmSync(t, { recursive: true, force: true }); }
}
