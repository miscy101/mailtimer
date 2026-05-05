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

    // TARDIS-specific state
    this._tardisTargetSpeed   = 1.0;  // speed we are heading toward
    this._tardisCurrentSpeed  = 1.0;  // speed right now (interpolated)
    this._tardisStepAge       = 0;    // ms elapsed in current 5-second ramp
    this._tardisStepDuration  = 5000; // ms per ramp segment (constant)
    this._tardisPrevSpeed     = 1.0;  // speed at the start of current ramp

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
      this._tardisCurrentSpeed  = 1.0;
      this._tardisTargetSpeed   = this._newTardisSpeed();
      this._tardisPrevSpeed     = 1.0;
      this._tardisStepAge       = 0;
    }

    // We tick every 100ms for smooth TARDIS display.
    // Each tick advances the countdown by (speed × 0.1) seconds.
    const TICK_MS = 100;

    this._intervalId = setInterval(() => {
      if (this._paused || this._cancelled) return;

      // --- TARDIS: smoothly interpolate speed ---
      if (this.mode === 'tardis') {
        this._tardisStepAge += TICK_MS;

        if (this._tardisStepAge >= this._tardisStepDuration) {
          // Ramp complete — lock in target, pick next target
          this._tardisPrevSpeed     = this._tardisTargetSpeed;
          this._tardisCurrentSpeed  = this._tardisTargetSpeed;
          this._tardisTargetSpeed   = this._newTardisSpeed();
          this._tardisStepAge       = 0;
        } else {
          // Linear interpolation: t goes 0→1 over the 5-second ramp
          const t = this._tardisStepAge / this._tardisStepDuration;
          this._tardisCurrentSpeed =
            this._tardisPrevSpeed +
            t * (this._tardisTargetSpeed - this._tardisPrevSpeed);
        }

        this._speed = this._tardisCurrentSpeed;
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
  _newTardisSpeed() {
    // If a pre-computed replayer was provided (Outlook mode), use it.
    // Otherwise generate randomly (Thunderbird mode).
    if (this._speedReplayer) {
      return this._speedReplayer(this._tardisTargetSpeed);
    }
    const min = 0.5;
    const max = 2.0;
    let candidate;
    do {
      candidate = min + Math.random() * (max - min);
      candidate = Math.round(candidate * 100) / 100;
    } while (Math.abs(candidate - this._tardisTargetSpeed) < 0.2);
    return candidate;
  }
}
