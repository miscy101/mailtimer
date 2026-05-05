# Mailtimer — player's guide

*A guide for the sender. The recipient should not read this.*

---

## What is Mailtimer?

You have something to say. A file to send. Something you've been putting off, or something you want to make theatrical. Mailtimer is a countdown timer attached to your Thunderbird email. When it reaches zero — under the right conditions — it sends.

The game is simple: you set it up, you start it, and then you live with your choices.

---

## Before you start

Open a compose window in Thunderbird. Write your email. Add any attachments. Address it.

Then click the **Mailtimer** button in the compose toolbar. A separate window opens — this is your control panel, and it stays open even if you click away, so you can watch a video, pace the room, or check your phone while the timer runs.

You will need to tick the **Consent** box before you can start. Read it. It means what it says.

---

## The left panel — your options

### Timer length

By default, the timer counts down from **600 seconds**. You can change this to any number you like.

Turn on **Random** and instead of a fixed time, you provide a minimum and a maximum. The app picks a number somewhere in that range and — by default — hides it from you. You won't know how long you have.

---

### Modifiers

These change how the timer behaves. You can combine them freely.

**TARDIS**
The countdown doesn't run at a steady pace. It speeds up. It slows down. It speeds up again. The total time is roughly what you set, but the moment-to-moment experience is... less predictable.

**Spin the wheel**
When the timer reaches zero, there's a chance it sends. There's also a chance it doesn't. You'll find out when you get there.

**Last minute**
The Cancel button is hidden. The Pause button is locked. Both become available only in the final 60 seconds — if you haven't already decided to let it run.

---

### Chaos

These are more disruptive. Use them if you want less control, not more.

**Roulette**
There's a chance the email sends the moment you click Start. Before the timer even begins. You can also press the Roulette button *during* the countdown for the same chance.

**Bricked UI**
At some point after you click Start — you won't know when — the Cancel and Pause buttons will stop responding. You'll still be able to see them. They just won't do anything.

**Rosetta stone**
The moment the timer starts, the labels, button text, and countdown display are scrambled. Letters become other letters or numbers. Numbers become letters. Symbols stay put. It applies once and stays that way.

**Commitment issues**
The email sends the moment you click Start. The timer still counts down — it just has nothing left to count toward. This mode is for people who want to send, and who consent to sending, but find they get cold feet. We'll help you follow through, guaranteed.

---

### Include a little extra...

Tick this if you want a small block of system information appended to the email. The recipient will see your approximate timezone and region, the time the email was sent, your operating system, and how long you spent on the timer. Nothing that isn't already visible in email headers — just presented more plainly.

---

## The right panel — the controls

### The timer display

Shows the current number of seconds remaining. In Random mode before you start, it shows `???`. In Rosetta Stone mode, it shows something that used to be a number.

### Blindfold

Ticking this before you start hides the countdown behind `???`. You can still press **Take a peek** during the countdown to reveal it for one second, but that will be logged. Once you start with the blindfold on, you cannot remove it. If you enable Random mode, the blindfold is ticked automatically — though you can untick it if you'd like.

### Consent

Tick this to confirm you understand an email will be sent and that the recipient is free to use what you've sent however they choose. This must be ticked before the Start button becomes available.

### Start

Begins the countdown. Depending on your settings, something may happen immediately.

---

## During the countdown

**Pause** — freezes the timer. The email goes nowhere while it's paused. Unavailable in Last Minute mode until the final 60 seconds, and permanently unavailable if Bricked UI has activated.

**Cancel** — stops the timer and closes the session. The email is not sent. Unavailable in Last Minute mode until the final 60 seconds, and permanently unavailable once Bricked UI activates.

**Take a peek** — only visible when you are blindfolded. Shows the timer for one second, then hides it again. Each peek is logged and included in the game summary appended to the email.

**Blindfold** — only visible if you didn't start with the blindfold on. Applies the blindfold mid-countdown. This is a one-way action.

**Roulette** — only visible if Roulette is active. Press it for a chance the email sends immediately. If it doesn't fire, the button briefly says `...no.` and becomes available again.

---

## When it's over

If the email sends, you'll see a short outcome screen. The email itself will include a game log at the bottom — a plain-text summary of what modes were active, how many times you peeked, whether you paused, and the outcome. The recipient receives this too.

If you cancelled, the timer stops and nothing is sent.

---

## A note on the game

The mailtimer is designed to be fragile. If you close Thunderbird, pull the network cable, or turn off your computer, the timer stops and nothing sends. There is no background process waiting to deliver your email while you sleep. The only way it sends is if you leave it running and let it reach zero.

Everything else is just ways of making that harder.

---

*The recipient should not read this guide. If they have, they know too much, and you should probably start over.*
