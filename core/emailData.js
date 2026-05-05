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
  const parts = [
    'A little extra (sender consented)',
    `Sent: ${meta['sent-at']      || '—'}`,
    `Local time: ${meta['local-time']   || '—'}`,
    `Timezone: ${meta['timezone']     || '—'}`,
    `Region: ${meta['region-guess'] || '—'}`,
    `Locale: ${meta['locale']       || '—'}`,
    `OS: ${meta['platform']     || '—'}`,
    `Time on timer: ${meta['elapsed-seconds'] != null
      ? meta['elapsed-seconds'] + 's' : '—'}`,
  ];
  return ' | ' + parts.join(' | ');
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
