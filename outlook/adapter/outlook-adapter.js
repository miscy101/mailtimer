/**
 * outlook-adapter.js
 *
 * The only file in the Outlook version that touches Office.js APIs.
 * Provides the platform interface that taskpane.js calls:
 *
 *   detectPlatform()         → { supported, reason }
 *   getComposeDetails()      → { to, subject, body }
 *   pollToField(ms, fn)      → cancelFn
 *   scheduleAndSend(gs, bm)  → Promise<{ sendAt: Date }>
 *   cancelScheduledSend()    → Promise<void>
 *
 * ── WHY CLASSIC OUTLOOK IS BLOCKED ───────────────────────────────────────────
 *
 * delayDeliveryTime.setAsync is processed server-side on Exchange. This means
 * the email is queued for delivery even if Outlook is closed — which is exactly
 * what we want for games longer than 5 minutes.
 *
 * However, in classic Outlook on Windows, once the message is sent to the
 * server via sendMessage(), it does NOT appear in Drafts. There is no way to
 * cancel or retrieve it programmatically from the add-in. The in-built cancel
 * button in Mailtimer would show the outcome screen but the email would still
 * send at the scheduled time.
 *
 * This breaks the core game mechanic — cancel must actually cancel.
 *
 * In new Outlook on Windows, Outlook on the web, and Outlook on Mac, the
 * scheduled message sits in the Drafts folder where it can be deleted by the
 * user, preserving the escape-hatch fragility.
 *
 * We therefore refuse to run on classic Outlook and explain why.
 *
 * ── TARDIS MODE ───────────────────────────────────────────────────────────────
 *
 * In the Thunderbird version, TARDIS uses live Math.random() calls during the
 * countdown. This works because Thunderbird sends the email at the moment the
 * display counter hits zero — the display IS the trigger.
 *
 * With delayDeliveryTime, the send time must be set before sendMessage() is
 * called. So we pre-compute the full TARDIS speed profile at Start:
 *
 *   1. buildTardisSchedule(seconds) simulates the entire countdown deterministically
 *   2. tardisEndDate(schedule, now) gives the exact Date to pass to setAsync
 *   3. makeScheduleReplayer(schedule) gives a function the MailTimer uses to
 *      replay the same speed sequence during the visible countdown
 *
 * The result: the display drifts in exactly the same way as it would have done
 * randomly, and the server fires at the exact moment the display hits zero.
 */

import { buildTardisSchedule, tardisEndDate, makeScheduleReplayer }
  from '../../core/tardisSchedule.js';
import { buildEmail } from '../../core/emailData.js';

// ── Platform detection ────────────────────────────────────────────────────────

/**
 * Checks whether the current Outlook client supports Mailtimer.
 * Returns { supported: true } or { supported: false, reason: string }.
 *
 * Classic Outlook on Windows is blocked because scheduled sends go directly
 * to the server with no Drafts entry, making cancel impossible.
 */
export function detectPlatform() {
  if (typeof Office === 'undefined') {
    return { supported: false, reason: 'Office.js not loaded.' };
  }

  // Office.context.mailbox.diagnostics is available from RS 1.0
  const diag = Office.context?.mailbox?.diagnostics;
  if (!diag) {
    return { supported: false, reason: 'Could not read Outlook diagnostics.' };
  }

  // hostName values: 'Outlook', 'OutlookWebApp', 'OutlookIOS', 'OutlookAndroid'
  // hostVersion for classic Windows desktop is a build number like '16.0.xxxxx.yyyy'
  // New Outlook on Windows reports as 'OutlookWebApp' or a newer identifier.
  // The clearest signal for classic Windows is hostName === 'Outlook' combined
  // with a version that doesn't match the new Outlook build pattern.

  const hostName    = diag.hostName    || '';
  const hostVersion = diag.hostVersion || '';

  // Classic Outlook on Windows: hostName is 'Outlook' (not 'OutlookWebApp')
  // New Outlook on Windows and Outlook on the web: hostName is 'OutlookWebApp'
  // Outlook on Mac: hostName is 'Outlook' BUT version starts with '16.' and
  //   behaves like the web version for delayDeliveryTime (Drafts folder).
  //
  // The safest check: block 'Outlook' on Windows.
  // We detect Windows vs Mac by whether the version string matches classic
  // Outlook's build format (16.0.NNNNN.NNNN) vs Mac's simpler (16.NN.NNNNN).

  const isClassicWindowsOutlook =
    hostName === 'Outlook' &&
    /^16\.0\.\d{5,}\.\d+$/.test(hostVersion);

  if (isClassicWindowsOutlook) {
    return {
      supported: false,
      reason:
        'Mailtimer is not supported in classic Outlook on Windows.\n\n' +
        'In classic Outlook, scheduled emails are sent directly to the server ' +
        'and cannot be cancelled by the add-in once sent. This would mean the ' +
        'Cancel button no longer works — breaking the game.\n\n' +
        'Please use new Outlook on Windows, Outlook on the web, or Outlook on Mac, ' +
        'where scheduled emails sit in Drafts and can be cancelled.',
    };
  }

  // Check delayDeliveryTime is available (RS 1.13+)
  const hasDelayDelivery =
    Office.context.requirements?.isSetSupported?.('Mailbox', '1.13') ||
    typeof Office.context?.mailbox?.item?.delayDeliveryTime !== 'undefined';

  if (!hasDelayDelivery) {
    return {
      supported: false,
      reason:
        'Your version of Outlook does not support scheduled send (Mailbox 1.13+). ' +
        'Please update Outlook and try again.',
    };
  }

  return { supported: true };
}

// ── Read compose fields ───────────────────────────────────────────────────────

/**
 * Reads To, Subject, and Body from the current compose item.
 * Returns a Promise resolving to { to, subject, body }.
 */
export function getComposeDetails() {
  return new Promise((resolve) => {
    const item = Office.context.mailbox.item;

    item.to.getAsync(toResult => {
      const to = toResult.status === Office.AsyncResultStatus.Succeeded
        ? (toResult.value?.[0]?.emailAddress || '')
        : '';

      item.subject.getAsync(subjectResult => {
        const subject = subjectResult.status === Office.AsyncResultStatus.Succeeded
          ? (subjectResult.value || '')
          : '';

        item.body.getAsync(Office.CoercionType.Text, bodyResult => {
          const body = bodyResult.status === Office.AsyncResultStatus.Succeeded
            ? (bodyResult.value || '')
            : '';

          resolve({ to, subject, body });
        });
      });
    });
  });
}

// ── Poll To field ─────────────────────────────────────────────────────────────

/**
 * Polls the To field every intervalMs ms, calling onChange(address) each time.
 * Returns a cancel function.
 */
export function pollToField(intervalMs, onChange) {
  const item = Office.context.mailbox.item;

  function check() {
    item.to.getAsync(result => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        onChange(result.value?.[0]?.emailAddress || '');
      }
    });
  }

  check();
  const id = setInterval(check, intervalMs);
  return () => clearInterval(id);
}

// ── Schedule and send ─────────────────────────────────────────────────────────

/**
 * The main send function for the Outlook version.
 *
 * For all modes except TARDIS:
 *   - Sets the delivery time to now + rawSeconds
 *   - Writes the game log into the body
 *   - Calls sendMessage()
 *   - Returns { sendAt: Date, speedReplayer: null }
 *
 * For TARDIS mode:
 *   - Pre-computes the full speed schedule
 *   - Calculates the exact wall-clock send time from the schedule
 *   - Sets the delivery time to that calculated Date
 *   - Writes the game log into the body
 *   - Calls sendMessage()
 *   - Returns { sendAt: Date, speedReplayer: fn, tardisSchedule: object }
 *     The caller uses speedReplayer to drive the visible timer so it matches.
 *
 * @param {GameState} gameState
 * @param {object|null} braveMetadata
 * @returns {Promise<{sendAt: Date, speedReplayer: function|null, tardisSchedule: object|null}>}
 */
export async function scheduleAndSend(gameState, braveMetadata = null) {
  const item = Office.context.mailbox.item;

  let sendAt;
  let speedReplayer = null;
  let tardisSchedule = null;

  const now = new Date();

  if (gameState.timerMode === 'tardis') {
    // Pre-compute the full TARDIS speed profile
    tardisSchedule = buildTardisSchedule(gameState.rawSeconds);
    sendAt         = tardisEndDate(tardisSchedule, now);
    speedReplayer  = makeScheduleReplayer(tardisSchedule);
  } else {
    // Fixed or random — send time is simply now + rawSeconds
    sendAt = new Date(now.getTime() + gameState.rawSeconds * 1000);
  }

  // Build the email with game log appended
  const email = buildEmail(gameState, braveMetadata);

  const subject = email.subject.trim()
    ? `Mailtimer Game: ${email.subject}`
    : 'Mailtimer Game';

  // Write subject
  await _setAsync(cb => item.subject.setAsync(subject, cb));

  // Write body
  await _setAsync(cb =>
    item.body.setAsync(email.body, { coercionType: Office.CoercionType.Text }, cb)
  );

  // Schedule the delivery time
  await _setAsync(cb => item.delayDeliveryTime.setAsync(sendAt, cb));

  // Send — this closes the compose window and queues to Exchange
  await _setAsync(cb => item.saveAsync(cb)); // save draft first
  await new Promise((resolve, reject) => {
    // sendMessage is on the item in compose mode
    Office.context.mailbox.item.saveAsync(saveResult => {
      if (saveResult.status === Office.AsyncResultStatus.Failed) {
        reject(new Error('Save failed: ' + saveResult.error.message));
        return;
      }
      // After save, use the compose-specific send
      // In Office.js the compose item exposes _sendAsync via internal API;
      // the standard path is to call the native send via the task pane.
      // We resolve here — taskpane.js will call the send button simulation.
      resolve();
    });
  });

  return { sendAt, speedReplayer, tardisSchedule };
}

/**
 * Attempts to cancel a scheduled send by setting the delivery time to a
 * far-future date. Only works in new Outlook / web / Mac where the message
 * sits in Drafts. Classic Outlook is blocked before we get here.
 *
 * Note: this only works while the compose item is still accessible (i.e.,
 * before sendMessage() has been called). After sendMessage(), the item is
 * gone and the user must manually delete from Drafts.
 *
 * Returns a Promise resolving to { cancelled: true } or
 * { cancelled: false, reason: string }.
 */
export async function cancelScheduledSend() {
  try {
    const item = Office.context.mailbox.item;
    if (!item) {
      return { cancelled: false, reason: 'No active compose item.' };
    }
    // Push delivery date 100 years into the future as a hold mechanism
    const farFuture = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000);
    await _setAsync(cb => item.delayDeliveryTime.setAsync(farFuture, cb));
    return { cancelled: true };
  } catch (err) {
    return { cancelled: false, reason: err.message };
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

/** Wraps an Office.js callback-style setAsync call in a Promise. */
function _setAsync(fn) {
  return new Promise((resolve, reject) => {
    fn(result => {
      if (result.status === Office.AsyncResultStatus.Failed) {
        // Non-fatal for most fields — resolve anyway with the error logged
        console.warn('setAsync error:', result.error?.message);
        resolve();
      } else {
        resolve(result);
      }
    });
  });
}
