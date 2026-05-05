/**
 * emailData.js — assembles the final email from GameState
 *
 * buildEmail() produces a plain object the Thunderbird adapter uses to send.
 * The game log and optional brave metadata are appended to the body.
 */

export function buildEmail(gameState, braveMetadata = null) {
  const gameLog  = gameState.formatLog();
  const braveLog = braveMetadata ? formatBraveMetadata(braveMetadata) : '';

  return {
    to:      gameState.to,
    subject: gameState.subject,
    body:    gameState.body + gameLog + braveLog,
  };
}

/**
 * Formats brave metadata into a clearly labelled block appended to the email.
 */
export function formatBraveMetadata(meta) {
  const lines = [
    '',
    '════════════════════════════════',
    'A little extra — sender system info',
    '(The sender consented to including this)',
    '════════════════════════════════',
    '',
    `Sent at (UTC):          ${meta['sent-at']      || '—'}`,
    `Local date and time:    ${meta['local-time']   || '—'}`,
    `Timezone (IANA):        ${meta['timezone']     || '—'}`,
    `Approximate region:     ${meta['region-guess'] || '—'}`,
    '',
    `Language / locale:      ${meta['locale']       || '—'}`,
    `Operating system:       ${meta['platform']     || '—'}`,
    '',
    `Time spent on timer:    ${meta['elapsed-seconds'] != null
      ? meta['elapsed-seconds'] + ' seconds' : '—'}`,
    '',
    '════════════════════════════════',
  ];
  return lines.join('\n');
}

/**
 * Validates that enough info exists to attempt a send.
 * Returns { valid: true } or { valid: false, reason: string }
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
