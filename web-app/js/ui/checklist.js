// Onboarding checklist: a getting-started card with a progress ring, steps
// that open to show what to do (with an action), and a folding group of the
// ones already done. After uiarc's onboarding-checklist, in plain DOM.
//
//   const list = createChecklist({ title, doneTitle, steps, hidden, onHiddenChange, onToggle })
//   list.update({ done: { stepId: true, … }, auto: { stepId: true, … } })   // keep the same element, animate changes
//   list.update(progress, { instant: true })                               // place without the tick-and-fold
//
// steps: [{ id, title, description?, actionLabel?, onAction?() }]
// done: which steps are complete. auto: those whose completion comes from the
//   app itself (they can't be unticked by hand). onToggle(id, done) for the rest.
// onAction may return a promise; a thrown Error keeps the step open and shows its message.
// onComplete() runs once the last step has been finished (not when the card starts out complete).

import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

const FOLD_DELAY = 720; // ms a finished step stays in place before folding into "completed"
const RING = 2 * Math.PI * 15; // circumference of the r=15 ring
let uid = 0;

const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ocl-tick" pathLength="1" d="M3.5 8.5l3 3 6-7"/></svg>';

export function createChecklist({ title, doneTitle = 'You’re all set', steps, hidden = false, onHiddenChange, onToggle, onComplete }) {
  const id = `ocl-${++uid}`;
  const state = { done: {}, auto: {}, folded: new Set(), open: null, hidden, showCompleted: false, errors: {}, busy: null };
  const timers = new Map();

  // --- header: ring, title, count, Hide ---
  const ring = h('div', { class: 'ocl-ring', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length) });
  ring.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ocl-ring-track" cx="18" cy="18" r="15"/><circle class="ocl-ring-fill" cx="18" cy="18" r="15" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/></svg><span class="ocl-ring-tick">${TICK}</span>`;
  const titleEl = h('h2', { class: 'ocl-title', id: `${id}-title` });
  const countEl = h('p', { class: 'ocl-count' });
  const hideLabel = h('span', { class: 'ocl-hide-label' });
  const hideBtn = h('button', { type: 'button', class: 'ocl-hide', 'aria-controls': `${id}-body` }, hideLabel, iconEl('chevron-down', 15));
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const alert = h('p', { class: 'sr-only', role: 'alert' });

  // --- body: pending steps, then the completed group ---
  const list = h('ul', { class: 'ocl-list' });
  const doneList = h('ul', { class: 'ocl-list ocl-done-list', id: `${id}-done` });
  const doneToggle = h('button', { type: 'button', class: 'ocl-done-toggle', 'aria-controls': `${id}-done` }, h('span', null), iconEl('chevron-down', 15));
  // Each folding part has one inner child: grid-template-rows 0fr -> 1fr animates its height.
  const doneGroup = h('div', { class: 'ocl-done' }, doneToggle, h('div', { class: 'ocl-done-wrap' }, doneList));
  const body = h('div', { class: 'ocl-body', id: `${id}-body` }, h('div', { class: 'ocl-body-inner' }, list, doneGroup));

  const card = h(
    'section',
    { class: 'ocl', 'aria-labelledby': `${id}-title` },
    h('header', { class: 'ocl-head' }, ring, h('div', { class: 'ocl-head-text' }, titleEl, countEl), hideBtn),
    body,
    live,
    alert
  );

  // One row per step, built once and moved between the two lists.
  const rows = new Map();
  for (const step of steps) {
    const check = h('button', { type: 'button', class: 'ocl-check', role: 'checkbox', 'aria-checked': 'false', 'aria-label': step.title });
    check.innerHTML = TICK;
    const panelId = `${id}-${step.id}`;
    const titleBtn = h('button', { type: 'button', class: 'ocl-step-title', 'aria-expanded': 'false', 'aria-controls': panelId }, step.title);
    const error = h('p', { class: 'ocl-error', hidden: true });
    const action =
      step.actionLabel &&
      h('button', { type: 'button', class: 'ocl-action' }, h('span', null, step.actionLabel), iconEl('arrow-right', 14));
    const panel = h(
      'div',
      { class: 'ocl-panel', id: panelId, role: 'region', 'aria-label': step.title },
      h('div', { class: 'ocl-panel-inner' }, step.description && h('p', { class: 'ocl-desc' }, step.description), error, action)
    );
    const li = h('li', { class: 'ocl-step', dataset: { id: step.id } }, check, h('div', { class: 'ocl-step-main' }, titleBtn, panel));
    rows.set(step.id, { step, li, check, titleBtn, panel, action, error });

    check.addEventListener('click', () => {
      if (state.auto[step.id]) return; // done by the app itself: it stays done
      onToggle?.(step.id, !state.done[step.id]);
    });
    titleBtn.addEventListener('click', () => {
      state.open = state.open === step.id ? null : step.id;
      paint();
    });
    action?.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = step.id;
      state.errors[step.id] = '';
      paint();
      try {
        await step.onAction?.();
      } catch (err) {
        state.errors[step.id] = err?.message || 'That didn’t work. Try again.';
        alert.textContent = state.errors[step.id];
      } finally {
        state.busy = null;
        paint();
      }
    });
  }

  hideBtn.addEventListener('click', () => {
    state.hidden = !state.hidden;
    onHiddenChange?.(state.hidden);
    paint();
  });
  doneToggle.addEventListener('click', () => {
    state.showCompleted = !state.showCompleted;
    paint();
  });

  // Arrow keys move between step titles.
  body.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const titles = [...body.querySelectorAll('.ocl-step-title')].filter((el) => el.offsetParent !== null);
    const index = titles.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const last = titles.length - 1;
    const next = { ArrowDown: Math.min(last, index + 1), ArrowUp: Math.max(0, index - 1), Home: 0, End: last }[event.key];
    titles[next].focus();
  });

  function paint() {
    const doneCount = steps.filter((step) => state.done[step.id]).length;
    const all = doneCount === steps.length;

    titleEl.textContent = all ? doneTitle : title;
    countEl.textContent = `${doneCount} of ${steps.length} done`;
    ring.setAttribute('aria-valuenow', String(doneCount));
    ring.setAttribute('aria-valuetext', `${doneCount} of ${steps.length} steps done`);
    ring.querySelector('.ocl-ring-fill').setAttribute('stroke-dashoffset', String(RING * (1 - doneCount / steps.length)));
    card.classList.toggle('is-complete', all);

    hideLabel.textContent = state.hidden ? 'Show' : 'Hide';
    hideBtn.setAttribute('aria-expanded', String(!state.hidden));
    card.classList.toggle('is-hidden', state.hidden);
    body.inert = state.hidden;

    // Pending first (in step order), then the folded ones under "N completed".
    const pending = steps.filter((step) => !state.folded.has(step.id));
    const folded = steps.filter((step) => state.folded.has(step.id));
    if (!pending.some((step) => step.id === state.open)) state.open = pending.find((step) => !state.done[step.id])?.id ?? null;

    // Only move rows when the lists really change: moving a node drops its focus.
    const place = (target, items) => {
      const nodes = items.map((step) => rows.get(step.id).li);
      if (nodes.length !== target.children.length || nodes.some((node, i) => target.children[i] !== node)) target.replaceChildren(...nodes);
    };
    place(list, pending);
    place(doneList, folded);
    doneGroup.hidden = folded.length === 0;
    doneToggle.firstChild.textContent = `${folded.length} completed`;
    doneToggle.setAttribute('aria-expanded', String(state.showCompleted));
    doneGroup.classList.toggle('is-open', state.showCompleted);
    doneList.inert = !state.showCompleted;

    for (const [stepId, row] of rows) {
      const isDone = Boolean(state.done[stepId]);
      const isOpen = state.open === stepId && !state.folded.has(stepId);
      row.li.classList.toggle('is-done', isDone);
      row.li.classList.toggle('is-open', isOpen);
      row.check.setAttribute('aria-checked', String(isDone));
      row.check.toggleAttribute('aria-disabled', Boolean(state.auto[stepId]));
      row.check.title = state.auto[stepId] ? 'Done' : isDone ? 'Mark as not done' : 'Mark as done';
      row.titleBtn.setAttribute('aria-expanded', String(isOpen));
      row.panel.inert = !isOpen;
      row.error.hidden = !state.errors[stepId];
      row.error.textContent = state.errors[stepId] || '';
      if (row.action) {
        row.action.disabled = state.busy === stepId;
        row.action.hidden = isDone;
      }
    }
  }

  /**
   * New completion state. Steps that just finished tick in place, then fold
   * into "completed" after a moment; on the first call everything is placed at once.
   */
  let first = true;
  function update({ done = {}, auto = {} } = {}, { instant = false } = {}) {
    const before = { ...state.done };
    const allBefore = steps.every((step) => before[step.id]);
    const allNow = steps.every((step) => done[step.id]);
    state.done = { ...done };
    state.auto = { ...auto };
    for (const step of steps) {
      const now = Boolean(done[step.id]);
      if (!now) {
        clearTimeout(timers.get(step.id));
        timers.delete(step.id);
        state.folded.delete(step.id);
        continue;
      }
      if (state.folded.has(step.id) || timers.has(step.id)) continue;
      if (first || instant || before[step.id]) {
        state.folded.add(step.id);
        continue;
      }
      // Just finished: tick now, fold in a moment, and say so.
      const doneCount = steps.filter((s) => done[s.id]).length;
      live.textContent = `${step.title}: done. ${doneCount} of ${steps.length} steps done.`;
      const wasFocused = rows.get(step.id).li.contains(document.activeElement);
      timers.set(
        step.id,
        setTimeout(() => {
          timers.delete(step.id);
          state.folded.add(step.id);
          if (state.open === step.id) state.open = null;
          paint();
          // Keep the keyboard where the next thing to do is.
          if (wasFocused) {
            const next = steps.find((s) => !state.done[s.id]);
            const target = next && (rows.get(next.id).action || rows.get(next.id).titleBtn);
            target?.focus();
          }
        }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : FOLD_DELAY)
      );
    }
    // Just finished the last one: celebrate once it has folded away.
    if (!first && !instant && allNow && !allBefore && onComplete) {
      setTimeout(onComplete, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : FOLD_DELAY + 120);
    }
    first = false;
    paint();
  }

  return { el: card, update };
}
