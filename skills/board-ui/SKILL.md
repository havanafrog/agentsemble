---
name: board-ui
description: Use when building a local dashboard ("board") — a small Node process serving JSON and a single HTML page that re-fetches it every few seconds. Session boards, build status boards, log summaries. Triggers on "make a board", "dashboard", "status page", "a page I open on localhost". No build tools, no framework.
---

# Building a board

One small Node process serves JSON at `/api/board`; one HTML page fetches it every few seconds
and redraws. No `package.json`, no build. Two files:

```
board.mjs     reads the records, builds the JSON, and serves it
board.html    draws that JSON; <style> and <script> live inside it
```

**Do not expose it.** Boards usually read things nobody else should see.
Pin `srv.listen(PORT, '127.0.0.1')`, and map container ports as `127.0.0.1:8740:8740`.
Reject requests whose `Host` header is not local — a localhost-only server is still reachable
through DNS rebinding.

## Order of work

1. **Fix the data first.** Drawing first makes you use values that do not exist. Settle the
   object `board()` returns, and lock its shape with a `--selftest`.
2. **Write one HTML page.** Colors as `:root` tokens, refresh with `setInterval(tick, 2000)`.
3. **Run it and look.** Take a screenshot. A card blowing up vertically or a name escaping its
   box cannot be seen by reading code.

## Traps you will step on

Every one of these cost real time.

### 1. Serve the page from a function, not a constant

```js
const PAGE = readFileSync(join(HERE, 'board.html'), 'utf8');         // no
const PAGE = () => readFileSync(join(HERE, 'board.html'), 'utf8');   // yes
```

Read once at load, the server keeps sending the old bytes after you edit the file.
Most "I fixed it but the page didn't change" is this. In a container with a bind mount it is
worse: `compose up -d --build` does not recreate the container when only a mounted file
changed — `restart` it.

Measure, don't guess:

```
curl -s localhost:8740/ | wc -c    # what the server sends
wc -c board.html                    # what is on disk
```

### 2. The refresh erases what a human needs to read

Redraw every 2 s and an error message is gone in 2 s. Hold it:

```js
let held = 0;
function say(t) { $('tally').textContent = t; held = Date.now() + 6000; }
// in the draw code
if (Date.now() >= held) { $('tally').innerHTML = normalValue; }
```

### 3. Ellipsis does nothing inside flex

`text-overflow: ellipsis` is ignored on a flex child without `min-width: 0`.

```css
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
```

### 4. One long string blows up a card

A several-hundred-character command stretches one card and wrecks the grid. Cut **on both
sides**: truncate to 120 chars on the server (don't send it), and clip to width on screen.
Give the grid `align-items: start` so one tall cell does not stretch its row.

```css
.cards { display: grid; align-items: start;
         grid-template-columns: repeat(auto-fill, minmax(min(440px, 100%), 1fr)); }
.line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

`min(440px, 100%)` inside `minmax()` is what prevents horizontal scroll on phones.

### 5. Values inside attributes need quotes escaped too

```js
const esc = s => String(s ?? '').replace(/[<>&"]/g,
  c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
```

The common `<>&`-only `esc` breaks `data-name="${esc(x.name)}"` when a name contains `"`.

### 6. Keep the selected tab

Redrawing every 2 s without remembering the tab jumps back to the first one.
`localStorage` **throws** in private windows — wrap reads and writes in `try/catch`.

```js
try { localStorage.setItem('ui.tab', id); } catch { /* works without it */ }
```

### 7. Read big logs incrementally

A log of tens of MB cannot be read whole every 2 s. For append-only files, remember the byte
offset and read only what follows.

**Count only up to the last newline.** Parsing a half-written line breaks; cutting at a newline
also keeps every chunk valid UTF-8, so multibyte text survives.

```js
const cut = buf.lastIndexOf(0x0a);
if (cut >= 0) { add(sum, buf.subarray(0, cut).toString('utf8').split('\n')); at += cut + 1; }
```

If the file got shorter it was replaced — start over from zero.
**Self-test it:** the incremental result must equal a full read.

### 8. Reading only the tail pushes human messages out

Reading the last 512 KB is fine until one tool result (a base64 screenshot, say) fills all of it
and the human's own words fall off the window. Take those from a place that records them
separately, not from the tail scan.

### 9. Never invent a pairing

If a ledger line has no session id, do not attach it to a session card. A plausible guess makes
the screen lie. With nothing to pair on, show it on its own — another tab is better.

### 10. Write all three color states

Put light values on `:root`, override for dark in the media query, and always paint `body`,
or the background shows through and text disappears.

```css
:root { --page:#f4f5f8; --text:#191f28; --hair:#e5e8eb; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --page:#17171c; --text:#e9ecef; --hair:#2b2d36; }
}
body { background: var(--page); color: var(--text); }
```

Numbers get `font-variant-numeric: tabular-nums`, or digits jiggle on every refresh.

## Final check

- [ ] Bound to `127.0.0.1` only, and non-local `Host` rejected
- [ ] Page served from a function, not a constant
- [ ] The screen survives the server being down (say so only after a few failures)
- [ ] No horizontal scroll at 400px wide
- [ ] Looked at both light and dark
- [ ] Looked at a card with a long name and a long command
- [ ] Data shape locked with `--selftest`
- [ ] **Took a screenshot and looked at it**

The last line matters most. You cannot see a broken card by reading code.
