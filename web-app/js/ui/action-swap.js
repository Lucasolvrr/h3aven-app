// Action swap (after uiarc's action-swap): one pill that changes state in
// place — label, icon and tone morph together while the width follows on a
// smooth curve. Async work shows a working phase; a failure shows briefly in
// place, then the pill settles back.
//
//   const pill = actionSwap({ state: { label: 'Connect', icon: 'link', tone: 'accent' }, onPress });
//   pill.set({ label: 'Connected', icon: 'check', tone: 'success' });
//   await pill.run(() => doWork(), { pendingLabel: 'Connecting', done: {...}, failureLabel: 'Try again' });
//
// tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

const MIN_WORKING = 450; // ms: the working state never just flickers
const FAILURE_FOR = 1800;
const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="aswap-wipe" pathLength="1" d="M3.5 8.5l3 3 6-7"/></svg>';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function actionSwap({ state, onPress, className = '' }) {
  const iconSlot = h('span', { class: 'aswap-icon', 'aria-hidden': 'true' });
  const labelSlot = h('span', { class: 'aswap-label', 'aria-hidden': 'true' });
  const live = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const button = h('button', { type: 'button', class: `aswap ${className}`.trim() }, iconSlot, labelSlot);
  const root = h('span', { class: 'aswap-wrap' }, button, live);
  let current = null;
  let busy = false;

  function glyph(next) {
    if (next.busy) return h('span', { class: 'aswap-spinner' });
    if (next.icon === 'check' && next.tone === 'success') return h('span', { class: 'aswap-check', html: CHECK }); // drawn in with a wipe
    return next.icon ? iconEl(next.icon, 15) : null;
  }

  /** Moves to `next`; the old label and icon leave as the new ones rise in, and the width follows. */
  function set(next, { announce = true } = {}) {
    const from = button.isConnected ? button.offsetWidth : 0;
    current = next;
    button.dataset.tone = next.tone || 'neutral';
    button.setAttribute('aria-label', next.label);
    button.toggleAttribute('aria-busy', Boolean(next.busy));
    button.toggleAttribute('aria-disabled', Boolean(next.busy));

    const icon = glyph(next);
    iconSlot.hidden = !icon;
    iconSlot.replaceChildren(...(icon ? [icon] : []));
    for (const old of [...labelSlot.children]) {
      old.classList.add('is-leaving');
      setTimeout(() => old.remove(), 180);
    }
    const word = h('span', { class: 'aswap-word' }, next.label);
    labelSlot.append(word);
    if (from && !reduced()) {
      word.classList.add('is-entering');
      // Measure the new natural width, then glide to it from the old one.
      button.style.width = 'auto';
      const leaving = [...labelSlot.querySelectorAll('.is-leaving')];
      leaving.forEach((el) => (el.style.display = 'none'));
      const to = button.offsetWidth;
      leaving.forEach((el) => (el.style.display = ''));
      button.style.width = `${from}px`;
      void button.offsetWidth;
      button.style.width = `${to}px`;
    } else {
      button.style.width = '';
    }
    if (announce) live.textContent = next.label;
  }

  /** Runs `work` with a working state; resolves true on success. A failure shows `failureLabel`, then returns to where it was. */
  async function run(work, { pendingLabel, done, failureLabel = 'Try again' } = {}) {
    if (busy) return false;
    busy = true;
    const before = current;
    set({ label: pendingLabel || before.label, tone: before.tone, busy: true });
    const started = performance.now();
    try {
      await work();
      const left = MIN_WORKING - (performance.now() - started);
      if (left > 0) await wait(left);
      set(done || before);
      return true;
    } catch (error) {
      const left = MIN_WORKING - (performance.now() - started);
      if (left > 0) await wait(left);
      set({ label: failureLabel, icon: 'alert', tone: 'danger' });
      live.textContent = `${failureLabel}. ${error?.message || ''}`.trim();
      await wait(FAILURE_FOR);
      set(before, { announce: false });
      return false;
    } finally {
      busy = false;
    }
  }

  button.addEventListener('click', () => {
    if (busy) return;
    onPress?.(current);
  });

  set(state, { announce: false });
  return { el: root, button, set, run, get state() { return current; } };
}
