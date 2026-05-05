/**
 * popup.js — Thunderbird compose popup
 *
 * Responsibilities:
 *  - Read compose window fields via browser.compose API
 *  - Wire all toggles/inputs to GameState options
 *  - Drive the timer via MailTimer
 *  - Update the UI on every tick
 *  - Send via browser.compose.sendMessage on completion
 *  - Handle chaos modes: Roulette, Commitment Issues, Bricked UI, Rosetta Stone
 */

import { MailTimer }  from '../core/timer.js';
import { GameState }  from '../core/gameState.js';
import { buildEmail } from '../core/emailData.js';
import {
  timerDisplay, buttonStates, spinTheWheel,
  buildRosettaTable, applySubstitution, disclaimerText,
} from '../core/ui.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  setup:   $('screen-setup'),
  running: $('screen-running'),
  outcome: $('screen-outcome'),
};

// Setup controls
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
const consentText      = $('consent-text');
const btnStart         = $('btn-start');
const warnNoTo         = $('warn-no-to');
const displaySetup     = $('display-setup');

// Running controls
const displayRunning    = $('display-running');
const speedIndicator    = $('speed-indicator');
const btnPause          = $('btn-pause');
const btnCancel         = $('btn-cancel');
const btnPeek           = $('btn-peek');
const btnBlindfoldLive  = $('btn-blindfold-live');
const btnRouletteLive   = $('btn-roulette-live');
const btnSendNowLive    = $('btn-send-now-live');
const runModeLabel      = $('run-mode-label');
const runFlags          = $('run-flags');

// Outcome
const outcomeIcon   = $('outcome-icon');
const outcomeTitle  = $('outcome-title');
const outcomeDetail = $('outcome-detail');
const btnReset      = $('btn-reset');

// ── Resolve compose tab ID from URL param ─────────────────────────────────────

const urlParams    = new URLSearchParams(window.location.search);
const composeTabId = urlParams.has('composeTabId')
  ? parseInt(urlParams.get('composeTabId'))
  : null;

// ── Session state ─────────────────────────────────────────────────────────────

let gameState    = null;
let timer        = null;
let brickTimeout = null;
let peekTimeout  = null;
let isPeeking    = false;

// ── Screen switching ──────────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Setup screen wiring ───────────────────────────────────────────────────────

// Random timer toggle — auto-ticks blindfold as a default
toggleRandom.addEventListener('change', () => {
  timerFixed.classList.toggle('hidden', toggleRandom.checked);
  timerRandom.classList.toggle('hidden', !toggleRandom.checked);
  toggleBlindfold.checked = toggleRandom.checked;
  peekLimitBlock.classList.toggle('hidden', !toggleBlindfold.checked);
  updateSetupDisplay();
});

// Blindfold toggle: show/hide peek limit block
toggleBlindfold.addEventListener('change', () => {
  peekLimitBlock.classList.toggle('hidden', !toggleBlindfold.checked);
  if (!toggleBlindfold.checked) {
    togglePeekLimit.checked = false;
    peekLimitInputRow.classList.add('hidden');
  }
});

// Peek limit checkbox: show/hide the number input
togglePeekLimit.addEventListener('change', () => {
  peekLimitInputRow.classList.toggle('hidden', !togglePeekLimit.checked);
});

inputSeconds.addEventListener('input', updateSetupDisplay);
inputMin.addEventListener('input', updateSetupDisplay);
inputMax.addEventListener('input', updateSetupDisplay);

function updateSetupDisplay() {
  if (toggleRandom.checked) {
    displaySetup.textContent = '???';
  } else {
    const s = Math.max(1, parseInt(inputSeconds.value) || 600);
    displaySetup.textContent = String(s);
  }
}

// ── Start button gating ───────────────────────────────────────────────────────

let cachedToAddress = '';

async function refreshToField() {
  const details = await getComposeDetails();
  cachedToAddress = details.to || '';
  updateStartButton();
}

function updateStartButton() {
  const hasConsent = consentCheckbox.checked;
  const hasTo      = cachedToAddress.includes('@');
  btnStart.disabled = !(hasConsent && hasTo);
  warnNoTo.classList.toggle('hidden', !(hasConsent && !hasTo));

  // Highlight consent block in red when Start is blocked solely because
  // consent hasn't been ticked — gives the player a clear visual cue
  const consentBlock = document.querySelector('.consent-block');
  if (consentBlock) {
    consentBlock.classList.toggle('consent-required', !hasConsent);
  }
}

consentCheckbox.addEventListener('change', updateStartButton);

let toFieldPollInterval = null;

function startToFieldPolling() {
  refreshToField();
  toFieldPollInterval = setInterval(refreshToField, 2000);
}

function stopToFieldPolling() {
  clearInterval(toFieldPollInterval);
  toFieldPollInterval = null;
}

// ── Start ─────────────────────────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  stopToFieldPolling();

  let minVal = parseInt(inputMin.value) || 60;
  let maxVal = parseInt(inputMax.value) || 600;
  if (minVal > maxVal) { [minVal, maxVal] = [maxVal, minVal]; }

  const timerMode = toggleTardis.checked ? 'tardis'
                  : toggleRandom.checked  ? 'random'
                  : 'fixed';

  const composeDetails = await getComposeDetails();

  gameState = new GameState({
    to:      composeDetails.to,
    subject: composeDetails.subject,
    body:    composeDetails.body,

    timerMode,
    seconds:   parseInt(inputSeconds.value) || 600,
    randomMin: minVal,
    randomMax: maxVal,

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

  // Roulette: 10% chance of instant send before timer even starts
  if (gameState.roulette && Math.random() < 0.1) {
    gameState.log.rouletteTriggered = true;
    await doSend('roulette');
    return;
  }

  // Commitment Issues: send NOW, then show fake countdown
  if (gameState.sendMode === 'commitmentIssues') {
    await doSend('commitment');
    // Fall through — fake running screen still shows
  }

  startRunningScreen();
});

// ── Running screen ─────────────────────────────────────────────────────────────

function startRunningScreen() {
  showScreen('running');

  const { lastMinute } = gameState;
  let brokenUIActive = false;

  // Rosetta Stone: build substitution table once, apply to all labels immediately
  const rosettaTable = gameState.rosettaStone ? buildRosettaTable() : null;

  if (rosettaTable) {
    btnPause.textContent         = applySubstitution('Pause',     rosettaTable);
    btnCancel.textContent        = applySubstitution('Cancel',    rosettaTable);
    btnBlindfoldLive.textContent = applySubstitution('Blindfold', rosettaTable);
    btnRouletteLive.textContent  = applySubstitution('Roulette',  rosettaTable);
    btnSendNowLive.textContent   = applySubstitution('Send now',  rosettaTable);
    $('roulette-live-desc').textContent =
      applySubstitution("(A chance it'll send now.)", rosettaTable);
  }

  // Send now is always visible during the countdown
  btnSendNowLive.classList.remove('hidden');

  populateRunFlags(rosettaTable);

  // Bricked UI: arm a silent random timer that fires at some point during the run
  if (gameState.brokenUI) {
    const brickDelay = Math.random() * gameState.rawSeconds * 1000;
    brickTimeout = setTimeout(() => {
      brokenUIActive = true;
      gameState._brokenUIActive = true;
    }, brickDelay);
  }

  timer = new MailTimer({
    seconds: gameState.rawSeconds,
    mode:    gameState.timerMode === 'tardis' ? 'tardis' : 'fixed',
    onTick:  ({ secondsLeft }) => {
      displayRunning.textContent = timerDisplay(secondsLeft, {
        blindfolded: gameState.blindfolded,
        peeking:     isPeeking,
        rosettaTable,
      });

      const state = buttonStates({
        running:        true,
        paused:         timer.isPaused,
        secondsLeft,
        brokenUI:       brokenUIActive,
        rosettaTable,
        lastMinute,
        blindfolded:    gameState.blindfolded,
        peeksRemaining: gameState.peeksRemaining,
      });

      applyButtonState(btnPause,  state.pause);
      applyButtonState(btnCancel, state.cancel);
      applyButtonState(btnPeek,   state.peek);

      // Show exhausted message when limit is set and peeks are gone
      const exhausted = gameState.peekLimit !== null && gameState.peeksRemaining === 0;
      $('peek-exhausted-msg').classList.toggle('hidden', !exhausted);

      btnBlindfoldLive.classList.toggle('hidden', gameState.blindfolded);
      btnRouletteLive.classList.remove('hidden');
      $('roulette-live-desc').classList.remove('hidden');
    },
    onComplete: async () => {
      clearTimeout(brickTimeout);

      if (gameState.sendMode === 'commitmentIssues') {
        showOutcome('sent-fake');
        return;
      }

      if (gameState.spinTheWheel) {
        const willSend = spinTheWheel();
        gameState.recordSpinOutcome(willSend);
        if (!willSend) {
          showOutcome('spin-blocked');
          return;
        }
      }

      await doSend('timer');
    },
    onCancel: () => {
      clearTimeout(brickTimeout);
      gameState.recordCancel();
      showOutcome('cancelled');
    },
  });

  timer.start();
}

function applyButtonState(btn, state) {
  if (!state) return;
  btn.classList.toggle('hidden', !state.visible);
  btn.disabled = !state.enabled;
  if (state.label) btn.textContent = state.label;
}

function populateRunFlags(rosettaTable) {
  const labels = [];
  if (gameState.timerMode === 'tardis') labels.push('TARDIS');
  if (gameState.timerMode === 'random') labels.push('Random timer');
  if (gameState.spinTheWheel)           labels.push('Spin the wheel');
  if (gameState.lastMinute)             labels.push('Last minute');
  if (gameState.roulette)               labels.push('Roulette');
  if (gameState.brokenUI)               labels.push('Bricked UI');
  if (gameState.rosettaStone)           labels.push('Rosetta stone');
  if (gameState.sendMode === 'commitmentIssues') labels.push('Commitment issues');
  if (gameState.blindfolded)            labels.push('Blindfolded');

  runModeLabel.textContent = 'Active modes';
  runFlags.innerHTML = labels.map(l => {
    const text = rosettaTable ? applySubstitution(l, rosettaTable) : l;
    return `<span class="run-flag">${text}</span>`;
  }).join('');
}

// ── Running screen buttons ─────────────────────────────────────────────────────

btnPause.addEventListener('click', () => {
  if (!timer || gameState._brokenUIActive) return;
  if (timer.isPaused) {
    timer.resume();
  } else {
    timer.pause();
    gameState.recordPause();
  }
});

btnCancel.addEventListener('click', () => {
  if (!timer || gameState._brokenUIActive) return;
  timer.cancel();
});

btnPeek.addEventListener('click', () => {
  if (!gameState.blindfolded || !gameState.canPeek) return;
  gameState.recordPeek();
  isPeeking = true;
  clearTimeout(peekTimeout);
  peekTimeout = setTimeout(() => { isPeeking = false; }, 250);
});

// Send now — fires the send immediately, same as timer reaching zero
btnSendNowLive.addEventListener('click', async () => {
  if (!timer || !gameState) return;
  // Stop the timer cleanly without triggering onCancel
  clearInterval(timer._intervalId);
  timer._intervalId = null;
  // Honour Spin the Wheel even on manual send
  if (gameState.spinTheWheel) {
    const willSend = spinTheWheel();
    gameState.recordSpinOutcome(willSend);
    if (!willSend) {
      showOutcome('spin-blocked');
      return;
    }
  }
  clearTimeout(brickTimeout);
  await doSend('timer');
});

btnBlindfoldLive.addEventListener('click', () => {
  if (gameState.blindfolded) return;
  gameState.blindfolded = true;
  gameState.log.blindfoldedMidRun = true;
  btnBlindfoldLive.classList.add('hidden');
  btnPeek.classList.remove('hidden');
});

btnRouletteLive.addEventListener('click', async () => {
  if (!timer || !gameState) return;
  if (Math.random() < 0.1) {
    clearInterval(timer._intervalId);
    timer._intervalId = null;
    gameState.log.rouletteTriggered = true;
    await doSend('roulette');
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

// ── Send ──────────────────────────────────────────────────────────────────────

async function doSend(trigger) {
  const braveMetadata = gameState.braveMetadata ? gatherBraveMetadata() : null;
  if (braveMetadata) gameState.log.braveMetadata = braveMetadata;

  gameState.recordSend();

  const email = buildEmail(gameState, braveMetadata);

  if (typeof browser !== 'undefined' && browser.compose && composeTabId !== null) {
    try {
      const subject = email.subject.trim()
        ? `Mailtimer Game: ${email.subject}`
        : 'Mailtimer Game';

      await browser.compose.setComposeDetails(composeTabId, {
        to:      [email.to],
        subject,
        body:    email.body,
      });
      await browser.compose.sendMessage(composeTabId);

      // Snap focus back to our window after Thunderbird briefly steals it
      const ourWindow = await browser.windows.getCurrent();
      await browser.windows.update(ourWindow.id, { focused: true });
    } catch (err) {
      console.error('Mailtimer send error:', err);
    }
  }

  if (trigger === 'commitment') return;
  showOutcome('sent');
}

// ── Outcome screen ─────────────────────────────────────────────────────────────

function showOutcome(type) {
  showScreen('outcome');

  const statsLine = buildStatsLine();

  const outcomes = {
    'sent': {
      icon:   '✉',
      title:  'Hahaha!',
      detail: `Oops, looks like the timer ran out.\nDid you lose the game? Has your information been sent?\n\n${statsLine}`,
    },
    'sent-fake': {
      icon:   '✉',
      title:  'Hahaha!',
      detail: 'Oops, looks like the timer ran out.\nDid you lose the game? Has your information been sent?\n\n(It was sent the moment you clicked Start. You followed through.)',
    },
    'roulette': {
      icon:   '🎰',
      title:  'Hahaha!',
      detail: `Oops, looks like the timer ran out.\nDid you lose the game? Has your information been sent?\n\n(Roulette fired on Start.)\n\n${statsLine}`,
    },
    'spin-blocked': {
      icon:   '🎲',
      title:  'The wheel said no.',
      detail: "You made it to zero — but the wheel didn't send it. Better luck next time.",
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

function buildStatsLine() {
  const log   = gameState.log;
  const parts = [];
  if (log.peekCount > 0)     parts.push(`${log.peekCount} peek${log.peekCount > 1 ? 's' : ''}`);
  if (log.pauseCount > 0)    parts.push(`${log.pauseCount} pause${log.pauseCount > 1 ? 's' : ''}`);
  if (log.blindfoldedStart)  parts.push('started blindfolded');
  if (log.blindfoldedMidRun) parts.push('blindfolded mid-run');
  return parts.length ? `Stats: ${parts.join(', ')}.` : 'Clean run.';
}

btnReset.addEventListener('click', () => { window.close(); });

// ── Brave metadata ─────────────────────────────────────────────────────────────

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
  if (!tz) return 'unknown';
  const map = {
    'Australia': 'Australia / Pacific', 'Pacific':    'Pacific',
    'America':   'Americas',            'Europe':     'Europe / Africa',
    'Asia':      'Asia',                'Africa':     'Europe / Africa',
    'Atlantic':  'Atlantic',            'Indian':     'Indian Ocean',
    'Arctic':    'Arctic',              'Antarctica': 'Antarctica',
  };
  return map[tz.split('/')[0]] || tz;
}

// ── Thunderbird compose API helper ────────────────────────────────────────────

async function getComposeDetails() {
  if (typeof browser !== 'undefined' && browser.compose && composeTabId !== null) {
    try {
      const details = await browser.compose.getComposeDetails(composeTabId);
      return {
        to:      details.to?.[0] || '',
        subject: details.subject || '',
        body:    details.plainTextBody || details.body || '',
      };
    } catch (err) {
      console.warn('Could not read compose details:', err);
    }
  }
  return { to: 'test@example.com', subject: 'Test', body: 'Hello.' };
}

// ── Init ──────────────────────────────────────────────────────────────────────

updateSetupDisplay();
startToFieldPolling();
