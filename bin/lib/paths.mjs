// Path rules shared by setup, status and board.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Is this module the script node was started with? Node resolves import.meta.url to the real path
 *  but keeps argv[1] as typed, so compare real paths — else a symlinked ~/.claude runs nothing. */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

/** Claude Code's session-log folder name for a working directory:
 *  every char that is not [A-Za-z0-9] becomes '-'. C:\a\b -> C--a-b */
export function projectSlug(abs) {
  return String(abs).replace(/[^A-Za-z0-9]/g, '-');
}

/** In a container the repo sits at another path than on the host, but the session logs are named
 *  after the host path. AGENTSEMBLE_PATH_MAP="/work=C:\Users\me\code" maps one back to the other. */
export function hostPath(abs, map = process.env.AGENTSEMBLE_PATH_MAP) {
  const i = map ? map.indexOf('=') : -1;
  if (i < 1) return abs;
  const from = map.slice(0, i).replace(/\/+$/, ''), to = map.slice(i + 1);
  return abs === from || abs.startsWith(from + '/') ? to + abs.slice(from.length) : abs;
}

/** Last path segment, either separator. */
export const leaf = p => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? null;

export const claudeHome = () => process.env.CLAUDE_HOME ?? join(homedir(), '.claude');

export function selftest(ok) {
  ok('windows path', projectSlug('C:\\Users\\a\\b') === 'C--Users-a-b');
  ok('posix path', projectSlug('/home/a/b') === '-home-a-b');
  ok('dot, space, hangul become -', projectSlug('C:\\M\\8. 주식감성\\s-s') === 'C--M-8-------s-s',
     projectSlug('C:\\M\\8. 주식감성\\s-s'));
  ok('path map turns a container path into the host path', hostPath('/work/app-team/web', '/work=C:\\M\\8. x') === 'C:\\M\\8. x/app-team/web'
     && projectSlug(hostPath('/work/app', '/work=C:\\M')) === projectSlug('C:\\M\\app'));
  ok('path map leaves other paths and a missing map alone', hostPath('/workshop/a', '/work=C:\\M') === '/workshop/a' && hostPath('/a', undefined) === '/a');
  ok('leaf of either separator', leaf('C:\\a\\b') === 'b' && leaf('/a/b/') === 'b' && leaf('') === null);
  const t = mkdtempSync(join(tmpdir(), 'as-paths-'));
  try {
    mkdirSync(join(t, 'real'));
    writeFileSync(join(t, 'real', 'm.mjs'), '');
    symlinkSync(join(t, 'real'), join(t, 'link'), 'junction');   // junction needs no admin rights on Windows
    const url = pathToFileURL(join(t, 'real', 'm.mjs')).href;
    ok('run through a symlink or junction still counts as main', isMain(url, join(t, 'link', 'm.mjs')));
    ok('another file is not main', !isMain(url, join(t, 'real', 'other.mjs')) && !isMain(url, undefined));
  } finally { rmSync(t, { recursive: true, force: true }); }
}
