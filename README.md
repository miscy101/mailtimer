# Mailtimer

A countdown timer that sends your email when it reaches zero.

Mailtimer is a game built into your email client. You compose an email, start a timer, and then — depending on the modes you've chosen — it may or may not send when the clock runs out. There are ways to make this easier on yourself. There are also ways to make it considerably harder.

Available for **Thunderbird** (as an extension) and **Outlook** (as an add-in).

---

## Install

### Thunderbird

Download `mailtimer.xpi` from the [releases page](../../releases) and install it via:

**Tools → Add-ons and Themes → gear icon → Install Add-on From File**

See `INSTALL.md` for first-time setup (a one-time setting change is required to allow unsigned extensions).

### Outlook (new Outlook, Outlook on the web, Outlook on Mac)

1. Go to **[https://aka.ms/olksideload](https://aka.ms/olksideload)** in your browser
2. Select **My add-ins → Custom add-ins → Add from file**
3. Upload the `outlook/manifest.xml` file from this repository
4. Open a compose window — the Mailtimer button will appear in the toolbar

No server setup required. The add-in loads directly from this repository via GitHub Pages.

See `outlook/INSTALL.md` for troubleshooting.

> **Note:** Classic Outlook on Windows is not supported. See the add-in for details.

---

## How to play

Open a compose window. Write your email. Address it. Click **Mailtimer**.

Configure your options, tick the consent box, and hit **Start**.

The rest is up to you — and the timer.

A player's guide is included in `USER_GUIDE.md`.

---

## Modes

**Timer length** — Fixed seconds, or a random value between a min and max you set.

**Modifiers** — TARDIS (speed drifts unpredictably), Spin the Wheel (50% chance at zero), Last Minute (cancel locked until the final 60 seconds).

**Chaos** — Roulette (chance of sending immediately), Bricked UI (controls may stop working mid-run), Rosetta Stone (labels and digits scrambled), Commitment Issues (sends immediately, shows a fake countdown).

**Blindfold** — Hides the countdown. Optional peek limit — run out of peeks and you're flying blind for good.

---

## For developers

See `DEV_GUIDE.md` for a full annotated walkthrough of every source file.

The project is structured as:

```
core/          — shared logic (timer, game state, email assembly, UI helpers)
popup/         — Thunderbird extension UI
background/    — Thunderbird extension background script
outlook/       — Outlook add-in (task pane, dialog, adapter, manifest)
```

The `core/` modules are platform-agnostic and can run in plain Node.js. The test suite is at `core/test.mjs`.

---

## Licence

This is free and unencumbered software released into the public domain. See `UNLICENSE` for details.
