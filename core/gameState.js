/**
 * gameState.js — tracks everything about one mailtimer session
 *
 * Holds the email payload, all mode settings, and the live game log.
 * Pure data — no timers, no UI, no sending.
 *
 * One GameState is created when the user fills in the compose form
 * and clicks Start. It travels through the whole session and its
 * log is appended to the email body on send.
 */

export class GameState {
  /**
   * @param {object} options
   *
   * Email fields
   * @param {string}   options.to
   * @param {string}   options.subject
   * @param {string}   options.body
   *
   * Timer settings
   * @param {'fixed'|'random'|'tardis'}  options.timerMode
   * @param {number}   [options.seconds]      - used when timerMode is 'fixed' (default 600)
   * @param {number}   [options.randomMin]    - used when timerMode is 'random'
   * @param {number}   [options.randomMax]    - used when timerMode is 'random'
   *
   * Send outcome mode
   * @param {'standard'|'commitmentIssues'} options.sendMode
   *
   * Modifier flags
   * @param {boolean}  [options.blindfolded]    - start blindfolded?
   * @param {boolean}  [options.tardis]         - TARDIS speed drift?
   * @param {boolean}  [options.spinTheWheel]   - 50% chance to send at zero
   * @param {boolean}  [options.lastMinute]     - hide cancel/pause until ≤60s
   * @param {boolean}  [options.roulette]       - 10% instant-send on Start
   * @param {boolean}  [options.brokenUI]       - bricked UI mode
   * @param {boolean}  [options.rosettaStone]   - scramble UI labels
   * @param {boolean}  [options.braveMetadata]  - attach system metadata to email
   */
  constructor(options) {
    // ── Email payload ─────────────────────────────────────────────────────
    this.to      = options.to;
    this.subject = options.subject;
    this.body    = options.body;

    // ── Timer settings ────────────────────────────────────────────────────
    this.timerMode  = options.timerMode || 'fixed';
    this.rawSeconds = this._resolveSeconds(options);

    // ── Send outcome mode ─────────────────────────────────────────────────
    this.sendMode = options.sendMode || 'standard';

    // ── Modifier flags ────────────────────────────────────────────────────
    this.blindfolded   = options.blindfolded   || false;
    this.tardis        = options.tardis        || false;
    this.spinTheWheel  = options.spinTheWheel  || false;
    this.lastMinute    = options.lastMinute    || false;
    this.roulette      = options.roulette      || false;
    this.brokenUI      = options.brokenUI      || false;
    this.rosettaStone  = options.rosettaStone  || false;
    this.braveMetadata = options.braveMetadata || false;

    // Peek limit: null = unlimited, number = max peeks allowed
    this.peekLimit     = options.peekLimit     ?? null;
    // Live count of peeks remaining (starts at limit, counts down)
    this.peeksRemaining = this.peekLimit !== null ? this.peekLimit : Infinity;

    // ── Live log (grows during the session) ───────────────────────────────
    this.log = {
      timerMode:         this.timerMode,
      sendMode:          this.sendMode,
      secondsConfigured: this.rawSeconds,
      blindfoldedStart:  this.blindfolded,
      blindfoldedMidRun: false,
      peekLimit:         this.peekLimit,   // null = unlimited
      peekCount:         0,
      pauseCount:        0,
      tardisUsed:        this.tardis,
      brokenUIUsed:      this.brokenUI,
      rosettaStoneUsed:  this.rosettaStone,
      spinOutcome:       null,    // 'sent' | 'blocked'
      rouletteTriggered: false,
      braveMetadata:     null,    // populated at send time if braveMetadata is on
      outcome:           null,    // 'sent' | 'cancelled'
      startedAt:         null,
      completedAt:       null,
    };
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────

  begin() {
    this.log.startedAt = new Date().toISOString();
  }

  recordPeek() {
    this.log.peekCount++;
    if (this.peekLimit !== null) {
      this.peeksRemaining = Math.max(0, this.peeksRemaining - 1);
    }
  }

  /** Returns true if the player is still allowed to peek */
  get canPeek() {
    return this.peeksRemaining > 0;
  }

  recordPause() {
    this.log.pauseCount++;
  }

  recordSend() {
    this.log.outcome     = 'sent';
    this.log.completedAt = new Date().toISOString();
  }

  recordCancel() {
    this.log.outcome     = 'cancelled';
    this.log.completedAt = new Date().toISOString();
  }

  recordSpinOutcome(sent) {
    this.log.spinOutcome = sent ? 'sent' : 'blocked';
  }

  // ─── Game log text (appended to email body on send) ───────────────────────

  formatLog() {
    const l = this.log;

    // Use | as separator — works in HTML and plain text email modes alike.
    // Line breaks can't be relied on when Thunderbird writes an HTML compose
    // window body back as plain text.
    const parts = [
      'Mailtimer game log',
      `Mode: ${l.timerMode}${l.tardisUsed ? ' (TARDIS)' : ''}`,
      `Time: ${l.secondsConfigured}s`,
      `Send mode: ${l.sendMode}`,
      `Started: ${l.startedAt || '—'}`,
      `Completed: ${l.completedAt || '—'}`,
      `Outcome: ${l.outcome || '—'}`,
    ];

    if (l.blindfoldedStart)  parts.push('Blindfolded from start');
    if (l.blindfoldedMidRun) parts.push('Blindfolded mid-run');
    if (l.peekCount > 0) {
      const limitNote = l.peekLimit !== null ? ` (limit: ${l.peekLimit})` : '';
      parts.push(`Peeks: ${l.peekCount}${limitNote}`);
    }
    if (l.pauseCount > 0)    parts.push(`Pauses: ${l.pauseCount}`);
    if (l.spinOutcome)       parts.push(`Spin: ${l.spinOutcome}`);
    if (l.rouletteTriggered) parts.push('Roulette fired');
    if (l.brokenUIUsed)      parts.push('Bricked UI active');
    if (l.rosettaStoneUsed)  parts.push('Rosetta Stone active');

    return ' | ' + parts.join(' | ');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _resolveSeconds(options) {
    if (options.timerMode === 'random') {
      const min = options.randomMin || 60;
      const max = options.randomMax || 600;
      return Math.floor(min + Math.random() * (max - min));
    }
    return options.seconds || 600;
  }
}
