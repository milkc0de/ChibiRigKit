// SPDX-License-Identifier: Apache-2.0
function isPlayerURL(value, origin) {
  try { const url = new URL(value); return url.origin === origin && ['/', '/index.html'].includes(url.pathname); }
  catch { return false; }
}
function allowMedia(permission, value, origin, details = {}) {
  return permission === 'media' && isPlayerURL(value, origin) && details.isMainFrame !== false &&
    (!details.mediaTypes || details.mediaTypes.every(type => ['audio', 'video'].includes(type)));
}
function capturePower(blocker) {
  let id = null;
  return {
    set(active) {
      if (active && id === null) id = blocker.start('prevent-app-suspension');
      if (!active && id !== null) { blocker.stop(id); id = null; }
    },
    get active() { return id !== null; }
  };
}
module.exports = {isPlayerURL, allowMedia, capturePower};
