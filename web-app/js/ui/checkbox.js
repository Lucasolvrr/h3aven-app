// Checkbox (after uiarc's Checkbox): the fill grows in while the check draws;
// "mixed" (some of a group chosen) morphs the same mark into a dash.
//
//   const box = checkbox({ label: 'Design', checked: true, onChange: (next) => … });
//   box.set(true | false | 'mixed');
//
// A button with role="checkbox" and aria-checked (true / false / mixed); the
// hit area is larger than the drawn box. Space and click toggle it.

import { h } from '../lib/dom.js';

const MARK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="cbx-tick" pathLength="1" d="M4 8.4l2.7 2.7L12 5.6"/><path class="cbx-dash" pathLength="1" d="M4.5 8h7"/></svg>';

export function checkbox({ label, checked = false, onChange }) {
  let state = checked;
  const el = h('button', { type: 'button', class: 'cbx', role: 'checkbox', 'aria-label': label }, h('span', { class: 'cbx-box', html: MARK }));
  const paint = () => el.setAttribute('aria-checked', state === 'mixed' ? 'mixed' : String(Boolean(state)));
  el.addEventListener('click', (event) => {
    event.stopPropagation(); // a checkbox inside a clickable row doesn't also press the row
    state = state === true ? false : true; // mixed → checked, like a parent row
    paint();
    onChange?.(state);
  });
  paint();
  return {
    el,
    set(next) {
      state = next;
      paint();
    },
    get checked() {
      return state;
    },
  };
}
