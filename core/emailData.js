/**
 * emailData.js — assembles the final email from GameState
 *
 * buildEmail() returns an object with both HTML and plain-text body versions.
 * The caller passes both to setComposeDetails so Thunderbird picks the right
 * one based on the compose window's mode.
 *
 * metadataMode controls what gets appended:
 *   'none'  — email body is unchanged
 *   'log'   — game log appended (default)
 *   'extra' — game log + brave metadata appended
 */

export function buildEmail(gameState, braveMetadata = null) {
  const mode = gameState.metadataMode || 'log';

  const gameLogText  = mode !== 'none' ? gameState.formatLog()             : '';
  const braveLogText = mode === 'extra' && braveMetadata
    ? formatBraveMetadata(braveMetadata)
    : '';

  // Plain text version — pipe-separated, no line breaks required
  const plainBody = gameState.body + gameLogText + braveLogText;

  // HTML version — uses <br> for line breaks so formatting survives HTML compose mode.
  // We read the original body as plain text and convert newlines to <br>.
  // The appended log is wrapped in a <div> so it's visually separated.
  const originalHtml = gameState.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const logHtml = mode !== 'none'
    ? formatLogHtml(gameState, mode === 'extra' ? braveMetadata : null)
    : '';

  const htmlBody = originalHtml + logHtml;

  return {
    to:           gameState.to,
    subject:      gameState.subject,
    body:         htmlBody,      // HTML version for HTML compose windows
    plainTextBody: plainBody,    // plain text fallback
  };
}

/**
 * Formats the game log as an HTML block for appending to an HTML email body.
 * Mirrors the plain-language structure of formatLog() in gameState.js.
 */
function formatLogHtml(gameState, braveMetadata = null) {
  const l = gameState;
  const log = gameState.log;
  const p = (text) => `<p style="margin:4px 0;line-height:1.5;">${text}</p>`;
  const grey = (text) => `<span style="color:#888;">${text}</span>`;

  const paragraphs = [];

  // ── Timer description ──
  if (l.timerMode === 'random') {
    const range = l.randomMin && l.randomMax
      ? ` ${grey(`(parameters set by the user: between ${l.randomMin} and ${l.randomMax} seconds)`)}`
      : '';
    paragraphs.push(p(
      `This Mailtimer game was played with a random countdown timer of <strong>${l.rawSeconds} seconds</strong>.${range}`
    ));
  } else {
    paragraphs.push(p(
      `This Mailtimer game was played with a user set countdown time of <strong>${l.rawSeconds} seconds</strong>.`
    ));
  }

  // ── TARDIS wall-clock time ──
  if (log.tardisUsed) {
    const wallSecs = log.startedAt && log.completedAt
      ? Math.round((new Date(log.completedAt) - new Date(log.startedAt)) / 1000)
      : null;
    paragraphs.push(p(
      `The actual total countdown time lasted for <strong>${wallSecs !== null ? wallSecs : '?'} seconds</strong>` +
      ` due to a fold in space-time — TARDIS mode was active.`
    ));
  }

  // ── Active modifiers ──
  const modifiers = [];
  if (log.spinOutcome !== null)     modifiers.push('Spin the wheel');
  if (l.lastMinute)                 modifiers.push('Last minute');
  if (log.rouletteTriggered)        modifiers.push('Roulette');
  if (log.brokenUIUsed)             modifiers.push('Unstable UI');
  if (log.rosettaStoneUsed)         modifiers.push('Babel');
  if (l.sendMode === 'commitmentIssues') modifiers.push('Commitment issues');

  if (modifiers.length === 0) {
    paragraphs.push(p('They selected no modifiers.'));
  } else {
    const listed = modifiers.length === 1
      ? modifiers[0]
      : modifiers.slice(0, -1).join(', ') + ' and ' + modifiers[modifiers.length - 1];
    paragraphs.push(p(
      `They selected the following modifier${modifiers.length > 1 ? 's' : ''}: <strong>${listed}</strong>.`
    ));
  }

  // ── Spin outcome ──
  if (log.spinOutcome) {
    paragraphs.push(p(`Spin the wheel result: ${grey(log.spinOutcome)}.`));
  }

  // ── Pauses ──
  if (log.pauseCount > 0) {
    paragraphs.push(p(
      `They paused the timer <strong>${log.pauseCount}</strong> time${log.pauseCount > 1 ? 's' : ''}.`
    ));
  }

  // ── Blindfold ──
  const wasBlindfolded = log.blindfoldedStart || log.blindfoldedMidRun;
  if (!wasBlindfolded) {
    paragraphs.push(p('They did not use the Blindfold.'));
  } else {
    const how = log.blindfoldedStart ? 'from the start' : 'mid-run';
    const limitNote = log.peekLimit !== null
      ? `They had <strong>${log.peekLimit}</strong> peek${log.peekLimit !== 1 ? 's' : ''} available.`
      : 'They had unlimited peeks available.';
    const usedNote = log.peekCount > 0
      ? `They used <strong>${log.peekCount}</strong> peek${log.peekCount !== 1 ? 's' : ''}.`
      : 'They did not use any peeks.';
    paragraphs.push(p(
      `They used the Blindfold (applied ${how}). ${limitNote} ${usedNote}`
    ));
  }

  // ── Consent ──
  if (log.consentText) {
    paragraphs.push(p(
      `As a part of this game, they consented to the following: ${grey(`<em>${log.consentText}</em>`)}`
    ));
  }

  // ── Brave metadata (inline at the bottom) ──
  let braveHtml = '';
  if (braveMetadata) {
    const metaRows = [
      `Sent at (UTC): ${braveMetadata['sent-at'] || '—'}`,
      `Local date and time: ${braveMetadata['local-time'] || '—'}`,
      `Timezone (IANA): ${braveMetadata['timezone'] || '—'}`,
      `Approximate region: ${braveMetadata['region-guess'] || '—'}`,
      `Language / locale: ${braveMetadata['locale'] || '—'}`,
      `Operating system: ${braveMetadata['platform'] || '—'}`,
    ];
    const metaHtml = metaRows
      .map(row => `<li style="margin:2px 0;">${row}</li>`)
      .join('');
    braveHtml = p(
      `They also agreed to &#8216;send a little more.&#8217; The following metadata was collected:<br>` +
      `<ul style="margin:4px 0 0 16px;padding:0;list-style:disc;">${metaHtml}</ul>`
    );
  }

  const footerHtml = p(
    `<span style="color:#aaa;">This Mailtimer is an add-on for Thunderbird. ` +
    `The source code, install files and documentation are available online at ` +
    `<a href="https://github.com/miscy101/mailtimer" style="color:#aaa;">https://github.com/miscy101/mailtimer</a></span>`
  );

  return `
<div style="margin-top:16px;padding-top:12px;border-top:1px solid #ccc;font-family:sans-serif;font-size:12px;color:#333;">
${paragraphs.join('\n')}${braveHtml ? '\n' + braveHtml : ''}
${footerHtml}
</div>`;
}

/**
 * Plain text pipe-separated brave metadata block (used in plainTextBody fallback).
 */
export function formatBraveMetadata(meta) {
  const parts = [
    "They also agreed to 'send a little more.' The following metadata was collected",
    `Sent at (UTC): ${meta['sent-at']      || '—'}`,
    `Local date and time: ${meta['local-time']   || '—'}`,
    `Timezone (IANA): ${meta['timezone']     || '—'}`,
    `Approximate region: ${meta['region-guess'] || '—'}`,
    `Language / locale: ${meta['locale']       || '—'}`,
    `Operating system: ${meta['platform']     || '—'}`,
  ];
  return ' | ' + parts.join(' | ');
}

/**
 * Validates that enough info exists to attempt a send.
 */
export function validateEmail(gameState) {
  if (!gameState.to || !gameState.to.includes('@')) {
    return { valid: false, reason: 'Recipient email address is missing or invalid.' };
  }
  if (!gameState.subject || !gameState.subject.trim()) {
    return { valid: false, reason: 'Subject line is empty.' };
  }
  return { valid: true };
}
