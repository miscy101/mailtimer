/**
 * timer.js — core countdown logic for mailtimer
 *
 * This file knows nothing about Thunderbird, browsers, or email.
 * It just counts down, with optional TARDIS speed drift.
 *
 * Usage:
 *   const t = new MailTimer({ seconds: 600, mode: 'fixed', onTick, onComplete })
 *   t.start()
 *   t.pause()
 *   t.resume()
 *   t.cancel()
 */

export class MailTimer {
  /**
   * @param {object} options
   * @param {number}   options.seconds      - Total countdown in seconds
   * @param {'fixed'|'random'|'tardis'} options.mode - Timer mode
   * @param {function} options.onTick       - Called every ~100ms with { secondsLeft, speed }
   * @param {function} options.onComplete   - Called when timer reaches zero
   * @param {function} [options.onCancel]   - Called if cancelled
   */
  constructor(options) {
    this.totalSeconds  = options.seconds;
    this.mode          = options.mode || 'fixed';
    this.onTick        = options.onTick       || (() => {});
    this.onComplete    = options.onComplete   || (() => {});
    this.onCancel      = options.onCancel     || (() => {});

    // Optional: a function () => nextSpeed supplied by the Outlook adapter
    // so TARDIS replays a pre-computed schedule instead of using Math.random().
    // If null, the timer generates speeds randomly (Thunderbird behaviour).
    this._speedReplayer = options.speedReplayer || null;

    // Internal state
    this._secondsLeft  = options.seconds;   // fractional seconds remaining
    this._speed        = 1.0;               // current playback speed (1 = normal)
    this._paused       = false;
    this._cancelled    = false;
    this._intervalId   = null;
    this._pauseCount   = 0;

    // TARDIS-specific state — burst mechanic
    // The timer alternates between normal speed (1.0×) and burst speed.
    // Burst speed starts at 1.5× and increases by 0.5× each burst cycle.
    // Each phase (normal or burst) lasts a random 5–20 seconds.
    this._tardisBurstCount    = 0;      // how many bursts have fired so far
    this._tardisInBurst       = false;  // currently in a burst?
    this._tardisPhaseMs       = 0;      // ms remaining in current phase
    this._tardisNextPhaseMs   = this._tardisRandomPhaseMs(); // duration of first phase

    // Game log
    this.log = {
      mode:         this.mode,
      totalSeconds: this.totalSeconds,
      peekCount:    0,
      pauseCount:   0,
      blindfolded:  false,
      outcome:      null,   // 'sent' | 'cancelled' | 'spin-sent' | 'spin-blocked'
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  start() {
    if (this._intervalId) return; // already running

    if (this.mode === 'tardis') {
      // Start in normal phase
      this._tardisInBurst     = false;
      this._tardisBurstCount  = 0;
      this._tardisPhaseMs     = 0;
      this._tardisNextPhaseMs = this._tardisRandomPhaseMs();
      this._speed             = 1.0;
    }

    // We tick every 100ms for smooth TARDIS display.
    // Each tick advances the countdown by (speed × 0.1) seconds.
    const TICK_MS = 100;

    this._intervalId = setInterval(() => {
      if (this._paused || this._cancelled) return;

      // --- TARDIS: burst mechanic ---
      if (this.mode === 'tardis') {
        this._tardisPhaseMs += TICK_MS;

        if (this._tardisPhaseMs >= this._tardisNextPhaseMs) {
          // Phase complete — toggle between normal and burst
          this._tardisPhaseMs = 0;
          this._tardisNextPhaseMs = this._tardisRandomPhaseMs();

          if (!this._tardisInBurst) {
            // Entering a burst — speed is 1.5× + 0.5× per previous burst
            this._tardisBurstCount++;
            this._tardisInBurst = true;
            this._speed = 1.0 + (this._tardisBurstCount * 0.5);
          } else {
            // Returning to normal speed
            this._tardisInBurst = false;
            this._speed = 1.0;
          }
        }
      }

      // --- Decrement countdown ---
      const decrement = this._speed * (TICK_MS / 1000); // seconds to subtract
      this._secondsLeft -= decrement;

      if (this._secondsLeft <= 0) {
        this._secondsLeft = 0;
        clearInterval(this._intervalId);
        this._intervalId = null;
        this.log.outcome = 'sent'; // caller may override to 'spin-blocked'
        this.onTick({ secondsLeft: 0, speed: this._speed });
        this.onComplete(this.log);
        return;
      }

      this.onTick({ secondsLeft: this._secondsLeft, speed: this._speed });
    }, TICK_MS);
  }

  pause() {
    if (this._paused || this._cancelled) return;
    this._paused = true;
    this._pauseCount++;
    this.log.pauseCount = this._pauseCount;
  }

  resume() {
    if (!this._paused || this._cancelled) return;
    this._paused = false;
  }

  cancel() {
    this._cancelled = true;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this.log.outcome = 'cancelled';
    this.onCancel(this.log);
  }

  recordPeek() {
    this.log.peekCount++;
  }

  setBlindfolded(value) {
    this.log.blindfolded = value;
  }

  get secondsLeft() {
    return this._secondsLeft;
  }

  get speed() {
    return this._speed;
  }

  get isPaused() {
    return this._paused;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Pick a random new TARDIS target speed.
   * Deliberately avoids picking the same as the current target
   * to keep things interesting. Clamped to [0.5, 2.0].
   */
  /**
   * Returns a random phase duration between 5 and 20 seconds in milliseconds.
   * Used for both the normal-speed phase and the burst phase.
   */
  _tardisRandomPhaseMs() {
    return 5000 + Math.random() * 15000;
  }
}
