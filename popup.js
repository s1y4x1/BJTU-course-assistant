document.addEventListener('DOMContentLoaded', () => {
  const frame = document.getElementById('popup-frame');

  // keep iframe pinned to popup-mode app page
  try {
    frame.src = chrome.runtime.getURL('app.html?popup=1');
  } catch (e) {
    // ignore
  }
});
