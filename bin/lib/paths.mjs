// Path rules shared by setup, status and board.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Claude Code's session-log folder name for a working directory:
 *  every char that is not [A-Za-z0-9] becomes '-'. C:\a\b -> C--a-b */
export function projectSlug(abs) {
  return String(abs).replace(/[^A-Za-z0-9]/g, '-');
}

/** Last path segment, either separator. */
export const leaf = p => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? null;

export const claudeHome = () => process.env.CLAUDE_HOME ?? join(homedir(), '.claude');

export function selftest(ok) {
  ok('windows path', projectSlug('C:\\Users\\a\\b') === 'C--Users-a-b');
  ok('posix path', projectSlug('/home/a/b') === '-home-a-b');
  ok('dot, space, hangul become -', projectSlug('C:\\M\\8. 주식감성\\s-s') === 'C--M-8-------s-s',
     projectSlug('C:\\M\\8. 주식감성\\s-s'));
  ok('leaf of either separator', leaf('C:\\a\\b') === 'b' && leaf('/a/b/') === 'b' && leaf('') === null);
}
