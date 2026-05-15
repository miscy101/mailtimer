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
    // Store range for random mode so the log can report the parameters
    this.randomMin  = options.randomMin || null;
    this.randomMax  = options.randomMax || null;

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
    // metadataMode: 'none' | 'log' | 'extra'
    // Controls what gets appended to the email body on send.
    this.metadataMode  = options.metadataMode  || 'log';

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
      braveMetadata:     null,    // populated at send time if metadataMode is extra
      consentText:       null,    // populated at Start if metadataMode is log or extra
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
    const parts = ['Mailtimer game log'];

    // ── Timer description ──
    if (this.timerMode === 'random') {
      parts.push(
        `This Mailtimer game was played with a random countdown timer of ${this.rawSeconds} seconds` +
        (this.randomMin && this.randomMax
          ? ` (parameters set by the user: between ${this.randomMin} and ${this.randomMax} seconds)`
          : '')
      );
    } else {
      parts.push(
        `This Mailtimer game was played with a user set countdown time of ${this.rawSeconds} seconds`
      );
    }

    if (l.tardisUsed) {
      const wallSecs = l.startedAt && l.completedAt
        ? Math.round((new Date(l.completedAt) - new Date(l.startedAt)) / 1000)
        : null;
      parts.push(
        `The actual total countdown time lasted for ${wallSecs !== null ? wallSecs : '?'} seconds` +
        ' due to a fold in space-time — TARDIS mode was active'
      );
    }

    // ── Active modifiers ──
    const modifiers = [];
    if (l.spinOutcome !== null) modifiers.push('Spin the wheel');
    if (this.lastMinute)        modifiers.push('Last minute');
    if (l.rouletteTriggered)    modifiers.push('Roulette');
    if (l.brokenUIUsed)         modifiers.push('Unstable UI');
    if (l.rosettaStoneUsed)     modifiers.push('Babel');
    if (this.sendMode === 'commitmentIssues') modifiers.push('Commitment issues');

    if (modifiers.length === 0) {
      parts.push('They selected no modifiers');
    } else if (modifiers.length === 1) {
      parts.push(`They selected the following modifier: ${modifiers[0]}`);
    } else {
      const last = modifiers.pop();
      parts.push(`They selected the following modifiers: ${modifiers.join(', ')} and ${last}`);
    }

    // ── Spin outcome ──
    if (l.spinOutcome) {
      parts.push(`Spin the wheel result: ${l.spinOutcome}`);
    }

    // ── Pauses ──
    if (l.pauseCount > 0) {
      parts.push(`They paused the timer ${l.pauseCount} time${l.pauseCount > 1 ? 's' : ''}`);
    }

    // ── Blindfold ──
    const wasBlindfolded = l.blindfoldedStart || l.blindfoldedMidRun;
    if (!wasBlindfolded) {
      parts.push('They did not use the Blindfold');
    } else {
      const how = l.blindfoldedStart ? 'from the start' : 'mid-run';
      const limitNote = l.peekLimit !== null
        ? `They had ${l.peekLimit} peek${l.peekLimit !== 1 ? 's' : ''} available.`
        : 'They had unlimited peeks available.';
      const usedNote = l.peekCount > 0
        ? `They used ${l.peekCount} peek${l.peekCount !== 1 ? 's' : ''}.`
        : 'They did not use any peeks.';
      parts.push(`They used the Blindfold (applied ${how}). ${limitNote} ${usedNote}`.trim());
    }

    // ── Consent ──
    if (l.consentText) {
      parts.push(`As a part of this game, they consented to the following: ${l.consentText}`);
    }

    parts.push(
      'This Mailtimer is an add-on for Thunderbird. ' +
      'The source code, install files and documentation are available online at ' +
      'https://github.com/miscy101/mailtimer'
    );

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
