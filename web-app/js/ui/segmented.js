// Segmented tabs (after uiarc's billing toggle): a rounded track with one
// thumb that glides to the selected option on a non-overshooting curve.
// Each option may carry a small badge (a count, say).
//
//   segmentedTabs({ id, label, items: [{ key, label, href, badge }], active })
//
// Views are rebuilt on every navigation, so the thumb's last position is kept
// per `id`: the new thumb starts there and glides to the new option.

import { h } from '../lib/dom.js';

const last = new Map(); // id -> { x, width }

export function segmentedTabs({ id, label, items, active }) {
  const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
  const links = items.map((item) =>
    h(
      'a',
      { class: 'seg-option', href: item.href, 'aria-current': item.key === active ? 'page' : null, dataset: { key: item.key } },
      h('span', { class: 'seg-label' }, item.label),
      item.badge !== undefined && item.badge !== null && h('span', { class: 'seg-badge' }, String(item.badge))
    )
  );
  const root = h('nav', { class: 'seg', 'aria-label': label }, thumb, links);

  // Arrow keys move between options, like a radio group.
  root.addEventListener('keydown', (event) => {
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : step ? (index + step + links.length) % links.length : -1;
    if (target < 0) return;
    event.preventDefault();
    links[target].focus();
  });

  // Place the thumb once the bar is in the page: from where it was, to the active option.
  const place = () => {
    const current = links.find((link) => link.dataset.key === active);
    if (!current || !root.isConnected) return false;
    const to = { x: current.offsetLeft, width: current.offsetWidth };
    const from = last.get(id);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (from && !reduced && (from.x !== to.x || from.width !== to.width)) {
      thumb.style.transition = 'none';
      thumb.style.transform = `translateX(${from.x}px)`;
      thumb.style.width = `${from.width}px`;
      void thumb.offsetWidth; // commit the start before gliding
      thumb.style.transition = '';
    }
    thumb.style.transform = `translateX(${to.x}px)`;
    thumb.style.width = `${to.width}px`;
    root.classList.add('is-placed');
    last.set(id, to);
    return true;
  };
  // Mounted by the caller right after this returns; try again on the next tick if not yet.
  queueMicrotask(() => place() || setTimeout(place, 0));
  // Only a real change of size snaps the thumb (the observer also fires once on start).
  let seenWidth = null;
  new ResizeObserver(() => {
    const width = root.offsetWidth;
    const changed = seenWidth !== null && width !== seenWidth;
    seenWidth = width;
    const current = links.find((link) => link.dataset.key === active);
    if (changed && current && root.classList.contains('is-placed')) {
      thumb.style.transition = 'none';
      thumb.style.transform = `translateX(${current.offsetLeft}px)`;
      thumb.style.width = `${current.offsetWidth}px`;
      void thumb.offsetWidth;
      thumb.style.transition = '';
      last.set(id, { x: current.offsetLeft, width: current.offsetWidth });
    }
  }).observe(root);
  return root;
}

/**
 * The same control for choices made in place (no navigation): buttons with a
 * thumb that glides to the pressed one. onChange(key) after each choice.
 */
export function segmentedControl({ label, items, value, onChange, size = 'md' }) {
  let current = value;
  const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
  const buttons = items.map((item) =>
    h('button', { type: 'button', class: 'seg-option', role: 'radio', 'aria-checked': String(item.key === current), tabindex: item.key === current ? '0' : '-1', dataset: { key: item.key } }, h('span', { class: 'seg-label' }, item.label))
  );
  const root = h('div', { class: `seg is-${size}`, role: 'radiogroup', 'aria-label': label }, thumb, buttons);

  const place = (animate) => {
    const active = buttons.find((button) => button.dataset.key === current);
    if (!active || !root.isConnected || !active.offsetWidth) return false;
    if (!animate) thumb.style.transition = 'none';
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    thumb.style.width = `${active.offsetWidth}px`;
    if (!animate) {
      void thumb.offsetWidth;
      thumb.style.transition = '';
    }
    root.classList.add('is-placed');
    return true;
  };
  const choose = (key, focus = false) => {
    if (key === current) return;
    current = key;
    for (const button of buttons) {
      const on = button.dataset.key === key;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    }
    place(true);
    onChange?.(key);
  };
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.key)));
  root.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : step ? (index + step + buttons.length) % buttons.length : -1;
    if (target < 0) return;
    event.preventDefault();
    choose(buttons[target].dataset.key, true);
  });
  // Placed once it is in the page (and has a size); a dialog may still be opening.
  const tryPlace = (tries = 0) => place(false) || (tries < 20 && setTimeout(() => tryPlace(tries + 1), 16));
  queueMicrotask(() => tryPlace());
  return { el: root, get value() { return current; }, set: (key) => choose(key) };
}
