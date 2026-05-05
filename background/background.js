/**
 * background.js
 *
 * Opens the Mailtimer popup as a persistent window when the toolbar
 * button is clicked. The window stays open when the user clicks away,
 * so timer setup and countdowns are not interrupted.
 *
 * We track one window per compose tab to prevent duplicates.
 */

// Map of composeTabId → mailtimer windowId
const openWindows = new Map();

browser.composeAction.onClicked.addListener(async (composeTab) => {
  const composeTabId = composeTab.id;

  // If a window is already open for this compose tab, just focus it
  if (openWindows.has(composeTabId)) {
    const existingWindowId = openWindows.get(composeTabId);
    try {
      await browser.windows.update(existingWindowId, { focused: true });
      return;
    } catch {
      // Window was closed externally — fall through and open a new one
      openWindows.delete(composeTabId);
    }
  }

  // Pass the compose tab ID as a URL param so the popup knows
  // which compose window to read from and send through.
  const popupUrl = browser.runtime.getURL('popup/popup.html')
    + `?composeTabId=${composeTabId}`;

  const win = await browser.windows.create({
    url:    popupUrl,
    type:   'popup',
    width:  700,
    height: 680,
  });

  openWindows.set(composeTabId, win.id);

  // Clean up tracking when the window is closed
  browser.windows.onRemoved.addListener(function onRemoved(windowId) {
    if (windowId === win.id) {
      openWindows.delete(composeTabId);
      browser.windows.onRemoved.removeListener(onRemoved);
    }
  });
});
