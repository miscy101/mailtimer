/**
 * tardisSchedule.js — pre-computed TARDIS speed profile
 *
 * The Thunderbird version uses live Math.random() calls during the countdown.
 * The Outlook version needs the full schedule calculated up-front so we can
 * compute the exact wall-clock send time and pass it to delayDeliveryTime.setAsync.
 *
 * Both versions then replay the same schedule, so the display matches the send.
 *
 * A schedule is an array of ramp segments:
 *   [{ fromSpeed, toSpeed, durationMs }, ...]
 *
 * Within each segment, speed interpolates linearly from fromSpeed to toSpeed
 * over durationMs milliseconds — identical to the live TARDIS logic in timer.js.
 *
 * The schedule covers the entire countdown from secondsLeft = totalSeconds to 0.
 * Because speed varies, wall-clock time ≠ display time. The schedule lets us
 * calculate both.
 */

const TICK_MS          = 100;   // must match timer.js
const STEP_DURATION_MS = 5000;  // ramp duration — must match timer.js
const SPEED_MIN        = 0.5;
const SPEED_MAX        = 2.0;
const SPEED_MIN_DELTA  = 0.2;   // minimum change between successive targets

/**
 * Generates a complete TARDIS speed schedule for a countdown of `totalSeconds`.
 *
 * @param {number} totalSeconds
 * @returns {object} schedule
 * @returns {Array}  schedule.segments  — [{fromSpeed, toSpeed, durationMs}]
 * @returns {number} schedule.wallClockMs — exact wall-clock ms the display hits zero
 * @returns {number} schedule.totalSeconds — the input, stored for reference
 */
export function buildTardisSchedule(totalSeconds) {
  const segments = [];

  let displaySecondsLeft = totalSeconds;
  let wallClockMs        = 0;
  let prevSpeed          = 1.0;
  let targetSpeed        = _newSpeed(1.0);

  // Simulate tick-by-tick until display reaches zero.
  // We accumulate into segments as we go — each time a new target is picked
  // we close the current segment and start a new one.

  let stepAge    = 0;   // ms elapsed in current ramp
  let segFromSpeed = 1.0;

  while (displaySecondsLeft > 0) {
    // How long until the current ramp ends?
    const msUntilRampEnd = STEP_DURATION_MS - stepAge;

    // How many display-seconds will elapse if we complete this ramp?
    // Integrate: ∫ speed dt over [stepAge, STEP_DURATION_MS]
    // speed(t) = prevSpeed + (t/STEP_DURATION_MS) * (targetSpeed - prevSpeed)
    // But we only care about the decrement per TICK_MS, so we simulate in ticks.

    // Simulate remaining ticks in this ramp
    let msInRamp = 0;
    let rampWallMs = 0;

    while (msInRamp < msUntilRampEnd && displaySecondsLeft > 0) {
      const t       = (stepAge + msInRamp) / STEP_DURATION_MS;
      const speed   = prevSpeed + t * (targetSpeed - prevSpeed);
      const decrement = speed * (TICK_MS / 1000);

      displaySecondsLeft -= decrement;
      wallClockMs        += TICK_MS;
      rampWallMs         += TICK_MS;
      msInRamp           += TICK_MS;
    }

    if (displaySecondsLeft <= 0) {
      // Zero hit mid-ramp — close final segment
      segments.push({
        fromSpeed: segFromSpeed,
        toSpeed:   targetSpeed,
        durationMs: rampWallMs,
      });
      break;
    }

    // Ramp completed — record segment, pick next target
    segments.push({
      fromSpeed:  segFromSpeed,
      toSpeed:    targetSpeed,
      durationMs: STEP_DURATION_MS,
    });

    prevSpeed    = targetSpeed;
    segFromSpeed = targetSpeed;
    targetSpeed  = _newSpeed(prevSpeed);
    stepAge      = 0;
  }

  return {
    segments,
    wallClockMs: Math.max(wallClockMs, totalSeconds * 1000),
    totalSeconds,
  };
}

/**
 * Given a pre-built schedule, returns the Date at which the display will hit
 * zero, relative to a given start time.
 *
 * @param {object} schedule — from buildTardisSchedule()
 * @param {Date}   startTime — when the timer will start
 * @returns {Date}
 */
export function tardisEndDate(schedule, startTime) {
  return new Date(startTime.getTime() + schedule.wallClockMs);
}

/**
 * Creates a replay function for a pre-built schedule.
 * Used by MailTimer when a tardisSchedule is provided — instead of calling
 * Math.random() for each new speed target, it reads from the pre-computed list.
 *
 * Returns a function: () => nextTargetSpeed
 * Each call advances through the schedule's speed targets in order.
 * If the schedule runs out (shouldn't happen in practice), falls back to random.
 */
export function makeScheduleReplayer(schedule) {
  // Extract the sequence of target speeds from the segments
  const targets = schedule.segments.map(s => s.toSpeed);
  let index = 0;

  return function nextSpeed(currentTarget) {
    if (index < targets.length) {
      return targets[index++];
    }
    // Fallback: generate a new random speed (schedule ran longer than expected)
    return _newSpeed(currentTarget);
  };
}

// ── Private ───────────────────────────────────────────────────────────────────

function _newSpeed(currentTarget) {
  let candidate;
  do {
    candidate = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
    candidate = Math.round(candidate * 100) / 100;
  } while (Math.abs(candidate - currentTarget) < SPEED_MIN_DELTA);
  return candidate;
}
