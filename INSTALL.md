# Installing Mailtimer

Mailtimer is a personal Thunderbird extension distributed as a `.xpi` file.
Because it isn't published on the official add-ons store, you need to do a
one-time setting change before installing it.

---

## Step 1 — Allow unsigned extensions (one-time)

Thunderbird blocks extensions that haven't been reviewed by Mozilla by default.
Here's how to unlock it:

1. Open Thunderbird
2. In the menu bar, go to **Help → Troubleshooting Information**
   *(or type `about:support` in any web tab)*
3. Click **Open Profile Folder** — this opens your Thunderbird profile directory
4. Close Thunderbird completely
5. In that folder, create a new file called `user.js` (or open it if it exists)
6. Add this line:
   ```
   user_pref("xpinstall.signatures.required", false);
   ```
7. Save the file and reopen Thunderbird

You only need to do this once. Future Mailtimer updates won't need it again.

---

## Step 2 — Install the .xpi file

**Option A — drag and drop**
Drag `mailtimer.xpi` directly onto the Thunderbird window.
A prompt will appear asking you to confirm installation.

**Option B — Add-on Manager**
1. Go to **Tools → Add-ons and Themes** (or press `Ctrl+Shift+A`)
2. Click the gear icon (⚙) near the top right
3. Choose **Install Add-on From File...**
4. Select `mailtimer.xpi`
5. Confirm when prompted

---

## Step 3 — Use it

Open a new compose window in Thunderbird.
You'll see a **Mailtimer** button in the compose toolbar.
Click it to open the timer panel.

---

## Updating Mailtimer

To install a new version, just repeat Step 2.
Thunderbird will replace the old version automatically.

## Uninstalling

Go to **Tools → Add-ons and Themes**, find Mailtimer, and click **Remove**.

---

## Passing it on

You can share `mailtimer.xpi` with anyone — email it, put it on a USB stick,
host it on a private page. The recipient just needs to follow Steps 1 and 2
above. The `user.js` change only affects their Thunderbird installation,
not their email account or any other software.
