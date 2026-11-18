// Chat and log panels of the sidebar: an arrow folds each one away and a handle at the bottom resizes it.
// The choices are kept in localStorage; a height of null means "the default", which scales with the window.
import { h } from './dom.js';
import { t } from './i18n.js';

const STORAGE_KEY = 'tonk.panels';
const KEYS = ['chat', 'log'];
export const MIN_HEIGHT = 48;
const KEY_STEP = 24;

export const clampHeight = (px, max) => Math.round(Math.min(max, Math.max(MIN_HEIGHT, px)));
const maxHeight = () => Math.max(MIN_HEIGHT, Math.round(globalThis.innerHeight * 0.9));

export function loadLayout(storage = globalThis.localStorage) {
  let saved = {};
  try {
    saved = JSON.parse(storage.getItem(STORAGE_KEY)) || {};
  } catch {
    // Unreadable or unavailable storage: fall back to the defaults.
  }
  return Object.fromEntries(
    KEYS.map((key) => {
      const { collapsed, height } = saved[key] || {};
      return [key, { collapsed: collapsed === true, height: Number.isFinite(height) ? clampHeight(height, 4000) : null }];
    }),
  );
}

const layout = loadLayout();
// Pointer drag in progress. Kept here, not in a closure: the patcher swaps handlers between renders.
let drag = null;

function save() {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Private mode or a full quota: the layout still applies until the page is closed.
  }
}

// Handlers below resolve the panel from the event, never from the element they were built for (see dom.js).
const panelOf = (e) => e.currentTarget.closest('.collapsible');
const sizedOf = (panel) => panel.querySelector('.panel-body').firstElementChild;
const keyOf = (panel) => panel.dataset.panel;
const isAtBottom = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 24;

function applyLayout(panel) {
  const { collapsed, height } = layout[keyOf(panel)];
  const sized = sizedOf(panel);
  const atBottom = isAtBottom(sized);
  const toggle = panel.querySelector('.collapse-btn');
  panel.classList.toggle('collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = t(collapsed ? 'panel.expand' : 'panel.collapse');
  sized.style.height = height === null ? '' : `${clampHeight(height, maxHeight())}px`;
  sized.style.maxHeight = height === null ? '' : 'none';
  if (atBottom) sized.scrollTop = sized.scrollHeight;
}

function resizeTo(panel, px) {
  layout[keyOf(panel)].height = clampHeight(px, maxHeight());
  applyLayout(panel);
}

// `sized` is the scrolling element whose height the handle controls; `rest` (e.g. the chat form) follows it.
export function sidePanel(key, title, sized, ...rest) {
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'collapse-btn',
      'aria-label': title,
      onClick: (e) => {
        const panel = panelOf(e);
        layout[key].collapsed = !layout[key].collapsed;
        save();
        applyLayout(panel);
        // A hidden element forgets its scroll position, so show the newest lines again.
        if (!layout[key].collapsed) sizedOf(panel).scrollTop = sizedOf(panel).scrollHeight;
      },
    },
    h('span', { class: 'arrow', 'aria-hidden': 'true' }),
  );
  const handle = h('div', {
    class: 'resize-handle',
    role: 'separator',
    'aria-orientation': 'horizontal',
    tabIndex: 0,
    title: t('panel.resize'),
    onPointerdown: (e) => {
      drag = { y: e.clientY, height: sizedOf(panelOf(e)).getBoundingClientRect().height };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointermove: (e) => {
      if (drag) resizeTo(panelOf(e), drag.height + e.clientY - drag.y);
    },
    onPointerup: () => {
      if (drag) save();
      drag = null;
    },
    onPointercancel: () => {
      if (drag) save();
      drag = null;
    },
    onDblclick: (e) => {
      layout[key].height = null;
      save();
      applyLayout(panelOf(e));
    },
    onKeydown: (e) => {
      const step = { ArrowUp: -KEY_STEP, ArrowDown: KEY_STEP }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      const panel = panelOf(e);
      resizeTo(panel, sizedOf(panel).getBoundingClientRect().height + step);
      save();
    },
  });
  const panel = h(
    'div',
    { class: `panel collapsible ${key}-panel`, 'data-panel': key },
    h('div', { class: 'panel-head' }, toggle, h('strong', null, title)),
    h('div', { class: 'panel-body' }, sized, ...rest, handle),
  );
  applyLayout(panel);
  return panel;
}
