# Mailtimer for Outlook — installation guide

No server setup required. The add-in loads its files directly from GitHub Pages.

---

## Requirements

- A Microsoft 365 account (personal Outlook.com, or work/school M365)
- New Outlook on Windows, Outlook on the web, or Outlook on Mac

> **Classic Outlook on Windows is not supported.** See the note in the add-in
> itself for the reason. If you open the add-in on classic Outlook, it will
> explain this and decline to run.

---

## Install

**Use this URL — not the "Add apps" button in the new Outlook UI:**

1. In your browser, go to: **https://aka.ms/olksideload**

2. Select **My add-ins** along the top

3. Scroll down to **Custom add-ins**

4. Click **+ Add a custom add-in** → **Add from file...**

5. Download `outlook/manifest.xml` from this repository and select it
   (or clone/download the whole repo and use the file directly)

6. Click **Install** when prompted

The add-in may take a few minutes to appear in Outlook's toolbar after installing.

---

## Use it

1. Open a new compose window in Outlook
2. Click the **Mailtimer** button in the compose toolbar
3. Fill in your email, configure the options, tick Consent, click Start

---

## How the add-in works

When you click Start, Mailtimer:
- Reads your email fields (To, Subject, Body)
- Calculates the send time
- Schedules delivery via Outlook's delayed send feature (server-side)
- Opens a timer dialog showing the countdown

Because delivery is scheduled server-side, **closing Outlook does not cancel
the timer**. To cancel, use the Cancel button in Mailtimer before the timer
reaches zero, or delete the email from your Drafts folder.

---

## Troubleshooting

**"This app can't be installed" or XML error**
Make sure you downloaded `manifest.xml` from the `outlook/` folder specifically.
Do not use the `mailtimer.xpi` file — that is for Thunderbird only.

**Add-in button doesn't appear after installing**
Wait a few minutes and refresh Outlook. On first install there can be a short
delay. If it still doesn't appear after 10 minutes, remove and reinstall via
https://aka.ms/olksideload.

**"Mailtimer can't run here" message**
You are using classic Outlook on Windows. Please switch to new Outlook,
Outlook on the web, or Outlook on Mac.

**Task pane shows an error or blank screen**
Check that you installed from `outlook/manifest.xml` (not a different file).
Also check that your Microsoft 365 account has add-in permissions — some
organisations restrict these.

---

## Updating

To install a newer version, remove the current add-in via https://aka.ms/olksideload
→ My add-ins → Custom add-ins → three-dot menu → Remove, then reinstall
using the updated `manifest.xml`.

---

## Removing

Go to https://aka.ms/olksideload → My add-ins → Custom add-ins,
find Mailtimer, and click the three-dot menu → Remove.
