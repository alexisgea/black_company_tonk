// Tiny element builder: h('div', { class: 'x', onClick }, ...children). Falsy children and props are skipped.
// Event handlers live in a per-element table (el.__on) behind one stable listener per event type, so the
// patcher below can hand a reused element the handlers of its freshly built twin without stale closures.
// Handlers must therefore use e.currentTarget, never the element they were built for.
function dispatch(e) {
  const fn = this.__on?.[e.type];
  if (fn) fn.call(this, e);
}

export function on(el, type, fn) {
  if (!el.__on) el.__on = {};
  if (!el.__bound) el.__bound = new Set();
  el.__on[type] = fn;
  if (!el.__bound.has(type)) {
    el.__bound.add(type);
    el.addEventListener(type, dispatch);
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) on(el, k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

// Nodes that outlive every render (e.g. the chat panel). The new tree holds a
// h('div', { 'data-persist': name }) placeholder where the registered node belongs.
export const persistent = {
  nodes: new Map(),
  names: new WeakMap(),
  set(name, node) {
    this.nodes.set(name, node);
    this.names.set(node, name);
  },
  get(name) {
    return this.nodes.get(name);
  },
};

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const USER_STATE_ATTRS = new Set(['value', 'checked']);
const KEY_ATTRS = ['data-persist', 'data-card', 'data-player', 'data-pile', 'id'];

function keyOf(node) {
  if (node.nodeType !== 1) return null;
  const name = persistent.names.get(node);
  if (name !== undefined) return `persist:${name}`;
  for (const attr of KEY_ATTRS) {
    const value = node.getAttribute(attr);
    if (value !== null) return `${node.localName}|${attr}|${value}`;
  }
  return null;
}

const typeOf = (node) => (node.nodeType === 1 ? node.localName : '#text');

function syncAttributes(old, next) {
  const field = FIELDS.has(old.tagName);
  const skip = (name) => name === 'style' || (field && USER_STATE_ATTRS.has(name));
  for (const { name, value } of Array.from(next.attributes)) {
    if (!skip(name) && old.getAttribute(name) !== value) old.setAttribute(name, value);
  }
  for (const { name } of Array.from(old.attributes)) {
    if (!skip(name) && !next.hasAttribute(name)) old.removeAttribute(name);
  }
  // The server's CSP forbids setAttribute('style'); CSSOM writes are allowed.
  if (old.style.cssText !== next.style.cssText) old.style.cssText = next.style.cssText;
  // Fields keep what the user typed, unless they opt in (data-sync) and are not being edited right now.
  if (field && next.hasAttribute('data-sync') && document.activeElement !== old && old.value !== next.value) old.value = next.value;
}

function syncHandlers(old, next) {
  const table = next.__on || {};
  for (const type of Object.keys(old.__on || {})) if (!(type in table)) delete old.__on[type];
  for (const [type, fn] of Object.entries(table)) on(old, type, fn);
}

function patchNode(old, next) {
  if (old.nodeType === 3) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return;
  }
  syncAttributes(old, next);
  syncHandlers(old, next);
  if (old.localName !== 'textarea') patchChildren(old, Array.from(next.childNodes));
}

// A new subtree is inserted as is; its placeholders still have to be swapped for the persistent nodes.
function resolvePlaceholders(node) {
  if (node.nodeType !== 1) return;
  for (const placeholder of Array.from(node.querySelectorAll('[data-persist]'))) {
    const keep = persistent.get(placeholder.getAttribute('data-persist'));
    if (keep) placeholder.replaceWith(keep);
  }
}

// Reconcile the live children of `parent` with a freshly built, detached list of nodes. Keyed nodes are matched
// by key, the others by type in order. Matched nodes are patched in place (so focus, scroll, selection and running
// animations survive); unmatched new nodes are inserted (the new node itself is moved) and leftovers removed.
export function patchChildren(parent, nextNodes) {
  const oldNodes = Array.from(parent.childNodes);
  const keyed = new Map();
  const loose = new Map();
  for (const node of oldNodes) {
    const key = keyOf(node);
    if (key !== null) {
      if (!keyed.has(key)) keyed.set(key, node);
    } else {
      const type = typeOf(node);
      if (!loose.has(type)) loose.set(type, []);
      loose.get(type).push(node);
    }
  }

  const plan = [];
  const used = new Set();
  for (const next of nextNodes) {
    if (next.nodeType !== 1 && next.nodeType !== 3) continue;
    const holder = next.nodeType === 1 ? next.getAttribute('data-persist') : null;
    const kept = holder !== null ? persistent.get(holder) : undefined;
    if (kept) {
      used.add(kept);
      plan.push({ node: kept });
      continue;
    }
    const key = keyOf(next);
    let old = key !== null ? keyed.get(key) : loose.get(typeOf(next))?.shift();
    if (old && (used.has(old) || old.nodeType !== next.nodeType)) old = undefined;
    if (old) {
      used.add(old);
      plan.push({ node: old, next });
    } else {
      plan.push({ node: next, fresh: true });
    }
  }

  for (const node of oldNodes) if (!used.has(node) && node.parentNode === parent) parent.removeChild(node);

  let ref = parent.firstChild;
  for (const { node, next, fresh } of plan) {
    if (node === ref) ref = ref.nextSibling;
    else parent.insertBefore(node, ref);
    if (fresh) resolvePlaceholders(node);
    else if (next) patchNode(node, next);
  }
}
