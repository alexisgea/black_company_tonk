import { h } from './dom.js';
import { toast } from './state.js';
import { t } from './i18n.js';

// iPhone Safari has no Fullscreen API for pages, so the button is simply not offered there.
const supported = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast(t('fullscreen.unavailable')));
}

// Four diagonal arrows: pointing out to enter full screen, pointing in to leave it.
const ICON_ENTER = 'M10 2h4v4M14 2l-4.5 4.5M6 14H2v-4M2 14l4.5-4.5M2 6V2h4M2 2l4.5 4.5M14 10v4h-4M14 14l-4.5-4.5';
const ICON_EXIT = 'M9 3v4h4M9 7l5-5M7 13V9H3M7 9l-5 5M7 3v4H3M7 7L2 2M9 13V9h4M9 9l5 5';

function icon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'btn-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

// Re-render on `fullscreenchange` (see main.js) so the label follows the real state, including the Back gesture.
export function fullscreenButton() {
  if (!supported) return null;
  const on = !!document.fullscreenElement;
  return h(
    'button',
    { class: 'secondary', onClick: toggleFullscreen },
    icon(on ? ICON_EXIT : ICON_ENTER),
    on ? t('fullscreen.exit') : t('fullscreen.enter'),
  );
}
