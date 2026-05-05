/**
 * taskpane.js — Outlook task pane controller
 *
 * On load: checks platform support. Blocks classic Outlook with explanation.
 * On Start: uses scheduleAndSend() from the adapter, which:
 *   - For TARDIS: pre-computes the speed profile and calculates exact send time
 *   - For all modes: sets delayDeliveryTime and calls sendMessage
 * Then opens the timer dialog, which replays the same TARDIS schedule visually.
 */

import {
  detectPlatform, getComposeDetails, pollToField,
  scheduleAndSend, cancelScheduledSend,
} from '../adapter/outlook-adapter.js';
import { GameState } from '../../core/gameState.js';

// ── Wait for Office.js ────────────────────────────────────────────────────────

Office.onReady(() => { init(); });

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screenUnsupported  = $('screen-unsupported');
const screenSetup        = $('screen-setup');
const unsupportedReason  = $('unsupported-reason');

const toggleRandom     = $('toggle-random');
const timerFixed       = $('timer-fixed');
const timerRandom      = $('timer-random');
const inputSeconds     = $('input-seconds');
const inputMin         = $('input-min');
const inputMax         = $('input-max');
const toggleTardis     = $('toggle-tardis');
const toggleSpin       = $('toggle-spin');
const toggleLastminute = $('toggle-lastminute');
const toggleRoulette   = $('toggle-roulette');
const toggleBrokenui   = $('toggle-brokenui');
const toggleRosetta    = $('toggle-rosetta');
const toggleCommitment = $('toggle-commitment');
const toggleBrave      = $('toggle-brave');
const toggleBlindfold  = $('toggle-blindfold');
const togglePeekLimit  = $('toggle-peek-limit');
const inputPeekLimit   = $('input-peek-limit');
const peekLimitBlock   = $('peek-limit-block');
const peekLimitInputRow = $('peek-limit-input-row');
const consentCheckbox  = $('consent-checkbox');
const btnStart         = $('btn-start');
const warnNoTo         = $('warn-no-to');
const warnNoSubject    = $('warn-no-subject');
const displaySetup     = $('display-setup');
const sendReadyBlock   = $('send-ready-block');
const btnSendNow       = $('btn-send-now');

// ── Session state ─────────────────────────────────────────────────────────────

let gameState         = null;
let dialog            = null;
let cancelToPoll      = null;
let cachedToAddress   = '';
let cachedSubject     = '';
// After scheduleAndSend, holds the TARDIS replayer (if any) to pass to dialog
let pendingReplayer   = null;
let pendingSendAt     = null;

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  // Platform check first — block classic Outlook immediately
  const platform = detectPlatform();
  if (!platform.supported) {
    screenSetup.classList.remove('active');
    screenUnsupported.classList.add('active');
    unsupportedReason.textContent = platform.reason;
    return;
  }

  wireToggles();
  updateSetupDisplay();

  // Poll To and Subject
  cancelToPoll = pollToField(2000, addr => {
    cachedToAddress = addr;
    updateStartButton();
  });
  setInterval(async () => {
    const d = await getComposeDetails();
    cachedSubject = d.subject || '';
    updateStartButton();
  }, 3000);

  consentCheckbox.addEventListener('change', updateStartButton);
  btnStart.addEventListener('click', onStart);
  btnSendNow.addEventListener('click', onSendNow);
}

// ── Field polling and button gating ──────────────────────────────────────────

function updateStartButton() {
  const hasConsent = consentCheckbox.checked;
  const hasTo      = cachedToAddress.includes('@');
  const hasSubject = cachedSubject.trim().length > 0;

  btnStart.disabled = !(hasConsent && hasTo && hasSubject);
  warnNoTo.classList.toggle('hidden',      !(hasConsent && !hasTo));
  warnNoSubject.classList.toggle('hidden', !(hasConsent && hasTo && !hasSubject));
}

// ── Setup wiring ──────────────────────────────────────────────────────────────

function wireToggles() {
  toggleRandom.addEventListener('change', () => {
    timerFixed.classList.toggle('hidden', toggleRandom.checked);
    timerRandom.classList.toggle('hidden', !toggleRandom.checked);
    toggleBlindfold.checked = toggleRandom.checked;
    peekLimitBlock.classList.toggle('hidden', !toggleBlindfold.checked);
    updateSetupDisplay();
  });

  toggleBlindfold.addEventListener('change', () => {
    peekLimitBlock.classList.toggle('hidden', !toggleBlindfold.checked);
    if (!toggleBlindfold.checked) {
      togglePeekLimit.checked = false;
      peekLimitInputRow.classList.add('hidden');
    }
  });

  togglePeekLimit.addEventListener('change', () => {
    peekLimitInputRow.classList.toggle('hidden', !togglePeekLimit.checked);
  });

  inputSeconds.addEventListener('input', updateSetupDisplay);
  inputMin.addEventListener('input', updateSetupDisplay);
  inputMax.addEventListener('input', updateSetupDisplay);
}

function updateSetupDisplay() {
  if (toggleRandom.checked) {
    displaySetup.textContent = '???';
  } else {
    const s = Math.max(1, parseInt(inputSeconds.value) || 600);
    displaySetup.textContent = String(s);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function onStart() {
  if (cancelToPoll) { cancelToPoll(); cancelToPoll = null; }

  let minVal = parseInt(inputMin.value)  || 60;
  let maxVal = parseInt(inputMax.value)  || 600;
  if (minVal > maxVal) [minVal, maxVal] = [maxVal, minVal];

  const timerMode = toggleTardis.checked ? 'tardis'
                  : toggleRandom.checked  ? 'random'
                  : 'fixed';

  const details = await getComposeDetails();

  gameState = new GameState({
    to:      details.to,
    subject: details.subject,
    body:    details.body,
    timerMode,
    seconds:       parseInt(inputSeconds.value) || 600,
    randomMin:     minVal,
    randomMax:     maxVal,
    sendMode:      toggleCommitment.checked ? 'commitmentIssues' : 'standard',
    blindfolded:   toggleBlindfold.checked,
    tardis:        toggleTardis.checked,
    spinTheWheel:  toggleSpin.checked,
    lastMinute:    toggleLastminute.checked,
    roulette:      toggleRoulette.checked,
    brokenUI:      toggleBrokenui.checked,
    rosettaStone:  toggleRosetta.checked,
    braveMetadata: toggleBrave.checked,
    peekLimit:     (toggleBlindfold.checked && togglePeekLimit.checked)
                     ? Math.max(1, parseInt(inputPeekLimit.value) || 3)
                     : null,
  });

  gameState.begin();

  // Roulette: 10% instant send before anything else
  if (gameState.roulette && Math.random() < 0.1) {
    gameState.log.rouletteTriggered = true;
    await doSend('roulette');
    return;
  }

  // Commitment Issues: schedule immediately, show fake countdown
  if (gameState.sendMode === 'commitmentIssues') {
    await doSend('commitment');
    // Fall through — dialog shows fake timer
  }

  openTimerDialog();
}

// ── Schedule the actual send ──────────────────────────────────────────────────

async function doSend(trigger) {
  const braveMetadata = gameState.braveMetadata ? gatherBraveMetadata() : null;
  if (braveMetadata) gameState.log.braveMetadata = braveMetadata;
  if (trigger !== 'commitment') gameState.recordSend();

  try {
    const result = await scheduleAndSend(gameState, braveMetadata);
    pendingSendAt   = result.sendAt;
    pendingReplayer = result.speedReplayer;  // null unless TARDIS
  } catch (err) {
    console.error('scheduleAndSend failed:', err);
  }

  if (trigger === 'commitment') return;
  showSendScheduled(trigger);
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function openTimerDialog() {
  // Serialise settings into URL params for the dialog
  const params = new URLSearchParams({
    seconds:      gameState.rawSeconds,
    timerMode:    gameState.timerMode,
    sendMode:     gameState.sendMode,
    blindfolded:  gameState.blindfolded,
    lastMinute:   gameState.lastMinute,
    brokenUI:     gameState.brokenUI,
    rosettaStone: gameState.rosettaStone,
    roulette:     gameState.roulette,
    spinTheWheel: gameState.spinTheWheel,
    peekLimit:    gameState.peekLimit !== null ? gameState.peekLimit : '',
    // For TARDIS: pass the pre-computed schedule so the dialog can replay it
    hasTardisSchedule: !!pendingReplayer,
  });

  // If we have a TARDIS schedule, store it on window so the dialog can fetch it
  // via messageParent/message exchange. We pass a compact JSON of the segments.
  if (pendingReplayer && gameState._tardisScheduleForDialog) {
    params.set('tardisSegmentsJson',
      encodeURIComponent(JSON.stringify(gameState._tardisScheduleForDialog)));
  }

  // Build the dialog URL relative to the current page's location.
  // window.location.origin alone gives https://miscy101.github.io — missing
  // the /mailtimer/ repository prefix that GitHub Pages requires.
  // We derive the base path from the current URL instead, stripping everything
  // from /outlook/ onward to get https://miscy101.github.io/mailtimer
  const basePath = window.location.href.split('/outlook/')[0];
  const dialogUrl = basePath + '/outlook/dialog/dialog.html?' + params.toString();

  Office.context.ui.displayDialogAsync(dialogUrl,
    { height: 55, width: 38, displayInIframe: false },
    result => {
      if (result.status === Office.AsyncResultStatus.Failed) {
        console.error('Dialog failed to open:', result.error.message);
        return;
      }
      dialog = result.value;

      dialog.addEventHandler(Office.EventType.DialogMessageReceived, onDialogMessage);
      dialog.addEventHandler(Office.EventType.DialogEventReceived, event => {
        // 12006 = user closed dialog
        if (event.error === 12006) {
          onDialogCancelled();
        }
      });
    }
  );
}

async function onDialogMessage(arg) {
  let msg;
  try { msg = JSON.parse(arg.message); } catch { return; }

  switch (msg.type) {
    case 'PEEK':          gameState.recordPeek(); break;
    case 'PAUSE':         gameState.recordPause(); break;

    case 'CANCEL':
      if (dialog) { dialog.close(); dialog = null; }
      await onDialogCancelled();
      break;

    case 'TIMER_COMPLETE':
      // Timer display hit zero — the server send is already scheduled.
      // We just show the outcome.
      if (dialog) { dialog.close(); dialog = null; }
      showSendScheduled('timer');
      break;

    case 'SPIN_BLOCKED':
      // Spin the Wheel said no — cancel the scheduled send
      gameState.recordSpinOutcome(false);
      if (dialog) { dialog.close(); dialog = null; }
      await attemptCancel();
      showTaskpaneOutcome('spin-blocked');
      break;

    case 'ROULETTE_FIRED':
      gameState.log.rouletteTriggered = true;
      if (dialog) { dialog.close(); dialog = null; }
      // Send is already scheduled from when Start was clicked (for roulette,
      // we called doSend early). Just show outcome.
      showSendScheduled('roulette');
      break;
  }
}

async function onDialogCancelled() {
  gameState.recordCancel();
  await attemptCancel();
  showTaskpaneOutcome('cancelled');
}

// ── Cancel ────────────────────────────────────────────────────────────────────

async function attemptCancel() {
  const result = await cancelScheduledSend();
  if (!result.cancelled) {
    console.warn('Cancel failed:', result.reason);
    // Show a secondary warning that the user should check Drafts
    const notice = document.querySelector('.outlook-notice');
    if (notice) {
      notice.style.borderColor = '#e04848';
      notice.style.background  = '#fff0f0';
      notice.style.color       = '#a03030';
      notice.querySelector('.outlook-notice-title').textContent =
        '⚠ Please check your Drafts folder';
      notice.querySelector('p').textContent =
        'Mailtimer could not automatically cancel the scheduled send. ' +
        'Please go to your Drafts folder and delete the email manually.';
    }
  }
}

// ── Outcome / send-ready display ──────────────────────────────────────────────

function showSendScheduled(trigger) {
  // Hide setup, show send-ready block
  document.querySelector('.col-left').style.opacity = '0.4';
  document.querySelector('.col-left').style.pointerEvents = 'none';
  document.querySelector('.taskpane-controls').style.display = 'none';
  sendReadyBlock.classList.remove('hidden');

  const notice = sendReadyBlock.querySelector('.send-ready-notice');

  if (trigger === 'commitment') {
    notice.textContent = 'Hahaha!\nOops, looks like you lost the game...\nYour information has been sent!';
  } else if (trigger === 'roulette') {
    notice.textContent = 'Roulette fired.\nHahaha!\nYour information has been sent!';
  } else {
    const when = pendingSendAt
      ? `Scheduled for: ${pendingSendAt.toLocaleTimeString()}`
      : 'Your email is scheduled.';
    notice.textContent = `Hahaha!\nOops, looks like you lost the game...\nYour information has been sent!\n\n${when}`;
  }

  notice.style.whiteSpace = 'pre-line';
  btnSendNow.classList.add('hidden');
}

function showTaskpaneOutcome(type) {
  document.querySelector('.col-left').style.opacity = '0.4';
  document.querySelector('.col-left').style.pointerEvents = 'none';
  document.querySelector('.taskpane-controls').style.display = 'none';
  sendReadyBlock.classList.remove('hidden');

  const notice = sendReadyBlock.querySelector('.send-ready-notice');
  const messages = {
    'spin-blocked': 'The wheel said no.\nYou made it to zero — but the wheel didn\'t send it.',
    'cancelled':    'Timer cancelled.\n\nYour email has been moved to a future send time. Check your Drafts folder to confirm it was cancelled.',
  };
  notice.textContent = messages[type] || 'Session ended.';
  notice.style.whiteSpace = 'pre-line';
  notice.style.background = '#f5f5f5';
  notice.style.borderColor = '#ccc';
  notice.style.color = '#555';
  btnSendNow.classList.add('hidden');
}

async function onSendNow() {
  // Fallback: save draft so the user can review it
  try {
    await new Promise(resolve => {
      Office.context.mailbox.item.saveAsync(resolve);
    });
  } catch {}
  btnSendNow.textContent = 'Done';
  btnSendNow.disabled = true;
}

// ── Brave metadata ────────────────────────────────────────────────────────────

function gatherBraveMetadata() {
  const now    = new Date();
  const tz     = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const locale = navigator.language || 'unknown';
  return {
    'sent-at':         now.toISOString(),
    'local-time':      now.toLocaleString(locale, { timeZoneName: 'long' }),
    'timezone':        tz,
    'region-guess':    guessRegionFromTZ(tz),
    'locale':          locale,
    'platform':        navigator.platform || 'unknown',
    'elapsed-seconds': gameState.log.startedAt
      ? Math.round((Date.now() - new Date(gameState.log.startedAt)) / 1000)
      : '?',
  };
}

function guessRegionFromTZ(tz) {
  const map = {
    'Australia': 'Australia / Pacific', 'Pacific': 'Pacific',
    'America':   'Americas',            'Europe':  'Europe / Africa',
    'Asia':      'Asia',                'Africa':  'Europe / Africa',
    'Atlantic':  'Atlantic',            'Indian':  'Indian Ocean',
    'Arctic':    'Arctic',              'Antarctica': 'Antarctica',
  };
  return map[(tz || '').split('/')[0]] || tz;
}
