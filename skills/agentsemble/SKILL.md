---
name: agentsemble
description: Read this repo, propose a team of Claude Code sessions (one main + 2-4 subs, each in its own git worktree with its own skills and plugins), set it up after the human approves, and watch it on a local board. Use for "/agentsemble", "set up an agent team", "split this work across sessions", "/agentsemble status", "/agentsemble add <role>", "/agentsemble board".
---

# agentsemble

Assemble a team of Claude Code sessions for this repo and keep it in tune.

Scripts live in the plugin; call them as `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>"` from the repo root.

| Command | What happens |
|---|---|
| `/agentsemble` | steps 0-5 below |
| `/agentsemble status` | `status.mjs` — plan vs installed tools, per role |
| `/agentsemble add <role>` | steps 2-4 for one extra role |
| `/agentsemble board` | start `board.mjs`, give the URL |
| `/ops verify` · `/ops claim` · `/ops status` | the builder/verifier ledger (ops skill) |

## 0. Check the ground

- Not a git repo → stop and suggest `git init` (with a first commit — worktrees need one).
- `agents.json` already exists → do not redesign. Run `status.mjs`, show the result, and ask
  whether they want `add`, a redesign, or nothing.

## 1. Understand the project (read only)

Read: README, the tree two levels deep, language and build/test commands, the last 30 commits,
any TODO or plan files, installed plugins (`~/.claude/settings.json` → `enabledPlugins`) and
skills (`~/.claude/skills`, `~/.claude/skill-store`).

Show the human 5-10 lines:
- what the project is
- the strands of work (for example: UI / server / model training)
- files two strands would both touch

Let them correct it, then continue.

## 2. Propose the team — then stop

One `main` plus 2-4 sub roles. For each role give:

| field | meaning |
|---|---|
| what / not | one line each |
| owns | files and folders it mainly changes |
| dir / branch | `../<repo>-team/<role>` and `agent/<role>` — all sub folders together in one team folder |
| skills | chosen from what is installed, with a reason |
| plugins | which to switch on or off for this role |

- If two roles would edit the same file, say so and give it one owner.
- Tools a role needs but the human doesn't have go in `wishlist`. Never install anything.
- Cost, one line: "Each extra session pays its own fixed context cost. If the work fits in
  ~30 minutes, say so and suggest staying solo."

Under the table, list every folder setup will create, one per line, and say each is a full
checkout of the repo:

```
Will create 3 folders next to your repo (each a full checkout):
  ../shop-team/web   ../shop-team/api   ../shop-team/ml
```

New folders must never surprise the human.

**Stop here and wait for the human to approve the table.** Do not run setup without an explicit yes.

## 3. Set it up

Write `agents.json` at the repo root (schema: `${CLAUDE_PLUGIN_ROOT}/agents.schema.json`), commit it,
then run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --all
```

Show its output as is — one block per role. Lines starting with `!` are skills it could not find.

## 4. Open the windows

The human opens them; give one copyable pair per sub role:

```
cd "<dir>" && claude
/rename <role>
```

The name matters: main addresses subs by it with `SendMessage`.

## 5. How the team works

Tell main (this session) and put the same rules in the first message to each sub.

**Main**
- Split the work and send each sub a self-contained brief with `SendMessage`: goal, files, how
  it will be checked, what not to touch.
- When a sub reports, run its check yourself before merging. Record verdicts with the ops ledger
  when the claim matters.
- Merge subs' branches into main yourself; subs never merge.
- Never ask a sub-session to perform an action that was denied in its own window — that bypasses
  the human's permission decision. Bring it back to the human.
- If the human is following only the main window (for example from a phone), relay sub-session
  questions and approvals through main: subs send questions to main, main asks the human, main
  sends the answer back.

**Subs**
- Report back with: what changed, how it was checked (commands and numbers), commit hashes.
- Don't merge into main. Don't edit files another role owns.
- Questions and approvals go to main, not straight to the human.

Finally give the board:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/board.mjs"      →  http://127.0.0.1:8740
```

It shows the team tree, each session's latest moves, plan-vs-installed tools, the ledger and an
API list-price cost estimate. It is read-only and shows whole transcripts — keep it on localhost.
