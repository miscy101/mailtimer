# Mailtimer

**Version 1.1.0**

A countdown timer that sends your email when it reaches zero.

Mailtimer is a game built into Thunderbird. You compose an email, start a timer, and then — depending on the modes you've chosen — it may or may not send when the clock runs out. There are ways to make this easier on yourself. There are also ways to make it considerably harder.

---

## Install

Download `mailtimer.xpi` from the [releases page](../../releases) and install via:

**Tools → Add-ons and Themes → gear icon → Install Add-on From File**

See `INSTALL.md` for the one-time setup step required for unsigned extensions.

---

## How to play

Open a compose window in Thunderbird. Write your email. Address it. Click **Mailtimer** in the compose toolbar.

Configure your options, tick the Consent box, and hit **Start**.

The rest is up to you — and the timer.

A full player's guide is in `USER_GUIDE.md`.

---

## Modes

**Timer length** — Fixed seconds (default 600), or a random value between a min and max you set.

**Modifiers** — TARDIS (speed drifts unpredictably), Spin the Wheel (50/50 chance at zero), Last Minute (cancel and pause locked until the final 60 seconds).

**Chaos** — Roulette (chance of sending immediately on Start, or any time during the countdown), Bricked UI (controls may stop working mid-run), Rosetta Stone (labels and digits scrambled on Start), Commitment Issues (sends immediately, shows a fake countdown).

**Blindfold** — Hides the countdown. Set a peek limit to allow only a fixed number of looks. Run out and you're flying blind for good.

---

## For developers

See `DEV_GUIDE.md` for a full annotated walkthrough of every source file.

The project is structured as:

```
core/          — shared logic (timer, game state, email assembly, UI helpers)
popup/         — extension UI (setup, running, and outcome screens)
background/    — opens the persistent timer window when the toolbar button is clicked
icons/         — placeholder icons (replace with real artwork)
manifest.json  — Thunderbird WebExtension manifest
```

The `core/` modules are platform-agnostic and can run in plain Node.js.
The test suite is at `core/test.mjs` — run with:

```
node --experimental-vm-modules core/test.mjs
```

---

## Licence

This is free and unencumbered software released into the public domain. See `UNLICENSE` for details.
