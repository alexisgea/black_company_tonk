import { h } from './dom.js';
import { toast } from './state.js';

// iPhone Safari has no Fullscreen API for pages, so the button is simply not offered there.
const supported = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast('Full screen is not available here'));
}

// Re-render on `fullscreenchange` (see main.js) so the label follows the real state, including the Back gesture.
export function fullscreenButton() {
  if (!supported) return null;
  return h('button', { class: 'secondary', onClick: toggleFullscreen }, document.fullscreenElement ? 'Exit full screen' : 'Full screen');
}
