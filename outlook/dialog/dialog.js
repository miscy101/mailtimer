/**
 * dialog.js — Outlook timer dialog controller
 *
 * This runs inside the Office dialog window opened by taskpane.js.
 * It owns the live countdown, all mode visuals, and sends messages
 * back to the task pane via Office.context.ui.messageParent().
 *
 * Settings are received via URL parameters (serialised by taskpane.js).
 * The dialog has no access to the compose item — all compose operations
 * happen in the task pane on receipt of messages from here.
 *
 * Message protocol (dialog → task pane):
 *   { type: 'PEEK' }
 *   { type: 'PAUSE' }
 *   { type: 'CANCEL' }
 *   { type: 'TIMER_COMPLETE' }
 *   { type: 'SPIN_BLOCKED' }
 *   { type: 'ROULETTE_FIRED' }
 */

import { MailTimer } from '../../core/timer.js';
import {
  timerDisplay, buttonStates, spinTheWheel,
  buildRosettaTable, applySubstitution,
} from '../../core/ui.js';

// ── Read settings from URL params ─────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);

const settings = {
  seconds:      parseInt(params.get('seconds'))    || 600,
  timerMode:    params.get('timerMode')             || 'fixed',
  sendMode:     params.get('sendMode')              || 'standard',
  blindfolded:  params.get('blindfolded')  === 'true',
  lastMinute:   params.get('lastMinute')   === 'true',
  brokenUI:     params.get('brokenUI')     === 'true',
  rosettaStone: params.get('rosettaStone') === 'true',
  roulette:     params.get('roulette')     === 'true',
  spinTheWheel: params.get('spinTheWheel') === 'true',
  peekLimit:    params.get('peekLimit') ? parseInt(params.get('peekLimit')) : null,
};

// Track peeks remaining locally in the dialog
let peeksRemaining = settings.peekLimit !== null ? settings.peekLimit : Infinity;

// TARDIS: reconstruct speed replayer from pre-computed schedule if provided
let tardisReplayer = null;
const hasTardisSchedule = params.get('hasTardisSchedule') === 'true';
if (hasTardisSchedule) {
  const raw = params.get('tardisSegmentsJson');
  if (raw) {
    try {
      const schedule = JSON.parse(decodeURIComponent(raw));
      // Dynamically import the replayer factory
      const { makeScheduleReplayer } = await import('../../core/tardisSchedule.js');
      tardisReplayer = makeScheduleReplayer(schedule);
    } catch (err) {
      console.warn('Could not parse TARDIS schedule:', err);
    }
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  running: $('screen-running'),
  outcome: $('screen-outcome'),
};

const displayRunning   = $('display-running');
const btnPause         = $('btn-pause');
const btnCancel        = $('btn-cancel');
const btnPeek          = $('btn-peek');
const btnBlindfoldLive = $('btn-blindfold-live');
const btnRouletteLive  = $('btn-roulette-live');
const runModeLabel     = $('run-mode-label');
const runFlags         = $('run-flags');
const outcomeIcon      = $('outcome-icon');
const outcomeTitle     = $('outcome-title');
const outcomeDetail    = $('outcome-detail');
const btnReset         = $('btn-reset');

// ── Local session state ───────────────────────────────────────────────────────

let timer        = null;
let brickTimeout = null;
let peekTimeout  = null;
let isPeeking    = false;
let isBlindfolded = settings.blindfolded;
let brokenUIActive = false;

// ── Message helper ────────────────────────────────────────────────────────────

function send(type, payload = {}) {
  // Office.context.ui.messageParent() sends a string to the task pane.
  // Must be called in the dialog context.
  Office.context.ui.messageParent(JSON.stringify({ type, ...payload }));
}

// ── Screen switching ──────────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Start timer on load ───────────────────────────────────────────────────────

Office.onReady(() => {
  startTimer();
});

function startTimer() {
  const rosettaTable = settings.rosettaStone ? buildRosettaTable() : null;

  // Apply Rosetta Stone labels immediately
  if (rosettaTable) {
    btnPause.textContent         = applySubstitution('Pause',     rosettaTable);
    btnCancel.textContent        = applySubstitution('Cancel',    rosettaTable);
    btnBlindfoldLive.textContent = applySubstitution('Blindfold', rosettaTable);
    btnRouletteLive.textContent  = applySubstitution('Roulette',  rosettaTable);
    $('roulette-live-desc').textContent =
      applySubstitution("A chance it'll send now.", rosettaTable);
  }

  populateRunFlags(rosettaTable);

  // Bricked UI: silent random timeout
  if (settings.brokenUI) {
    const delay = Math.random() * settings.seconds * 1000;
    brickTimeout = setTimeout(() => {
      brokenUIActive = true;
    }, delay);
  }

  timer = new MailTimer({
    seconds:       settings.seconds,
    mode:          settings.timerMode === 'tardis' ? 'tardis' : 'fixed',
    speedReplayer: tardisReplayer,  // null for Thunderbird/non-TARDIS; pre-computed for Outlook TARDIS
    onTick:  ({ secondsLeft }) => {
      displayRunning.textContent = timerDisplay(secondsLeft, {
        blindfolded: isBlindfolded,
        peeking:     isPeeking,
        rosettaTable,
      });

      const state = buttonStates({
        running:        true,
        paused:         timer.isPaused,
        secondsLeft,
        brokenUI:       brokenUIActive,
        rosettaTable,
        lastMinute:     settings.lastMinute,
        blindfolded:    isBlindfolded,
        peeksRemaining,
      });

      applyButtonState(btnPause,  state.pause);
      applyButtonState(btnCancel, state.cancel);
      applyButtonState(btnPeek,   state.peek);

      const exhausted = settings.peekLimit !== null && peeksRemaining === 0;
      $('peek-exhausted-msg').classList.toggle('hidden', !exhausted);

      btnBlindfoldLive.classList.toggle('hidden', isBlindfolded);
      btnRouletteLive.classList.remove('hidden');
      $('roulette-live-desc').classList.remove('hidden');
    },
    onComplete: () => {
      clearTimeout(brickTimeout);

      if (settings.sendMode === 'commitmentIssues') {
        // Email already sent — show fake outcome
        showOutcome('sent-fake');
        return;
      }

      if (settings.spinTheWheel) {
        const willSend = spinTheWheel();
        if (!willSend) {
          send('SPIN_BLOCKED');
          showOutcome('spin-blocked');
          return;
        }
      }

      send('TIMER_COMPLETE');
      showOutcome('sent');
    },
    onCancel: () => {
      clearTimeout(brickTimeout);
      send('CANCEL');
      showOutcome('cancelled');
    },
  });

  timer.start();
}

// ── Button state helper ───────────────────────────────────────────────────────

function applyButtonState(btn, state) {
  if (!state) return;
  btn.classList.toggle('hidden', !state.visible);
  btn.disabled = !state.enabled;
  if (state.label) btn.textContent = state.label;
}

// ── Run flags ─────────────────────────────────────────────────────────────────

function populateRunFlags(rosettaTable) {
  const labels = [];
  if (settings.timerMode === 'tardis')               labels.push('TARDIS');
  if (settings.timerMode === 'random')               labels.push('Random timer');
  if (settings.spinTheWheel)                         labels.push('Spin the wheel');
  if (settings.lastMinute)                           labels.push('Last minute');
  if (settings.roulette)                             labels.push('Roulette');
  if (settings.brokenUI)                             labels.push('Bricked UI');
  if (settings.rosettaStone)                         labels.push('Rosetta stone');
  if (settings.sendMode === 'commitmentIssues')      labels.push('Commitment issues');
  if (isBlindfolded)                                 labels.push('Blindfolded');

  runModeLabel.textContent = 'Active modes';
  runFlags.innerHTML = labels.map(l => {
    const text = rosettaTable ? applySubstitution(l, rosettaTable) : l;
    return `<span class="run-flag">${text}</span>`;
  }).join('');
}

// ── Button handlers ───────────────────────────────────────────────────────────

btnPause.addEventListener('click', () => {
  if (brokenUIActive) return;
  if (timer.isPaused) {
    timer.resume();
  } else {
    timer.pause();
    send('PAUSE');
  }
});

btnCancel.addEventListener('click', () => {
  if (brokenUIActive) return;
  timer.cancel();
});

btnPeek.addEventListener('click', () => {
  if (!isBlindfolded || peeksRemaining <= 0) return;
  send('PEEK');
  if (peeksRemaining !== Infinity) peeksRemaining--;
  isPeeking = true;
  clearTimeout(peekTimeout);
  peekTimeout = setTimeout(() => { isPeeking = false; }, 1000);
});

btnBlindfoldLive.addEventListener('click', () => {
  if (isBlindfolded) return;
  isBlindfolded = true;
  btnBlindfoldLive.classList.add('hidden');
  btnPeek.classList.remove('hidden');
});

btnRouletteLive.addEventListener('click', () => {
  if (Math.random() < 0.1) {
    clearInterval(timer._intervalId);
    timer._intervalId = null;
    send('ROULETTE_FIRED');
    showOutcome('roulette');
  } else {
    const original = btnRouletteLive.textContent;
    btnRouletteLive.textContent = '...no.';
    btnRouletteLive.disabled = true;
    setTimeout(() => {
      btnRouletteLive.textContent = original;
      btnRouletteLive.disabled = false;
    }, 1200);
  }
});

// ── Outcome ───────────────────────────────────────────────────────────────────

function showOutcome(type) {
  showScreen('outcome');

  const outcomes = {
    'sent': {
      icon:   '✉',
      title:  'Hahaha!',
      detail: 'Oops, looks like you lost the game...\nYour information has been sent!',
    },
    'sent-fake': {
      icon:   '✉',
      title:  'Hahaha!',
      detail: 'Oops, looks like you lost the game...\nYour information has been sent!\n\n(It was sent the moment you clicked Start.)',
    },
    'roulette': {
      icon:   '🎰',
      title:  'Hahaha!',
      detail: 'Oops, looks like you lost the game...\nYour information has been sent!\n\n(The roulette fired.)',
    },
    'spin-blocked': {
      icon:   '🎲',
      title:  'The wheel said no.',
      detail: "You made it to zero — but the wheel didn't send it.",
    },
    'cancelled': {
      icon:   '✕',
      title:  'Timer cancelled.',
      detail: 'The email was not sent.',
    },
  };

  const o = outcomes[type] || outcomes['cancelled'];
  outcomeIcon.textContent   = o.icon;
  outcomeTitle.textContent  = o.title;
  outcomeDetail.textContent = o.detail;
}

// Closing the dialog from the outcome screen is fine — task pane is still open
btnReset.addEventListener('click', () => {
  Office.context.ui.messageParent(JSON.stringify({ type: 'DIALOG_CLOSED' }));
});
