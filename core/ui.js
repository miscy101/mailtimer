/**
 * ui.js — display logic shared between Thunderbird popup and web page
 *
 * This file never touches the DOM directly.
 * Instead it produces plain data objects that the platform layer renders.
 * That way the same logic runs identically in both environments.
 *
 * The platform (Thunderbird popup or web page) calls these functions
 * and uses the returned values to update whatever UI it has.
 */

// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Formats seconds as a plain integer seconds display.
 * e.g. 75.4 → "75"
 * Deliberately disorienting — no minutes, no colon structure.
 */
export function formatTime(secondsLeft) {
  return String(Math.max(0, Math.ceil(secondsLeft)));
}

/**
 * Returns what the timer display should show.
 * Handles blindfold and Rosetta Stone substitution.
 *
 * @param {number}  secondsLeft
 * @param {boolean} blindfolded   - true → show ???
 * @param {boolean} peeking       - true → temporarily reveal (1-second window)
 * @param {Map}     [rosettaTable] - pre-built substitution table, or null
 * @returns {string}
 */
export function timerDisplay(secondsLeft, { blindfolded, peeking, rosettaTable } = {}) {
  if (blindfolded && !peeking) {
    return '???';
  }

  const display = formatTime(secondsLeft);

  if (rosettaTable) {
    return applySubstitution(display, rosettaTable);
  }

  return display;
}

/**
 * Returns the state of each button as { visible, enabled, label }.
 * The platform layer uses this to show/hide/disable buttons.
 *
 * @param {object} sessionState
 * @param {boolean} sessionState.running
 * @param {boolean} sessionState.paused
 * @param {number}  sessionState.secondsLeft
 * @param {boolean} sessionState.brokenUI       - bricked UI mode active
 * @param {Map}     [sessionState.rosettaTable]  - pre-built substitution table, or null
 * @param {boolean} sessionState.lastMinute     - Last Minute mode active
 * @param {boolean} sessionState.blindfolded
 * @param {number}  [sessionState.peeksRemaining] - Infinity if unlimited; 0 = exhausted
 */
export function buttonStates(sessionState) {
  const {
    running, paused, secondsLeft,
    brokenUI, rosettaTable, lastMinute, blindfolded,
    peeksRemaining = Infinity,
  } = sessionState;

  const inLastMinute  = secondsLeft <= 60;
  // In Last Minute mode both buttons are visible but disabled until the final 60s.
  // Neither is hidden — the player can see them, they just won't respond.
  const cancelEnabled = (!lastMinute || inLastMinute) && !brokenUI;
  const pauseEnabled  = (!lastMinute || inLastMinute) && !brokenUI;

  // Peek is visible when blindfolded but disabled when peeks are exhausted
  const peekVisible = running && blindfolded;
  const peekEnabled = peekVisible && peeksRemaining > 0;
  const peekLabel   = (peeksRemaining !== Infinity && peeksRemaining >= 0)
    ? `Take a peek (${peeksRemaining} left)`
    : 'Take a peek';

  const buttons = {
    start: {
      visible: !running,
      enabled: true,
      label:   'Start',
    },
    pause: {
      visible: running,
      enabled: pauseEnabled,
      label:   paused ? 'Un-pause' : 'Pause',
    },
    cancel: {
      visible: running,
      enabled: cancelEnabled,
      label:   'Cancel',
    },
    blindfold: {
      visible: true,
      enabled: !running,
      label:   blindfolded ? 'Remove blindfold' : 'Blindfold',
    },
    peek: {
      visible: peekVisible,
      enabled: peekEnabled,
      label:   peekLabel,
    },
  };

  // Rosetta Stone: apply stable substitution to all visible button labels
  if (rosettaTable && running) {
    for (const key of Object.keys(buttons)) {
      if (buttons[key].visible) {
        buttons[key].label = applySubstitution(buttons[key].label, rosettaTable);
      }
    }
  }

  return buttons;
}

/**
 * Builds the disclaimer text shown next to the consent checkbox.
 * Never scrambled — Rosetta Stone only activates after Start is clicked.
 */
export function disclaimerText() {
  return 'I understand this will send an email on my behalf. '
    + 'I consent to the recipient receiving and using this information at their discretion.';
}

/**
 * Builds the Commitment Issues disclaimer shown in setup.
 * Never scrambled — this is a real informed-consent notice.
 */
export function commitmentIssuesDisclaimer() {
  return 'This mode is for people who want to send, and who consent to sending, '
    + 'but find they get cold feet. We\'ll help you follow through, guaranteed.';
}

// ─── Rosetta Stone helpers ────────────────────────────────────────────────────

/**
 * Generates a one-time substitution table for Rosetta Stone mode.
 * Call once at Start; pass the result to applySubstitution() for the session.
 *
 * Letters (a-z, A-Z) and digits (0-9) are treated as one shared pool —
 * any letter or digit can map to any other letter or digit.
 * Symbols, spaces, and punctuation pass through unchanged.
 *
 * The table is a Map<originalChar, substitutedChar>.
 */
export function buildRosettaTable() {
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const poolArr = pool.split('');

  // Fisher-Yates shuffle a copy of the pool
  const shuffled = [...poolArr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const table = new Map();
  for (let i = 0; i < poolArr.length; i++) {
    table.set(poolArr[i], shuffled[i]);
  }
  return table;
}

/**
 * Applies a pre-built substitution table to a string.
 * Characters not in the table (spaces, punctuation, symbols) pass through.
 */
export function applySubstitution(str, table) {
  return str.split('').map(c => table.get(c) ?? c).join('');
}

/**
 * Scrambles a sentence word-by-word (shuffles word order).
 * Used for the consent text in Rosetta Stone mode — words stay readable
 * individually, but the sentence makes no sense.
 * Only called once at Start now.
 */
export function scrambleWords(text) {
  const words = text.split(' ');
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(' ');
}

// ─── Spin the Wheel ───────────────────────────────────────────────────────────

/**
 * Resolves a Spin the Wheel outcome.
 * Returns true (send) or false (blocked).
 * 50/50 by default; could be parameterised later.
 */
export function spinTheWheel() {
  return Math.random() < 0.5;
}
