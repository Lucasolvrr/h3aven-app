// Expanding button group: a compact pill of icon buttons. One action always
// shows its label; the one you point at or focus grows to reveal its label
// while its neighbours slide aside, and an action can confirm in place (the
// icon draws a check, the label becomes a past-tense word).
//
//   const group = expandingGroup({ label, items, rest, onSettled })
//   parent.append(group.el); group.measure();   // widths need the element in the page
//
// items: [{ id, label, icon, doneLabel?, tone?: 'danger', disabled?, run?: () => boolean | Promise<boolean> }]
//   run returning false (or throwing) skips the confirmation. Actions that
//   finish later (a menu, a dialog) return false and call group.confirm(id).
// rest: id of the action expanded at rest (defaults to the first enabled one).
// onSettled(id): after a confirmation has been shown.
//
// Geometry and timing live in CSS (.ebg custom properties); widths are set
// here because CSS cannot transition to `auto`.

import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

const HYSTERESIS = 4; // px the pointer must travel into a neighbour before it takes over
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ebg-check" pathLength="1" d="M4 12.5l5 5L20 6.5"/></svg>';

/** Swaps the child of `slot` with a cross-fade: the old one leaves, the new one enters. */
function swap(slot, next) {
  for (const old of [...slot.children]) {
    if (old.classList.contains('is-leaving')) continue;
    old.classList.add('is-leaving');
    old.addEventListener('animationend', () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 400); // reduced motion: no animationend
  }
  next.classList.add('is-entering');
  slot.append(next);
}

export function expandingGroup({ label, items, rest = null, confirmFor = 1400, onSettled }) {
  const state = { intent: null, focused: null, done: null, busy: null };
  const pointer = { over: null, at: null };
  let keyFocus = null; // id focused from the keyboard
  let touchOpen = null; // id whose label a first tap opened
  let timer = 0;

  const live = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const root = h('div', { class: 'ebg', role: 'toolbar', 'aria-label': label, 'aria-orientation': 'horizontal' });

  const nodes = new Map(); // id -> { item, button, glyphSlot, wordSlot, text }
  for (const item of items) {
    const glyphSlot = h('span', { class: 'ebg-icon', 'aria-hidden': 'true' }, h('span', { class: 'ebg-glyph' }, iconEl(item.icon, 16)));
    const sizers = [item.label, item.doneLabel].filter(Boolean).map((text) => h('span', { class: 'ebg-sizer' }, text));
    const wordSlot = h('span', { class: 'ebg-words' }, h('span', { class: 'ebg-word' }, item.label));
    const button = h(
      'button',
      { type: 'button', class: 'ebg-item', dataset: { id: item.id, tone: item.tone || 'neutral', state: 'idle' }, 'aria-label': item.label, tabindex: '-1' },
      glyphSlot,
      h('span', { class: 'ebg-label', 'aria-hidden': 'true' }, wordSlot, ...sizers)
    );
    nodes.set(item.id, { item, button, glyphSlot, wordSlot, sizers, text: 0 });
    root.append(button);
  }
  root.append(live);

  const enabled = (id) => Boolean(id) && nodes.has(id) && !nodes.get(id).item.disabled;
  const restId = () => (enabled(rest) ? rest : items.find((item) => !item.disabled)?.id ?? items[0]?.id ?? null);
  const expandedId = () => (nodes.has(state.intent) ? state.intent : restId());

  // --- geometry ---------------------------------------------------------------------------

  let metrics = null;
  const readMetrics = () => {
    const css = getComputedStyle(root);
    const px = (name) => parseFloat(css.getPropertyValue(name)) || 0;
    metrics = { height: px('--ebg-h'), icon: px('--ebg-icon'), start: px('--ebg-start'), gap: px('--ebg-gap'), end: px('--ebg-end') };
  };

  /** Label widths: the longer of the label and its past-tense word, so confirming never changes the width. */
  function measure() {
    if (!root.isConnected) return;
    readMetrics();
    for (const node of nodes.values()) {
      const next = Math.max(...node.sizers.map((sizer) => sizer.getBoundingClientRect().width));
      if (Math.abs(next - node.text) >= 0.5) node.text = next;
    }
    root.classList.add('is-measured');
    paint();
  }

  function paint() {
    const open = expandedId();
    const tabStop = nodes.has(state.focused) ? state.focused : restId();
    for (const [id, node] of nodes) {
      const expanded = id === open;
      node.button.toggleAttribute('data-expanded', expanded);
      node.button.tabIndex = id === tabStop ? 0 : -1;
      node.button.toggleAttribute('aria-disabled', Boolean(node.item.disabled));
      node.button.toggleAttribute('aria-busy', state.busy === id);
      if (metrics && node.text) {
        node.button.style.width = `${expanded ? metrics.start + metrics.icon + metrics.gap + node.text + metrics.end : metrics.height}px`;
      }
    }
  }

  const setIntent = (id) => {
    state.intent = id;
    paint();
  };

  // --- confirmation -----------------------------------------------------------------------

  function showState(node, done) {
    node.button.dataset.state = done ? 'done' : 'idle';
    const glyph = h('span', { class: 'ebg-glyph' });
    if (done) glyph.innerHTML = CHECK;
    else glyph.append(iconEl(node.item.icon, 16));
    swap(node.glyphSlot, glyph);
    swap(node.wordSlot, h('span', { class: 'ebg-word' }, done ? node.item.doneLabel : node.item.label));
  }

  /** Shows "done" in place on `id` for a moment, then onSettled(id). */
  function confirm(id) {
    const node = nodes.get(id);
    if (!node?.item.doneLabel) {
      onSettled?.(id);
      return;
    }
    clearTimeout(timer);
    if (state.done && state.done !== id) showState(nodes.get(state.done), false);
    state.done = id;
    state.intent = id;
    showState(node, true);
    paint();
    // A zero-width space alternates so the same word is announced again on a repeat.
    live.textContent = node.item.doneLabel + (live.textContent.endsWith('​') ? '' : '​');
    timer = setTimeout(() => {
      state.done = null;
      showState(node, false);
      if (pointer.over !== id && keyFocus !== id) {
        if (touchOpen === id) touchOpen = null;
        if (state.intent === id) state.intent = pointer.over ?? keyFocus;
      }
      paint();
      onSettled?.(id);
    }, confirmFor);
  }

  async function activate(id) {
    const node = nodes.get(id);
    if (!node || node.item.disabled || state.busy === id || state.done === id) return;
    setIntent(id);
    let result;
    try {
      const pending = node.item.run?.();
      if (pending instanceof Promise) {
        state.busy = id;
        paint();
        result = await pending;
      } else result = pending;
    } catch {
      result = false;
    } finally {
      if (state.busy === id) {
        state.busy = null;
        paint();
      }
    }
    if (result === false || !root.isConnected) return;
    confirm(id);
  }

  // --- pointer, touch and keyboard ----------------------------------------------------------

  let press = null;
  root.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.ebg-item');
    if (button) press = { id: button.dataset.id, kind: event.pointerType, wasExpanded: expandedId() === button.dataset.id };
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('.ebg-item');
    if (!button) return;
    const id = button.dataset.id;
    const last = press;
    press = null;
    // Touch has no hover: the first tap opens the label, the second runs the action.
    if (last && last.id === id && last.kind === 'touch' && !last.wasExpanded) {
      touchOpen = id;
      setIntent(id);
      return;
    }
    if (last?.kind === 'touch') touchOpen = id;
    activate(id);
  });

  // A tap outside closes a label a first tap opened.
  const onOutsideDown = (event) => {
    if (!touchOpen || root.contains(event.target)) return;
    touchOpen = null;
    setIntent(state.done ?? keyFocus);
  };
  document.addEventListener('pointerdown', onOutsideDown, true);

  // Hover follows real pointer movement only: a button that slides under a resting
  // pointer must not take over, or two neighbours could trade places back and forth.
  root.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const at = pointer.at;
    if (at && Math.abs(at.x - event.clientX) < 1 && Math.abs(at.y - event.clientY) < 1) return;
    pointer.at = { x: event.clientX, y: event.clientY };
    const button = event.target.closest('.ebg-item');
    const id = button?.dataset.id;
    if (!id || id === pointer.over) return;
    if (pointer.over) {
      const box = button.getBoundingClientRect();
      if (event.clientX < box.left + HYSTERESIS || event.clientX > box.right - HYSTERESIS) return;
    }
    pointer.over = id;
    setIntent(id);
  });
  root.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer.at = null;
    pointer.over = null;
    setIntent(state.done ?? keyFocus);
  });

  root.addEventListener('focusin', (event) => {
    const button = event.target.closest('.ebg-item');
    if (!button) return;
    state.focused = button.dataset.id;
    // Only keyboard focus expands; a click or a tap has its own path.
    let visible = true;
    try {
      visible = button.matches(':focus-visible');
    } catch {
      /* older engines: expand on any focus */
    }
    if (!visible) return paint();
    keyFocus = button.dataset.id;
    setIntent(keyFocus);
  });
  root.addEventListener('focusout', (event) => {
    if (root.contains(event.relatedTarget)) return;
    keyFocus = null;
    touchOpen = null;
    setIntent(pointer.over ?? state.done);
  });

  root.addEventListener('keydown', (event) => {
    const list = [...root.querySelectorAll('.ebg-item')];
    const index = list.indexOf(document.activeElement);
    if (index < 0) return;
    const last = list.length - 1;
    const target = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    list[target].focus();
  });

  // Re-measure when the font arrives or the breakpoint changes the geometry.
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
  for (const node of nodes.values()) node.sizers.forEach((sizer) => observer?.observe(sizer));
  const narrow = window.matchMedia('(max-width: 767px)');
  narrow.addEventListener('change', measure);

  paint();
  return {
    el: root,
    measure,
    confirm,
    /** Call when the group leaves the page. */
    destroy() {
      clearTimeout(timer);
      observer?.disconnect();
      narrow.removeEventListener('change', measure);
      document.removeEventListener('pointerdown', onOutsideDown, true);
    },
    /** True while an action runs or its confirmation shows: the caller should keep the group on screen. */
    get holding() {
      return Boolean(state.done || state.busy);
    },
    /** Enables or disables actions by id (they stay focusable and still reveal their label). */
    setDisabled(ids, disabled) {
      for (const id of ids) {
        const node = nodes.get(id);
        if (node) node.item.disabled = disabled;
      }
      paint();
    },
  };
}
