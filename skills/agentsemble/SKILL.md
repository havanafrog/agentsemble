---
name: agentsemble
description: Read this repo, propose a team of Claude Code sessions (one main + subs; only roles that edit files get their own git worktree), set it up after the human approves, watch it on a local board, and keep a builder/verifier ledger. Use for "/agentsemble", "set up an agent team", "split this work across sessions", "/agentsemble status | add <role> | board", and the ledger — "/agentsemble verify", "/agentsemble claim", "/agentsemble claims", "/agentsemble send".
---

# agentsemble

Assemble a team of Claude Code sessions for this repo and keep it in tune.

Scripts live in the plugin; call them as `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>"` from the repo root.

| Command | What happens |
|---|---|
| `/agentsemble` | steps 0-5 below |
| `/agentsemble status` | `status.mjs` — plan vs installed tools, per role |
| `/agentsemble add <role>` | steps 2-4 for one extra role |
| `/agentsemble board` | start `board.mjs` in the background (it keeps running), give the URL |
| `/agentsemble verify` · `claim` · `claims` · `send` | the builder/verifier ledger — **read `references/ledger.md` first** and follow it; skip the steps below |

(`/ops …` from older versions means the same ledger commands.)

## 0. Check the ground

- Not a git repo, or a repo with no commit yet → the human may never have used git. Explain in
  one or two plain lines why the team needs it (each session gets its own copy to work in, and
  main merges their work back), then ask: "Make this folder a git repo and save a first snapshot?"
  On yes run `node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs"`. It runs `git init`, adds a starter
  `.gitignore` (node_modules, .env, logs …) only when none exists, and makes the first commit.
  It stops and lists files that look like secrets or are over 50 MB — show that list and let the
  human choose; never add them yourself. If git is missing it says where to install it.
  On no, stop.
- `agents.json` already exists → do not redesign. Run `status.mjs`, show the result, and ask
  whether they want `add`, a redesign, or nothing.

## 1. Understand the project (read only)

Read: README, the tree two levels deep, language and build/test commands, the last 30 commits,
any TODO or plan files. For installed plugins and skills run
`node "${CLAUDE_PLUGIN_ROOT}/bin/inventory.mjs"` — do not read `~/.claude` by hand (a sandboxed
session may not be allowed to, and the script also lists each plugin's skills).

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
| dir / branch | `../<repo>-team/<role>` and `agent/<role>` — all sub folders together in one team folder. A role that never edits files gets `"shared": true` instead (see below) |
| skills | chosen from what is installed, with a reason |
| plugins | which to switch on or off for this role |
| model | the model tier, with a reason (see below) |
| autonomy | `ask` · `build` · `run` — how far it goes before checking in (see below) |

**Folders only where needed.** A folder (worktree) exists so two sessions editing at once don't
overwrite each other — the way each developer on a team works in their own checkout. So only
roles that **change files** get one. A role that only reads — reviewing, verifying, researching,
watching logs — is `"shared": true`: no folder, no branch, it opens in the main folder and uses
main's skills and plugins (its `model` goes on the launch command). Say which roles are shared
and why, next to the folder list.

**Model tier.** Match the model to the judgment the role needs, not to its importance:
- main, and any role that verifies others' work → the strongest model (`opus`). Splitting work,
  judging results and deciding merges is where a weaker model costs the most.
- roles that implement a clear brief → a mid model (`sonnet`).
- roles that only watch, collect or run fixed commands → the lightest (`haiku`).
Leave `model` out to keep the human's default. Only use names the human has access to.

**Autonomy.** Default `build`. Use `ask` for roles touching money, data deletion, auth or
production config, or when the human wants to see plans first. Use `run` only for a role with a
command that proves it is done (tests, a measurement) — it keeps fixing until that passes.

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
Then run `status.mjs` and show that every role says `ok`.

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
- When a sub reports, run its check yourself before merging. Record verdicts in the ledger (`references/ledger.md`)
  when the claim matters.
- Merge subs' branches into main yourself; subs never merge. After merging, tell the sub the merge
  commit in one line so it knows its work landed.
- Never ask a sub-session to perform an action that was denied in its own window — that bypasses
  the human's permission decision. Bring it back to the human.
- If the human is following only the main window (for example from a phone), relay sub-session
  questions and approvals through main: subs send questions to main, main asks the human, main
  sends the answer back.

**Subs**
- Work at your autonomy level from `agents.json`, and say it in the first message to each sub:
  - `ask` — before changing code, send main a short plan and wait for "go".
  - `build` — change, test and commit on your branch, then report. Ask only when blocked.
  - `run` — keep going through fix → test loops until the brief's check passes; report once at
    the end, or when stuck after three tries.
- Report back with: what changed, how it was checked (commands and numbers), commit hashes.
- Don't merge into main. Don't edit files another role owns.
- Before starting new work, merge the latest `main` into your branch — main may have changed files
  you are about to touch.
- Questions and approvals go to main, not straight to the human.

Finally give the board:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/board.mjs"      →  http://127.0.0.1:8740
```

Start it as a background process so it does not block this session.

It shows the team tree, each session's latest moves, plan-vs-installed tools and the ledger.
It is read-only and shows whole transcripts — keep it on localhost.
