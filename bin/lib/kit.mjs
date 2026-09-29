// Planned tools (agents.json) against what a worktree's .claude actually has.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAgents } from './agents.mjs';

/** What a worktree's .claude has. null where it can't be read — callers show the plan only. */
function installed(claudeDir) {
  let skills = null, plugins = null, model;
  try {
    skills = readdirSync(join(claudeDir, 'skills'), { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { /* not set up yet, or not visible */ }
  try { const j = JSON.parse(readFileSync(join(claudeDir, 'settings.local.json'), 'utf8')); plugins = j.enabledPlugins ?? {}; model = j.model ?? null; }
  catch { /* no file: global settings apply */ }
  return { skills, plugins, model };
}

/**
 * Compare a role's plan with its worktree. Each item gets st:
 *   ok · miss (planned, absent) · extra (present, not planned) · plan (couldn't look)
 * Skills no role declares but that are present are the repo's own (e.g. ops) — listed as shared.
 * @param declared every skill any role plans, so "another role's skill" can be told from "repo skill"
 */
export function kitOf(role, declared) {
  const got = installed(join(role.dir, '.claude'));
  const want = role.skills;
  const shared = (got.skills ?? []).filter(s => !declared.has(s));
  const skills = [
    ...want.map(name => ({ name, st: !got.skills ? 'plan' : got.skills.includes(name) ? 'ok' : 'miss' })),
    ...(got.skills ?? []).filter(s => !want.includes(s) && declared.has(s)).map(name => ({ name, st: 'extra' })),
  ];
  // Only plugins the plan names are judged; the rest follow global settings for every role.
  const plugins = Object.entries(role.plugins).flatMap(([k, on]) => {
    const name = k.split('@')[0];
    const now = got.plugins ? got.plugins[k] ?? null : undefined;
    if (now === undefined) return on ? [{ name, st: 'plan' }] : [];
    if (on) return [{ name, st: now === true ? 'ok' : 'miss' }];
    return now === true ? [{ name, st: 'extra' }] : [];
  });
  // model: undefined = settings not readable (plan), else what the worktree runs.
  const model = !role.model ? null
    : { name: role.model, now: got.model ?? null, st: got.model === undefined ? 'plan' : got.model === role.model ? 'ok' : 'miss' };
  return { skills, plugins, shared, model };
}

export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-kit-'));
  try {
    const repo = join(t, 'a'), sub = join(t, 'a-x');
    mkdirSync(join(repo, '.claude', 'skills', 'repo-skill'), { recursive: true });
    mkdirSync(join(repo, '.claude', 'skills', 'm1'), { recursive: true });
    for (const s of ['s2', 'm1', 'repo-skill']) mkdirSync(join(sub, '.claude', 'skills', s), { recursive: true });
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({
      main: { dir: '.', skills: ['m1'], plugins: { 'p@m': true } },
      sub: { dir: '../a-x', branch: 'b', skills: ['s1', 's2'], plugins: { 'p@m': true, 'q@m': false } },
    }));
    writeFileSync(join(sub, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'p@m': false, 'q@m': true } }));
    const { roles } = loadAgents(repo);
    const declared = new Set(roles.flatMap(r => r.skills));
    const R = n => roles.find(r => r.name === n);
    const st = xs => Object.fromEntries(xs.map(i => [i.name, i.st]));
    const k = kitOf(R('sub'), declared);
    ok('planned and installed skill is ok', st(k.skills).s2 === 'ok', JSON.stringify(k.skills));
    ok('planned but missing is miss', st(k.skills).s1 === 'miss');
    ok("another role's skill here is extra", st(k.skills).m1 === 'extra');
    ok('skill no role declares is shared', k.shared.join() === 'repo-skill' && !('repo-skill' in st(k.skills)));
    ok('plugin that should be on but is off is miss', st(k.plugins).p === 'miss', JSON.stringify(k.plugins));
    ok('plugin that should be off but is on is extra', st(k.plugins).q === 'extra');
    const m = kitOf(R('main'), declared);
    ok('no settings file means plugins are plan', st(m.plugins).p === 'plan' && st(m.skills).m1 === 'ok');
    ok('no planned model means no model item', k.model === null);
    writeFileSync(join(sub, '.claude', 'settings.local.json'), JSON.stringify({ model: 'opus' }));
    ok('a different model is miss', kitOf({ ...R('sub'), model: 'sonnet' }, declared).model?.st === 'miss');
    ok('the planned model is ok', kitOf({ ...R('sub'), model: 'opus' }, declared).model?.st === 'ok');
    ok('unreadable .claude means plan, not a crash',
       kitOf({ ...R('sub'), dir: join(t, 'does-not-exist') }, declared).skills.every(s => s.st === 'plan'));
  } finally { rmSync(t, { recursive: true, force: true }); }
}
