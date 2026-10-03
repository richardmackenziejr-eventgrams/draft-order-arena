// A "Full screen" toggle for a game panel (the canvas plus its buttons and text), shared by Field
// Goal Kick and Kickoff Return. Uses the browser's Fullscreen API on the whole panel, so the
// Hike / Lock / Start / Next buttons stay on screen with the picture -- the stylesheet scales the
// 16:9 picture to fit the screen while it's fullscreen (see the ":fullscreen" rules in style.css).
//
// The button only exists where fullscreen is actually possible: computers, and Android phones.
// iPhone Safari doesn't allow element fullscreen at all, so no button shows there. The stylesheet
// also hides it on a phone held sideways, where the game already fills the screen.
export function setupFullscreenToggle(panel) {
  if (!panel) return;
  const doc = document;
  const canFullscreen = doc.fullscreenEnabled || doc.webkitFullscreenEnabled;
  if (!canFullscreen) return;

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'btn secondary fs-toggle';
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const current = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const label = () => { btn.textContent = current() === panel ? '✕ Exit full screen' : '⛶ Full screen'; };
  label();
  panel.classList.add('fs-host');
  panel.insertBefore(btn, panel.firstChild);

  btn.addEventListener('click', async () => {
    try {
      if (current() === panel) {
        (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      } else {
        await (panel.requestFullscreen || panel.webkitRequestFullscreen).call(panel, { navigationUI: 'hide' });
        // On a phone, ask for landscape so the 16:9 picture can use the whole screen (best effort:
        // browsers that don't allow it just ignore this).
        if (isCoarse && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (err) {
      console.warn('fullscreen request failed', err);
    }
  });

  const onChange = () => {
    label();
    if (current() !== panel && isCoarse && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) { /* nothing to unlock */ }
    }
    window.dispatchEvent(new Event('resize')); // let the 3D canvas re-measure itself at the new size
  };
  doc.addEventListener('fullscreenchange', onChange);
  doc.addEventListener('webkitfullscreenchange', onChange);
}
