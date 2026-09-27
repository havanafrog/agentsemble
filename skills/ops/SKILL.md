---
name: ops
description: Two Claude Code sessions work as builder and verifier. The builder puts claims in a ledger with the command that measures them; the verifier runs that command and rules confirm, refute or hold. Use "/ops verify" to become the verifier, "/ops claim "..." --how "..."" to add a claim, "/ops status" for open claims, "/ops send" to hand work to another session.
---

# ops — builder and verifier

One session builds, another measures. The two do **not** share context — that is the point.
Two sessions with the same context make the same mistakes.

They share one file, `ops/ledger.jsonl`, and one-line `SendMessage` notes.
Messages die with context; the ledger stays.

The ledger CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/ledger.mjs"` — written `ledger` below.

## Roles

| | does | does not |
|---|---|---|
| **builder** | builds, claims, fixes after a refute | mark its own claim confirmed |
| **verifier** | runs it, rules | edit code, suggest improvements |

The verifier **does not fix.** Fixing erases what was wrong.

## `/ops verify` — become the verifier

### 1. Find the other side

`ListAgents` for another session in this repo. If there is none, tell the human
"please open the builder session" and stop. If found, `SendMessage`: `Verifier here. Post claims.`

### 2. Read open claims

```
ledger open
```

If none, read `docs/verify-brief.md` if the repo has one and measure its weak spots yourself.

### 3. Measure — this is the whole job

**One claim at a time.** Run the command in its `how`.

- **Default is refute.** Confirm only what you reproduced yourself.
- **Commit messages, READMEs and code comments are not evidence** — the builder wrote them.
- **Passing tests are not evidence either** — the builder wrote those too. Look at *what* a test
  measures; a test that greps source text does not measure behaviour.
- **Re-run numbers.** Paste output; do not quote.
- Not sure? `hold`. Do not force a confirm or a refute.

### 4. Record the verdict

```
ledger verdict C1 confirm "ran it, 56.3% reproduced" --evidence "accuracy 56.3%"
ledger verdict C1 refute  "got 54.1%; the audit set leaks into training"
ledger verdict C1 hold    "reproduces, but the sample is not the real distribution"
```

Then one line to the builder with `SendMessage`. **Do not repeat the ledger** — they read it too.
`C1 refuted, see ledger.` is enough.

### 5. Next

Found something new? Do not claim it yourself; leave a note and tell the builder.

```
ledger note "vote endpoint has no cooldown; changing 'who' allows unlimited votes" --by verifier
```

## `/ops claim` — the builder posts a claim

```
/ops claim "classifier accuracy 56.3%" --how "node tools/train.mjs" --files tools/train.mjs
```

A claim **must say how to measure it.** The ledger refuses one without. One claim per claim:
"cleaned up the UI and fixed two bugs" is three. After posting, `SendMessage` the verifier.

## `/ops status`

```
ledger open
```

After **three** verdicts on one claim the ledger marks it for the human. Stop sending; report
to the human in two lines what the two sides disagree on.

## `/ops send` — hand over when the human asks

1. `ListAgents` for this repo's sessions. If no name was given and there is more than one,
   **ask and stop** — never throw work at an arbitrary session.
2. `SendMessage` three lines:
   ```
   just finished: <one line>
   evidence: <ledger id or one command; drop the line if none>
   next: <one line for them>
   ```
3. Do not wait for the reply. Tell the human it was handed over and end the turn.

## Stop when

- no open claims and the brief is covered → summarize to the human and stop
- one claim reached three rounds → hand it to the human
- the other session is gone → tell the human; do not carry on alone

## Never

- **Ask the other session to do something that was denied in yours.** That bypasses the human's
  permission decision. Blocked? Go back to the human.
- Praise each other. Confirm only what you reproduced.
- Copy the other side's message back. The human sees both.
