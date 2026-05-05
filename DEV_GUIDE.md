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
  ui.js                 — display logic: formatting, button states, Rosetta Stone
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
6. When the timer reaches zero (and all relevant mode checks pass), `doSend()` calls `browser.compose.setComposeDetails()` to inject the updated body (which includes the game log), then calls `browser.compose.sendMessage()`.
7. Thunderbird handles the actual SMTP delivery. The extension has no visibility into whether the email was received.

The subject is prefixed with `Mailtimer Game: ` at send time to prevent Thunderbird's empty-subject prompt from firing.

---

## The chaos modes — how they actually work

**Roulette (Start):** `Math.random() < 0.1` is evaluated once, immediately after `gameState.begin()` is called. If it returns true, `doSend()` is called directly and `startRunningScreen()` is never reached.

**Roulette (during run):** Same check, but clears the timer interval directly before calling `doSend()`. Uses `clearInterval(timer._intervalId)` — technically reaching into a private property, which is a known rough edge.

**Commitment Issues:** `doSend()` is called immediately after `gameState.begin()`, before `startRunningScreen()`. The `trigger === 'commitment'` guard in `doSend()` prevents it from calling `showOutcome()` — so the function returns early, and the fake countdown starts. On completion, `showOutcome('sent-fake')` is called instead of triggering another send.

**Bricked UI:** A `setTimeout` fires at a random point between 0ms and `rawSeconds * 1000` ms after Start. When it fires, it sets `brokenUIActive = true` and `gameState._brokenUIActive = true`. The `onTick` handler reads `brokenUIActive` and passes it to `buttonStates()`, which sets `enabled: false` on Cancel and Pause. The handlers for those buttons also check `gameState._brokenUIActive` directly and return early if true.

**Rosetta Stone:** `buildRosettaTable()` is called once at the start of `startRunningScreen()`. This generates a shuffled bijection of the 62-character alphanumeric pool (`A–Z`, `a–z`, `0–9`). Letters and digits map to other letters or digits — a digit may become a letter. Symbols pass through. The resulting `Map` is stored in a local variable and used for all subsequent display calls via `applySubstitution()`. Labels are applied once immediately; the timer display is re-applied each tick but the same table means the same digit always maps to the same character, so the display is stable rather than flickering.

**TARDIS:** Every 100ms tick, the timer's `_speed` multiplier is linearly interpolated toward a target. Every 5 seconds, a new target is chosen at random between 0.5× and 2.0×. The candidate must differ from the current target by at least 0.2 to avoid picking essentially the same speed. The timer's `_secondsLeft` is decremented by `speed × 0.1` each tick rather than a flat 0.1, so the display and the real elapsed time drift together.

**Spin the Wheel:** `spinTheWheel()` is called in `onComplete`, before `doSend()`. It returns `Math.random() < 0.5`. If false, `showOutcome('spin-blocked')` is called instead of sending.

**Last Minute:** `buttonStates()` computes `inLastMinute = secondsLeft <= 60`. Both Cancel's `visible` and Pause's `enabled` are gated on this when `lastMinute` is true.

**Blindfold:** A boolean on `gameState.blindfolded`. `timerDisplay()` returns `'???'` when it's true and `peeking` is false. `peeking` is set true for 1000ms by the Take a Peek button, then reset by a `setTimeout`.

---

## Test suite

`core/test.mjs` contains 38 unit tests covering all core modules. Run with:

```
node --experimental-vm-modules core/test.mjs
```

Tests cover: `formatTime`, `timerDisplay`, `buttonStates` (including lastMinute and bricked UI states), `GameState` construction and logging, `validateEmail`, `buildEmail`, `spinTheWheel` (statistical), `MailTimer` countdown, pause, and TARDIS speed bounds.

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
  "version": "0.1.0",
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
  // DEV: composeTab is the compose window tab Thunderbird passes to the listener.
  // Its .id is used as a stable key to identify which email this Mailtimer belongs to.

  if (openWindows.has(composeTabId)) {
    const existingWindowId = openWindows.get(composeTabId);
    try {
      await browser.windows.update(existingWindowId, { focused: true });
      // DEV: Just bring the existing window to the front rather than opening another.
      return;
    } catch {
      openWindows.delete(composeTabId);
      // DEV: The window was closed externally (user closed it). Clean up and open fresh.
    }
  }

  const popupUrl = browser.runtime.getURL('popup/popup.html')
    + `?composeTabId=${composeTabId}`;
  // DEV: The compose tab ID is passed as a URL parameter. popup.js reads it on load
  // via new URLSearchParams(window.location.search). This is how the popup knows
  // which compose window to read and send through — no guessing, no tab queries.

  const win = await browser.windows.create({
    url:    popupUrl,
    type:   'popup',   // DEV: 'popup' = no browser toolbar, but stays open on blur
    width:  700,
    height: 680,
  });

  openWindows.set(composeTabId, win.id);

  browser.windows.onRemoved.addListener(function onRemoved(windowId) {
    if (windowId === win.id) {
      openWindows.delete(composeTabId);
      browser.windows.onRemoved.removeListener(onRemoved);
      // DEV: Clean up the Map entry when the window closes, so the next click
      // opens a fresh window rather than trying to focus a ghost.
    }
  });
});
```

---

### core/timer.js

```javascript
// DEV: This file is intentionally isolated. It knows nothing about Thunderbird,
// the DOM, or email. It just counts down. This makes it testable in plain Node.js
// and reusable if the project ever gains a web-based version.
//
// The timer ticks every 100ms (not 1000ms) for two reasons:
// 1. TARDIS mode needs smooth speed interpolation, which requires frequent updates.
// 2. The display shows whole seconds via Math.ceil(), so sub-second ticks ensure
//    the display flips at the right moment rather than being a second late.

export class MailTimer {
  constructor(options) {
    this.totalSeconds = options.seconds;
    this.mode         = options.mode || 'fixed';
    this.onTick       = options.onTick     || (() => {});
    this.onComplete   = options.onComplete || (() => {});
    this.onCancel     = options.onCancel   || (() => {});

    this._secondsLeft = options.seconds; // DEV: fractional — decremented smoothly
    this._speed       = 1.0;             // DEV: 1.0 = real time; <1 = slower; >1 = faster
    this._paused      = false;
    this._cancelled   = false;
    this._intervalId  = null;

    // DEV: TARDIS interpolation state. The timer smoothly moves from one speed
    // to another over a 5-second ramp. These fields track where we are in that ramp.
    this._tardisTargetSpeed  = 1.0;   // where we're heading
    this._tardisCurrentSpeed = 1.0;   // where we are right now
    this._tardisStepAge      = 0;     // ms elapsed in current ramp
    this._tardisStepDuration = 5000;  // ms per ramp (constant)
    this._tardisPrevSpeed    = 1.0;   // speed at the start of this ramp
  }

  start() {
    if (this._intervalId) return; // DEV: idempotent — calling start() twice is safe

    if (this.mode === 'tardis') {
      // DEV: Initialise TARDIS state. Pick the first target immediately so the
      // timer starts drifting from tick 1 rather than sitting at 1.0× for 5 seconds.
      this._tardisCurrentSpeed = 1.0;
      this._tardisTargetSpeed  = this._newTardisSpeed();
      this._tardisPrevSpeed    = 1.0;
      this._tardisStepAge      = 0;
    }

    const TICK_MS = 100;

    this._intervalId = setInterval(() => {
      if (this._paused || this._cancelled) return;
      // DEV: Pausing works by letting the interval keep firing but doing nothing.
      // This is simpler than clearing and re-creating the interval, and means
      // the TARDIS ramp age also pauses correctly.

      if (this.mode === 'tardis') {
        this._tardisStepAge += TICK_MS;

        if (this._tardisStepAge >= this._tardisStepDuration) {
          // DEV: Ramp complete. Lock in the target as the new baseline and
          // immediately pick the next target to ramp toward.
          this._tardisPrevSpeed    = this._tardisTargetSpeed;
          this._tardisCurrentSpeed = this._tardisTargetSpeed;
          this._tardisTargetSpeed  = this._newTardisSpeed();
          this._tardisStepAge      = 0;
        } else {
          // DEV: Linear interpolation between prev and target.
          // t = 0 at the start of the ramp, t = 1 at the end.
          const t = this._tardisStepAge / this._tardisStepDuration;
          this._tardisCurrentSpeed =
            this._tardisPrevSpeed +
            t * (this._tardisTargetSpeed - this._tardisPrevSpeed);
        }

        this._speed = this._tardisCurrentSpeed;
      }

      const decrement = this._speed * (TICK_MS / 1000);
      // DEV: At 1.0× speed: 1.0 × 0.1 = 0.1 seconds per tick = 1 second per 10 ticks.
      // At 2.0× speed: 2.0 × 0.1 = 0.2 seconds per tick = 2 real seconds per display second.
      // At 0.5× speed: 0.5 × 0.1 = 0.05 seconds per tick = half real time.
      this._secondsLeft -= decrement;

      if (this._secondsLeft <= 0) {
        this._secondsLeft = 0;
        clearInterval(this._intervalId);
        this._intervalId = null;
        this.onTick({ secondsLeft: 0, speed: this._speed });
        this.onComplete(this.log);
        return;
      }

      this.onTick({ secondsLeft: this._secondsLeft, speed: this._speed });
    }, TICK_MS);
  }

  pause()  { if (!this._paused && !this._cancelled)  this._paused = true;  }
  resume() { if (this._paused  && !this._cancelled)  this._paused = false; }

  cancel() {
    this._cancelled = true;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this.onCancel();
  }

  get secondsLeft() { return this._secondsLeft; }
  get speed()       { return this._speed; }
  get isPaused()    { return this._paused; }

  _newTardisSpeed() {
    // DEV: Picks a random speed in [0.5, 2.0] that differs from the current
    // target by at least 0.2, so the timer always perceptibly changes direction.
    const min = 0.5, max = 2.0;
    let candidate;
    do {
      candidate = min + Math.random() * (max - min);
      candidate = Math.round(candidate * 100) / 100; // round to 2dp
    } while (Math.abs(candidate - this._tardisTargetSpeed) < 0.2);
    return candidate;
  }
}
```

---

### core/gameState.js

```javascript
// DEV: GameState is the single source of truth for one timer session.
// It is created when the user clicks Start and lives until the window closes.
// It carries: the email payload, all mode flags, and a growing log.
//
// It has no side effects — it never touches the DOM, never calls a timer,
// never sends anything. It just holds data and formats it for output.

export class GameState {
  constructor(options) {
    // ── Email payload ─────────────────────────────────────────────────────
    this.to      = options.to;
    this.subject = options.subject;
    this.body    = options.body;
    // DEV: These are read once from the compose window at Start and stored here.
    // They are not re-read during the countdown — the compose window could be
    // edited while the timer runs, but that would not affect what gets sent.

    // ── Timer settings ────────────────────────────────────────────────────
    this.timerMode  = options.timerMode || 'fixed';
    this.rawSeconds = this._resolveSeconds(options);
    // DEV: rawSeconds is the actual number the timer counts from. For random mode,
    // it's resolved once at construction — the random draw happens here, not at Start.

    // ── Send mode ─────────────────────────────────────────────────────────
    this.sendMode = options.sendMode || 'standard';
    // DEV: 'commitmentIssues' causes doSend() to fire before the timer starts.

    // ── Modifier flags ────────────────────────────────────────────────────
    // DEV: These are all stored as plain booleans. popup.js reads them to
    // decide what to show and what to do. They don't change after Start.
    this.blindfolded   = options.blindfolded   || false;
    this.tardis        = options.tardis        || false;
    this.spinTheWheel  = options.spinTheWheel  || false;
    this.lastMinute    = options.lastMinute    || false;
    this.roulette      = options.roulette      || false;
    this.brokenUI      = options.brokenUI      || false;
    this.rosettaStone  = options.rosettaStone  || false;
    this.braveMetadata = options.braveMetadata || false;

    // ── Live log ──────────────────────────────────────────────────────────
    // DEV: This object grows during the session. Each player action (peek, pause,
    // spin outcome, etc.) is recorded here. At send time, formatLog() turns it
    // into a plain-text block that is appended to the email body.
    this.log = {
      timerMode:         this.timerMode,
      sendMode:          this.sendMode,
      secondsConfigured: this.rawSeconds,
      blindfoldedStart:  this.blindfolded,
      blindfoldedMidRun: false,           // set if the live Blindfold button was used
      peekCount:         0,
      pauseCount:        0,
      tardisUsed:        this.tardis,
      brokenUIUsed:      this.brokenUI,
      rosettaStoneUsed:  this.rosettaStone,
      spinOutcome:       null,            // 'sent' or 'blocked'
      rouletteTriggered: false,
      braveMetadata:     null,            // populated just before send
      outcome:           null,            // 'sent' or 'cancelled'
      startedAt:         null,
      completedAt:       null,
    };
  }

  begin()               { this.log.startedAt  = new Date().toISOString(); }
  recordPeek()          { this.log.peekCount++; }
  recordPause()         { this.log.pauseCount++; }
  recordSpinOutcome(sent) { this.log.spinOutcome = sent ? 'sent' : 'blocked'; }

  recordSend() {
    this.log.outcome     = 'sent';
    this.log.completedAt = new Date().toISOString();
  }

  recordCancel() {
    this.log.outcome     = 'cancelled';
    this.log.completedAt = new Date().toISOString();
  }

  formatLog() {
    // DEV: Produces the plain-text block appended to the email body.
    // Uses box-drawing characters for visual separation in plain-text email clients.
    // The recipient sees this; it is intentionally readable.
    const l = this.log;
    const lines = [
      '', '════════════════════════════════',
      'Mailtimer — game log',
      '════════════════════════════════', '',
      `Timer mode:        ${l.timerMode}${l.tardisUsed ? ' (TARDIS)' : ''}`,
      `Time configured:   ${l.secondsConfigured} seconds`,
      `Send mode:         ${l.sendMode}`,
      `Started:           ${l.startedAt || '—'}`,
      `Completed:         ${l.completedAt || '—'}`,
      `Outcome:           ${l.outcome || '—'}`, '',
    ];

    const actions = [];
    if (l.blindfoldedStart)  actions.push('Started blindfolded');
    if (l.blindfoldedMidRun) actions.push('Applied blindfold mid-run');
    if (l.peekCount > 0)     actions.push(`Peeked at timer: ${l.peekCount} time${l.peekCount > 1 ? 's' : ''}`);
    if (l.pauseCount > 0)    actions.push(`Paused timer: ${l.pauseCount} time${l.pauseCount > 1 ? 's' : ''}`);
    if (l.spinOutcome)       actions.push(`Spin the wheel result: ${l.spinOutcome}`);
    if (l.rouletteTriggered) actions.push('Roulette fired');
    if (actions.length) {
      lines.push('── Player actions ──');
      actions.forEach(a => lines.push(`  ${a}`));
      lines.push('');
    }

    const chaos = [];
    if (l.brokenUIUsed)     chaos.push('Bricked UI was active');
    if (l.rosettaStoneUsed) chaos.push('Rosetta Stone was active');
    if (chaos.length) {
      lines.push('── Chaos modes ──');
      chaos.forEach(c => lines.push(`  ${c}`));
      lines.push('');
    }

    lines.push('════════════════════════════════');
    return lines.join('\n');
  }

  _resolveSeconds(options) {
    if (options.timerMode === 'random') {
      const min = options.randomMin || 60;
      const max = options.randomMax || 600;
      // DEV: The random draw happens here, at GameState construction (i.e. at Start).
      // This ensures the number is locked in even if the user somehow inspects state.
      return Math.floor(min + Math.random() * (max - min));
    }
    return options.seconds || 600;
  }
}
```

---

### core/emailData.js

```javascript
// DEV: Assembles the final email object passed to the Thunderbird compose API.
// Keeps the send logic thin — popup.js calls buildEmail() and gets back a
// plain object with {to, subject, body}. It doesn't need to know how the
// log or brave metadata are formatted.

export function buildEmail(gameState, braveMetadata = null) {
  const gameLog  = gameState.formatLog();
  const braveLog = braveMetadata ? formatBraveMetadata(braveMetadata) : '';

  return {
    to:      gameState.to,
    subject: gameState.subject,  // DEV: subject prefix added in doSend(), not here
    body:    gameState.body + gameLog + braveLog,
  };
}

export function formatBraveMetadata(meta) {
  // DEV: Formats the optional system-info block. The sender explicitly opted in.
  // Nothing here is gathered without consent — gatherBraveMetadata() in popup.js
  // is only called if gameState.braveMetadata is true.
  return [
    '', '════════════════════════════════',
    'A little extra — sender system info',
    '(The sender consented to including this)',
    '════════════════════════════════', '',
    `Sent at (UTC):          ${meta['sent-at']      || '—'}`,
    `Local date and time:    ${meta['local-time']   || '—'}`,
    `Timezone (IANA):        ${meta['timezone']     || '—'}`,
    `Approximate region:     ${meta['region-guess'] || '—'}`, '',
    `Language / locale:      ${meta['locale']       || '—'}`,
    `Operating system:       ${meta['platform']     || '—'}`, '',
    `Time spent on timer:    ${meta['elapsed-seconds'] != null
      ? meta['elapsed-seconds'] + ' seconds' : '—'}`, '',
    '════════════════════════════════',
  ].join('\n');
}

export function validateEmail(gameState) {
  // DEV: Called by popup.js to gate the Start button. Checks for a valid-looking
  // To address. Does not perform full RFC 5322 validation — just a basic @ check.
  if (!gameState.to || !gameState.to.includes('@')) {
    return { valid: false, reason: 'Recipient email address is missing or invalid.' };
  }
  if (!gameState.subject || !gameState.subject.trim()) {
    return { valid: false, reason: 'Subject line is empty.' };
  }
  return { valid: true };
}
```

---

### core/ui.js

```javascript
// DEV: Display logic that works identically in Thunderbird and a plain browser.
// Never touches the DOM directly — returns data that the platform layer renders.
// This keeps it testable and makes the web version straightforward to add later.

export function formatTime(secondsLeft) {
  // DEV: Returns a plain integer string — "347", "12", "1".
  // Deliberately no minutes:seconds format. The disorientation is intentional.
  return String(Math.max(0, Math.ceil(secondsLeft)));
}

export function timerDisplay(secondsLeft, { blindfolded, peeking, rosettaTable } = {}) {
  // DEV: Central display logic. Three states:
  // 1. Blindfolded and not peeking → '???'
  // 2. Rosetta Stone active        → substituted string (stable per session)
  // 3. Normal                      → plain integer
  if (blindfolded && !peeking) return '???';
  const display = formatTime(secondsLeft);
  if (rosettaTable) return applySubstitution(display, rosettaTable);
  return display;
}

export function buttonStates(sessionState) {
  // DEV: Returns the intended state of each button as {visible, enabled, label}.
  // popup.js calls applyButtonState() on each result. The logic here is pure —
  // no DOM reads or writes, just flag evaluation.
  const { running, paused, secondsLeft, brokenUI, rosettaTable, lastMinute, blindfolded } = sessionState;

  const inLastMinute  = secondsLeft <= 60;
  const cancelVisible = !lastMinute || inLastMinute;
  // DEV: Pause is also locked in Last Minute mode — not just Cancel.
  const pauseEnabled  = !brokenUI && (!lastMinute || inLastMinute);

  const buttons = {
    start:    { visible: !running, enabled: true,         label: 'Start' },
    pause:    { visible: running,  enabled: pauseEnabled, label: paused ? 'Resume' : 'Pause' },
    cancel:   { visible: running && cancelVisible, enabled: !brokenUI, label: 'Cancel' },
    blindfold:{ visible: true,     enabled: !running,     label: blindfolded ? 'Remove blindfold' : 'Blindfold' },
    peek:     { visible: running && blindfolded, enabled: true, label: 'Take a peek' },
  };

  if (rosettaTable && running) {
    // DEV: Apply the pre-built table to all visible button labels.
    // Called every tick, but the same table means the same label always produces
    // the same scrambled output — no flickering.
    for (const key of Object.keys(buttons)) {
      if (buttons[key].visible) {
        buttons[key].label = applySubstitution(buttons[key].label, rosettaTable);
      }
    }
  }

  return buttons;
}

export function disclaimerText() {
  // DEV: Returns the consent checkbox text. No scrambling on the setup screen —
  // Rosetta Stone only activates after Start is clicked.
  return 'I understand this will send an email on my behalf. '
    + 'I consent to the recipient receiving and using this information at their discretion.';
}

export function buildRosettaTable() {
  // DEV: Generates a one-time character substitution table.
  // The 62-character pool (A–Z, a–z, 0–9) is Fisher-Yates shuffled.
  // The result is a Map<original, substituted> where every alphanumeric
  // maps to a different alphanumeric — letters can become digits and vice versa.
  // Symbols, spaces, and punctuation are not in the pool and pass through unchanged.
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
  // DEV: Applies the table to a string. Characters not in the table pass through.
  return str.split('').map(c => table.get(c) ?? c).join('');
}

export function scrambleWords(text) {
  // DEV: Fisher-Yates shuffle of the words in a string, used for the consent
  // text in Rosetta Stone mode. Words remain individually legible; the sentence
  // becomes nonsensical.
  const words = text.split(' ');
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(' ');
}

export function spinTheWheel() {
  // DEV: 50/50. Called in onComplete when Spin the Wheel is active.
  return Math.random() < 0.5;
}
```

---

### popup/popup.html

The HTML defines three screens that are shown/hidden by toggling the `active` class:

- **screen-setup** — the configuration panel. Left column: Timer length, Modifiers, Chaos, Brave metadata. Right column: timer preview display, Blindfold toggle, Consent checkbox, Start button.
- **screen-running** — the live countdown. Left column: active mode flags. Right column: the timer display, and the action buttons (Pause, Cancel, Peek, live Blindfold, live Roulette).
- **screen-outcome** — shown after send or cancel. Icon, title, detail text, and a Close button.

Nothing interactive happens in the HTML itself — all logic is in `popup.js`.

---

### popup/popup.css

Standard CSS. Notable decisions:

- `body` has `min-width: 480px` but no fixed width — the window is resizable.
- `.option-row > span` is `display: block` — this is what makes option names and descriptions stack vertically rather than sitting side-by-side.
- `.outcome-detail` has `white-space: pre-line` — allows `\n` in the JS string to render as visible line breaks.
- `.btn:disabled` has `opacity: 0.4` — disabled buttons are visible but clearly inactive. In Bricked UI, Cancel and Pause render this way even though the user didn't disable them.

---

### popup/popup.js

This is the longest file (~300 lines of logic after stripping comments). Key sections:

**Initialisation:** Reads `?composeTabId` from the URL, starts polling the To field every 2 seconds via `getComposeDetails()`, and sets up event listeners.

**Start handler:** Reads all toggle states, creates a `GameState`, calls `gameState.begin()`, and either fires immediately (Roulette / Commitment Issues) or calls `startRunningScreen()`.

**startRunningScreen():** Builds the Rosetta table if needed, applies initial label scrambling, arms the Bricked UI timeout, creates a `MailTimer`, and starts it. The `onTick` callback runs every 100ms — updates the display, recomputes button states, and passes them to `applyButtonState()`.

**doSend():** Optionally collects brave metadata, calls `gameState.recordSend()`, calls `buildEmail()`, prefixes the subject, calls `browser.compose.setComposeDetails()` then `browser.compose.sendMessage()`, refocuses the Mailtimer window, then calls `showOutcome()`.

**showOutcome():** Switches to the outcome screen and populates it. The outcome screen is never scrambled — plain text regardless of active modes.

---

## Modification notes

**Adding a new mode:** Add a toggle to `popup.html`, a flag to the `GameState` constructor, wire the toggle in `popup.js`'s Start handler, and add the effect wherever it belongs (`onTick`, `onComplete`, `buttonStates`, etc.). Add it to `populateRunFlags()` so it appears in the running screen's mode list.

**Changing the timer behaviour:** Only `timer.js` needs touching. The `onTick` and `onComplete` callbacks give popup.js everything it needs to respond.

**Adding a web version:** Replace `popup.js`'s `getComposeDetails()` and `doSend()` with implementations that call your server API. Everything in `core/` works as-is.

**Changing the log format:** Only `gameState.js → formatLog()` and `emailData.js → formatBraveMetadata()` need changing.
