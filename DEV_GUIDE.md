# Mailtimer — developer guide

This guide is for anyone who wants to understand, audit, or modify the code. It covers the architecture, each module's responsibilities, and then reproduces each source file with inline explanations.

If you received this as a `.xpi` file and want to verify there's nothing suspicious in it: a `.xpi` is a standard ZIP archive. Rename it to `.zip` and open it with any archive tool. Everything inside is plain JavaScript, HTML, and CSS — no binaries, no obfuscated code, no network calls except the one that sends your email through Thunderbird's own compose API.

---

## Architecture overview

Mailtimer is a Thunderbird WebExtension (Manifest V3). It has four layers:

```
manifest.json           — declares permissions and entry points
background/
  background.js         — opens the popup window when toolbar button is clicked
core/
  timer.js              — pure countdown logic, no UI or email awareness
  gameState.js          — session data: settings, live log, email payload
  emailData.js          — assembles the final email object and game log text
  ui.js                 — display logic: formatting, button states, Babel mode
popup/
  popup.html            — the UI structure (three screens: setup, running, outcome)
  popup.css             — styling
  popup.js              — wires everything together; drives the timer; calls the API
```

The `core/` files are intentionally isolated from Thunderbird. They use no browser APIs and could run in a plain Node.js environment (the test suite does exactly this). The `popup/` and `background/` files are where Thunderbird-specific code lives.

---

## Permissions

The manifest requests two permissions:

- `compose` — allows reading the compose window's fields (to, subject, body)
- `compose.send` — allows triggering a send programmatically

No network requests are made by the extension itself. No data is sent to any server. The only outbound action is calling Thunderbird's own `browser.compose.sendMessage()`, which sends through whichever email account the user has configured in Thunderbird.

---

## How the send works

1. User fills in the compose window normally (to, subject, body, attachments).
2. User opens Mailtimer via the toolbar button. A persistent window opens.
3. User configures modes and ticks consent. Start becomes available once a valid `@` address is detected in the To field (polled every 2 seconds).
4. On Start, `getComposeDetails()` reads the compose fields via `browser.compose.getComposeDetails()`.
5. A `GameState` is created with all settings locked in. A `MailTimer` starts counting.
6. When the timer reaches zero (and all relevant mode checks pass), `doSend()` calls `browser.compose.setComposeDetails()` to inject the updated body (which includes the game log if `metadataMode` is not `none`), then calls `browser.compose.sendMessage()`.
7. Thunderbird handles the actual SMTP delivery. The extension has no visibility into whether the email was received.

The subject is prefixed with `Mailtimer Game: ` at send time to prevent Thunderbird's empty-subject prompt from firing. `setComposeDetails` receives both `body` (HTML) and `plainTextBody` (pipe-separated plain text) simultaneously — Thunderbird picks the appropriate version based on the compose window's mode.

---

## The modes — how they actually work

**Roulette (Start):** `Math.random() < 0.1` is evaluated once, immediately after `gameState.begin()` is called. If it returns true, `doSend()` is called directly and `startRunningScreen()` is never reached.

**Roulette (during run):** A "Send now" button and a "Roulette" button are both present on the running screen. Roulette runs the same 10% check; "Send now" fires immediately with no randomness. Both stop the timer interval via `clearInterval(timer._intervalId)` — technically reaching into a private property, which is a known rough edge.

**Commitment Issues:** `doSend()` is called immediately after `gameState.begin()`, before `startRunningScreen()`. The `trigger === 'commitment'` guard in `doSend()` prevents it from calling `showOutcome()` — so the function returns early, and the fake countdown starts. On completion, `showOutcome('sent-fake')` is called instead of triggering another send.

**Unstable UI:** A `setTimeout` fires at a random point between 0ms and `rawSeconds * 1000` ms after Start. When it fires, it sets `brokenUIActive = true` and `gameState._brokenUIActive = true`. The `onTick` handler reads `brokenUIActive` and passes it to `buttonStates()`, which sets `enabled: false` on Cancel and Pause. The handlers for those buttons also check `gameState._brokenUIActive` directly and return early if true.

**Babel:** `buildRosettaTable()` is called once at the start of `startRunningScreen()`. This generates a shuffled bijection of the 62-character alphanumeric pool (`A–Z`, `a–z`, `0–9`). Letters and digits map to other letters or digits — a digit may become a letter. Symbols pass through. The resulting `Map` is stored in a local variable and used for all subsequent display calls via `applySubstitution()`. Labels are applied once immediately; the timer display is re-applied each tick but the same table means the same digit always maps to the same character, so the display is stable rather than flickering. All button colour classes are stripped so no button is identifiable by colour.

**TARDIS:** The timer starts at normal speed (1×). After a random 5–20 second phase, the first burst fires at 1.5×. After another random 5–20 second phase the timer returns to 1×, then bursts to 2×, then back to 1×, then 2.5×, and so on. Burst speed increases by 0.5× with each cycle — there is no upper limit. The phase duration is randomised independently for each normal and burst segment.

**Spin the Wheel:** `spinTheWheel()` is called in `onComplete`, before `doSend()`. It returns `Math.random() < 0.5`. If false, `showOutcome('spin-blocked')` is called instead of sending.

**Last Minute:** `buttonStates()` computes `inLastMinute = secondsLeft <= 60`. Both Cancel and Pause are always visible but their `enabled` state is gated on `inLastMinute` when `lastMinute` is true — both buttons are greyed out and non-functional until the final 60 seconds.

**Blindfold:** A boolean on `gameState.blindfolded`. `timerDisplay()` returns `'???'` when it is true and `peeking` is false. `peeking` is set true for 250ms by the Take a Peek button, then reset by a `setTimeout`. If a peek limit is set, `gameState.peeksRemaining` decrements on each peek and the button is disabled at zero.

**Metadata mode:** A radio button group (`none` / `log` / `extra`) controls what gets appended to the email. `none` sends the email body unchanged. `log` appends a formatted game log table (HTML) or pipe-separated summary (plain text). `extra` adds sender system information on top of the game log. When `log` or `extra` is selected, the consent declaration text is captured at Start time and included in the game log.

---

## Test suite

`core/test.mjs` contains 38 unit tests covering all core modules. Run with:

```
node --experimental-vm-modules core/test.mjs
```

Tests cover: `formatTime`, `timerDisplay`, `buttonStates` (including Last Minute and Unstable UI states, peek limit), `GameState` construction and logging, `validateEmail`, `buildEmail`, `spinTheWheel` (statistical), `MailTimer` countdown, pause, and TARDIS burst behaviour.

---

## Annotated source

What follows is each source file reproduced in full, with explanatory comments added inline. Comments beginning with `// DEV:` are additions for this guide; all other comments are from the original source.

---

### manifest.json

```json
{
  "manifest_version": 3,          // MV3 — required for Thunderbird 115+

  "name": "Mailtimer",
  "short_name": "Mailtimer",
  "description": "A countdown timer that sends your email when it reaches zero.",
  "version": "1.2.0",
  "author": "You",

  "browser_specific_settings": {
    "gecko": {
      "id": "mailtimer@local",    // DEV: unique extension ID. Change to e.g.
                                  // mailtimer@yourdomain.com if publishing.
      "strict_min_version": "115.0"
    }
  },

  "icons": {                      // DEV: placeholder blue squares. Replace with
    "16":  "icons/icon-16.png",   // real artwork before sharing widely.
    "32":  "icons/icon-32.png",
    "64":  "icons/icon-64.png",
    "128": "icons/icon-128.png"
  },

  "background": {
    "scripts": ["background/background.js"],
    "type": "module"              // DEV: allows ES module imports in background
  },

  "compose_action": {             // DEV: adds a button to the compose toolbar.
    "default_title": "Mailtimer", // No default_popup — clicks go to the
    "default_icon": "icons/icon-32.png"  // background script's onClicked handler,
  },                              // which opens a persistent window instead.

  "permissions": [
    "compose",                    // DEV: read compose fields (to, subject, body)
    "compose.send"                // DEV: call browser.compose.sendMessage()
  ]
}
```

---

### background/background.js

```javascript
// DEV: The background script's only job is to open the popup as a real window
// rather than a dismissible popup. A standard compose_action popup closes when
// the user clicks anywhere else — which would interrupt a running countdown.
// By intercepting the click here and using browser.windows.create(), we get
// a window that stays open until explicitly closed.

const openWindows = new Map();
// DEV: Tracks composeTabId → mailtimer windowId. Prevents opening two Mailtimer
// windows for the same compose tab if the user clicks the button again.

browser.composeAction.onClicked.addListener(async (composeTab) => {
  const composeTabId = composeTab.id;

  if (openWindows.has(composeTabId)) {
    const existingWindowId = openWindows.get(composeTabId);
    try {
      await browser.windows.update(existingWindowId, { focused: true });
      return;
    } catch {
      openWindows.delete(composeTabId);
    }
  }

  const popupUrl = browser.runtime.getURL('popup/popup.html')
    + `?composeTabId=${composeTabId}`;
  // DEV: The compose tab ID is passed as a URL parameter. popup.js reads it on load
  // via new URLSearchParams(window.location.search).

  const win = await browser.windows.create({
    url:    popupUrl,
    type:   'popup',
    width:  700,
    height: 680,
  });

  openWindows.set(composeTabId, win.id);

  browser.windows.onRemoved.addListener(function onRemoved(windowId) {
    if (windowId === win.id) {
      openWindows.delete(composeTabId);
      browser.windows.onRemoved.removeListener(onRemoved);
    }
  });
});
```

---

### core/timer.js

```javascript
// DEV: This file is intentionally isolated. It knows nothing about Thunderbird,
// the DOM, or email. It just counts down. This makes it testable in plain Node.js.
//
// The timer ticks every 100ms (not 1000ms) for two reasons:
// 1. TARDIS mode needs burst transitions to fire on schedule.
// 2. The display shows whole seconds via Math.ceil(), so sub-second ticks ensure
//    the display flips at the right moment.

export class MailTimer {
  constructor(options) {
    this.totalSeconds = options.seconds;
    this.mode         = options.mode || 'fixed';
    this.onTick       = options.onTick     || (() => {});
    this.onComplete   = options.onComplete || (() => {});
    this.onCancel     = options.onCancel   || (() => {});

    this._secondsLeft = options.seconds;
    this._speed       = 1.0;
    this._paused      = false;
    this._cancelled   = false;
    this._intervalId  = null;

    // DEV: TARDIS burst state. The timer alternates between normal (1×) and burst
    // phases. Burst speed starts at 1.5× and increases by 0.5× each cycle.
    // Each phase lasts a random 5–20 seconds (_tardisRandomPhaseMs).
    this._tardisBurstCount  = 0;      // how many bursts have fired so far
    this._tardisInBurst     = false;  // currently in a burst phase?
    this._tardisPhaseMs     = 0;      // ms elapsed in current phase
    this._tardisNextPhaseMs = this._tardisRandomPhaseMs();
  }

  start() {
    if (this._intervalId) return;

    if (this.mode === 'tardis') {
      this._tardisInBurst     = false;
      this._tardisBurstCount  = 0;
      this._tardisPhaseMs     = 0;
      this._tardisNextPhaseMs = this._tardisRandomPhaseMs();
      this._speed             = 1.0;
    }

    const TICK_MS = 100;

    this._intervalId = setInterval(() => {
      if (this._paused || this._cancelled) return;

      if (this.mode === 'tardis') {
        this._tardisPhaseMs += TICK_MS;

        if (this._tardisPhaseMs >= this._tardisNextPhaseMs) {
          this._tardisPhaseMs = 0;
          this._tardisNextPhaseMs = this._tardisRandomPhaseMs();

          if (!this._tardisInBurst) {
            // DEV: Entering burst — speed = 1.5 + 0.5 per previous burst count.
            this._tardisBurstCount++;
            this._tardisInBurst = true;
            this._speed = 1.0 + (this._tardisBurstCount * 0.5);
          } else {
            this._tardisInBurst = false;
            this._speed = 1.0;
          }
        }
      }

      const decrement = this._speed * (TICK_MS / 1000);
      this._secondsLeft -= decrement;

      if (this._secondsLeft <= 0) {
        this._secondsLeft = 0;
        clearInterval(this._intervalId);
        this._intervalId = null;
        this.onTick({ secondsLeft: 0, speed: this._speed });
        this.onComplete();
        return;
      }

      this.onTick({ secondsLeft: this._secondsLeft, speed: this._speed });
    }, TICK_MS);
  }

  pause()  { if (!this._paused && !this._cancelled)  this._paused = true;  }
  resume() { if (this._paused  && !this._cancelled)  this._paused = false; }

  cancel() {
    this._cancelled = true;
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    this.onCancel();
  }

  get secondsLeft() { return this._secondsLeft; }
  get speed()       { return this._speed; }
  get isPaused()    { return this._paused; }

  _tardisRandomPhaseMs() {
    return 5000 + Math.random() * 15000; // 5–20 seconds
  }
}
```

---

### core/gameState.js

```javascript
// DEV: GameState is the single source of truth for one timer session.
// Created when the user clicks Start and lives until the window closes.
// Carries: email payload, all mode flags, and a growing log.
// No side effects — never touches the DOM, never calls a timer, never sends.

export class GameState {
  constructor(options) {
    this.to      = options.to;
    this.subject = options.subject;
    this.body    = options.body;
    // DEV: body is captured once at Start from the compose window and stored here.
    // Edits to the compose window after Start do not affect what gets sent.

    this.timerMode  = options.timerMode || 'fixed';
    this.rawSeconds = this._resolveSeconds(options);
    // DEV: rawSeconds is locked in at construction. For random mode the draw
    // happens here — the number is fixed before the timer starts.

    this.sendMode = options.sendMode || 'standard';
    // DEV: 'commitmentIssues' triggers doSend() before the timer starts.

    // DEV: Mode flags — all booleans, all locked at Start.
    this.blindfolded   = options.blindfolded   || false;
    this.tardis        = options.tardis        || false;
    this.spinTheWheel  = options.spinTheWheel  || false;
    this.lastMinute    = options.lastMinute    || false;
    this.roulette      = options.roulette      || false;
    this.brokenUI      = options.brokenUI      || false;
    this.rosettaStone  = options.rosettaStone  || false;
    // DEV: metadataMode controls what gets appended to the email body.
    // 'none' = nothing added. 'log' = game log. 'extra' = log + system info.
    this.metadataMode  = options.metadataMode  || 'log';
    // DEV: peekLimit is null (unlimited) or a number (max peeks allowed).
    this.peekLimit     = options.peekLimit     ?? null;
    this.peeksRemaining = this.peekLimit !== null ? this.peekLimit : Infinity;

    this.log = {
      timerMode:         this.timerMode,
      sendMode:          this.sendMode,
      secondsConfigured: this.rawSeconds,
      blindfoldedStart:  this.blindfolded,
      blindfoldedMidRun: false,
      peekLimit:         this.peekLimit,
      peekCount:         0,
      pauseCount:        0,
      tardisUsed:        this.tardis,
      brokenUIUsed:      this.brokenUI,
      rosettaStoneUsed:  this.rosettaStone,
      spinOutcome:       null,
      rouletteTriggered: false,
      braveMetadata:     null,
      consentText:       null,  // DEV: set at Start when metadataMode is log or extra
      outcome:           null,
      startedAt:         null,
      completedAt:       null,
    };
  }

  begin()               { this.log.startedAt  = new Date().toISOString(); }
  recordPeek()          { this.log.peekCount++; if (this.peekLimit !== null) this.peeksRemaining = Math.max(0, this.peeksRemaining - 1); }
  recordPause()         { this.log.pauseCount++; }
  recordSpinOutcome(s)  { this.log.spinOutcome = s ? 'sent' : 'blocked'; }
  get canPeek()         { return this.peeksRemaining > 0; }

  recordSend()   { this.log.outcome = 'sent';      this.log.completedAt = new Date().toISOString(); }
  recordCancel() { this.log.outcome = 'cancelled'; this.log.completedAt = new Date().toISOString(); }
}
```

---

### core/emailData.js

```javascript
// DEV: Assembles the final email object passed to the Thunderbird compose API.
// buildEmail() returns both body (HTML) and plainTextBody (pipe-separated).
// setComposeDetails receives both; Thunderbird picks the right one.

export function buildEmail(gameState, braveMetadata = null) {
  const mode = gameState.metadataMode || 'log';

  const gameLogText  = mode !== 'none' ? gameState.formatLog()           : '';
  const braveLogText = mode === 'extra' && braveMetadata
    ? formatBraveMetadata(braveMetadata) : '';

  // DEV: Plain text version — pipe-separated. Works regardless of email mode.
  const plainBody = gameState.body + gameLogText + braveLogText;

  // DEV: HTML version — uses a styled table for the game log.
  // The original body is HTML-escaped so special characters don't break markup.
  const originalHtml = gameState.body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\n/g, '<br>');

  const logHtml = mode !== 'none'
    ? formatLogHtml(gameState, mode === 'extra' ? braveMetadata : null) : '';

  return {
    to:            gameState.to,
    subject:       gameState.subject,
    body:          originalHtml + logHtml,    // HTML version
    plainTextBody: plainBody,                  // plain text fallback
  };
}
```

---

### core/ui.js

```javascript
// DEV: Display logic that works identically in Thunderbird and a plain browser.
// Never touches the DOM directly — returns data that the platform layer renders.

export function formatTime(secondsLeft) {
  // DEV: Returns a plain integer string — "347", "12", "1".
  // Deliberately no minutes:seconds format. The disorientation is intentional.
  return String(Math.max(0, Math.ceil(secondsLeft)));
}

export function timerDisplay(secondsLeft, { blindfolded, peeking, rosettaTable } = {}) {
  // DEV: Three states:
  // 1. Blindfolded and not peeking → '???'
  // 2. Babel active (rosettaTable set) → substituted string (stable per session)
  // 3. Normal → plain integer
  if (blindfolded && !peeking) return '???';
  const display = formatTime(secondsLeft);
  if (rosettaTable) return applySubstitution(display, rosettaTable);
  return display;
}

export function buttonStates(sessionState) {
  // DEV: Returns intended state of each button as {visible, enabled, label}.
  // Both Cancel and Pause are always visible. In Last Minute mode, both are
  // disabled until secondsLeft <= 60. In Unstable UI mode, both are always disabled.
  // peeksRemaining controls whether the Peek button is enabled.
  const { running, paused, secondsLeft, brokenUI, rosettaTable,
          lastMinute, blindfolded, peeksRemaining = Infinity } = sessionState;

  const inLastMinute = secondsLeft <= 60;
  const cancelEnabled = (!lastMinute || inLastMinute) && !brokenUI;
  const pauseEnabled  = (!lastMinute || inLastMinute) && !brokenUI;

  const peekVisible = running && blindfolded;
  const peekEnabled = peekVisible && peeksRemaining > 0;
  const peekLabel   = (peeksRemaining !== Infinity && peeksRemaining >= 0)
    ? `Take a peek (${peeksRemaining} left)` : 'Take a peek';

  const buttons = {
    start:    { visible: !running, enabled: true,          label: 'Start' },
    pause:    { visible: running,  enabled: pauseEnabled,  label: paused ? 'Resume' : 'Pause' },
    cancel:   { visible: running,  enabled: cancelEnabled, label: 'Cancel' },
    blindfold:{ visible: true,     enabled: !running,      label: blindfolded ? 'Remove blindfold' : 'Blindfold' },
    peek:     { visible: peekVisible, enabled: peekEnabled, label: peekLabel },
  };

  if (rosettaTable && running) {
    // DEV: Babel — apply the pre-built substitution table to all visible labels.
    // Same table every tick = same output = no flickering.
    for (const key of Object.keys(buttons)) {
      if (buttons[key].visible)
        buttons[key].label = applySubstitution(buttons[key].label, rosettaTable);
    }
  }

  return buttons;
}

export function buildRosettaTable() {
  // DEV: Generates a one-time character substitution table for Babel mode.
  // The 62-character alphanumeric pool is Fisher-Yates shuffled into a bijection.
  // Letters can become digits and vice versa. Symbols pass through unchanged.
  const pool    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const poolArr = pool.split('');
  const shuffled = [...poolArr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const table = new Map();
  for (let i = 0; i < poolArr.length; i++) table.set(poolArr[i], shuffled[i]);
  return table;
}

export function applySubstitution(str, table) {
  return str.split('').map(c => table.get(c) ?? c).join('');
}

export function spinTheWheel() {
  // DEV: 50/50. Called in onComplete when Spin the Wheel is active.
  return Math.random() < 0.5;
}
```

---

### popup/popup.html

The HTML defines three screens shown/hidden by toggling the `active` class:

- **screen-setup** — the configuration panel. Left column: Timer length, Modifiers, Chaos, Prove you're playing? Right column: timer preview display, Blindfold toggle (with optional peek limit), Consent checkbox, Start button.
- **screen-running** — the live countdown. Left column: active mode flags. Right column: timer display and action buttons (Pause, Cancel, Send now, Peek, live Blindfold, Roulette).
- **screen-outcome** — shown after send or cancel. Icon, title, detail text, and a Close button.

Nothing interactive happens in the HTML itself — all logic is in `popup.js`.

---

### popup/popup.css

Standard CSS. Notable decisions:

- `body` has `min-width: 480px` but no fixed width — the window is resizable.
- `.option-row > span` is `display: inline` — option name and description sit on the same line, separated by ` — ` in the text.
- `.option-name` is `font-weight: 700` (bold, dark) and `.option-desc` stays grey — visual hierarchy without extra elements.
- `.group-title` is bold and dark (`#1a1a1a`) — section headings are prominent.
- `.outcome-detail` has `white-space: pre-line` — allows `\n` in JS strings to render as line breaks.
- `.btn:disabled` has `opacity: 0.4` — disabled buttons are visible but clearly inactive. Both Cancel and Pause render this way in Unstable UI and Last Minute modes.

---

### popup/popup.js

Key sections:

**Initialisation:** Reads `?composeTabId` from the URL, starts polling the To field every 2 seconds via `getComposeDetails()`, and sets up event listeners.

**Start handler:** Reads all toggle states including `getMetadataMode()` (the radio button group), creates a `GameState`, captures the consent text if metadata mode is not `none`, calls `gameState.begin()`, and either fires immediately (Roulette / Commitment Issues) or calls `startRunningScreen()`.

**startRunningScreen():** Builds the Babel substitution table if needed, applies initial label scrambling (stripping colour classes so no button is identifiable by colour), arms the Unstable UI timeout, creates a `MailTimer`, starts it. The `onTick` callback runs every 100ms — updates the display, recomputes button states, shows/hides the peek exhausted message.

**doSend():** Collects brave metadata if `metadataMode === 'extra'`, calls `gameState.recordSend()`, calls `buildEmail()` which returns both HTML and plain text body versions, prefixes the subject, calls `browser.compose.setComposeDetails()` with both body versions, calls `browser.compose.sendMessage()`, refocuses the Mailtimer window, then calls `showOutcome()`.

**showOutcome():** Switches to the outcome screen and populates it. The outcome screen is never scrambled — plain text regardless of active modes. Outcome text is deliberately uncertain ("Did you lose the game? Has your information been sent?") because the player may have dismissed the Thunderbird send dialogue.

---

## Modification notes

**Adding a new mode:** Add a toggle to `popup.html`, a flag to the `GameState` constructor, wire the toggle in `popup.js`'s Start handler, and add the effect wherever it belongs (`onTick`, `onComplete`, `buttonStates`, etc.). Add it to `populateRunFlags()` so it appears in the running screen's mode list.

**Changing the timer behaviour:** Only `timer.js` needs touching. The `onTick` and `onComplete` callbacks give `popup.js` everything it needs to respond.

**Adding a web version:** Replace `popup.js`'s `getComposeDetails()` and `doSend()` with implementations that call your server API. Everything in `core/` works as-is.

**Changing the log format:** `gameState.js → formatLog()` controls the pipe-separated plain text version. `emailData.js → formatLogHtml()` controls the HTML table version. Both need updating together if you change field names.
