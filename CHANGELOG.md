# Mailtimer — Changelog

---

## 1.0.0 — Initial release

First public release of Mailtimer for Thunderbird.

### Timer modes

- **Fixed** — counts down from a set number of seconds. Default is 600 (10 minutes). The user can set any duration.
- **Random** — the timer picks a random duration between a user-defined minimum and maximum. The blindfold is enabled by default in this mode.

### Modifiers

- **TARDIS** — the countdown drifts unpredictably between half speed and double speed, smoothly accelerating and decelerating. The send still happens when the display reaches zero.
- **Spin the wheel** — when the timer reaches zero, there is a 50% chance the email sends. The other 50%, nothing happens.
- **Last minute** — the Cancel and Pause buttons are hidden and locked until 60 seconds remain on the clock.

### Chaos modes

- **Roulette** — there is a 10% chance the email sends immediately when Start is clicked. The Roulette button also appears during the countdown for additional temptation.
- **Bricked UI** — at a random point after Start, the Cancel and Pause buttons silently stop responding. The user can still close Thunderbird to cancel.
- **Rosetta Stone** — when Start is clicked, all button labels, the countdown display, and the active mode list are scrambled using a one-time character substitution. Letters and digits are interchangeable in the substitution pool. Symbols are preserved.
- **Commitment Issues** — the email is sent the moment Start is clicked. A fake countdown runs as normal.

### Blindfold and peeks

- **Blindfold** — hides the countdown behind `???`. Can be applied before Start or mid-countdown. Cannot be removed once active.
- **Take a peek** — reveals the countdown for one second. Each peek is logged.
- **Peek limit** — optionally restricts the number of peeks. When the limit is reached, the peek button is disabled and the player is flying blind for good.

### Consent and game log

- A consent checkbox must be ticked before Start becomes available. The player confirms they understand the email will send and that the recipient may use the information at their discretion.
- On send, a plain-text game log is appended to the email body. The log records the timer mode, send mode, duration configured, start and completion times, outcome, peek count, pause count, blindfold status, and any chaos modes that were active.

### Brave metadata (optional)

- An optional "Include a little extra" checkbox appends sender system information to the email: send time in UTC, local date and time with timezone, IANA timezone identifier, approximate geographic region (derived from timezone), language/locale, operating system, and time spent on the timer.

### Fragility

- The timer is intentionally fragile. Closing Thunderbird, losing network connectivity, or any other interruption stops the timer and the email is not sent. There is no background process. The only way the email sends is if the timer reaches zero while Thunderbird is running.

### General

- Persistent popup window — the timer panel stays open when the user clicks elsewhere, so they can watch a video or do other things while the countdown runs.
- Subject is automatically prefixed with `Mailtimer Game:` to prevent Thunderbird's empty-subject prompt.
- The Start button is gated on a valid recipient email address in the compose window's To field, checked every 2 seconds.
- The compose window can be filled in before or after opening Mailtimer.
