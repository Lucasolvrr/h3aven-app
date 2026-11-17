// Text shimmer: a calm band of light sweeping over a short status line while
// work is going on (after uiarc's text-shimmer). The text stays real text.
//
//   const label = textShimmer('Reading your bookmarks');
//   label.set('Saving 120 of 493', { active: true });   // a new label rises in
//   label.set('Imported 493 links', { active: false }); // the sweep stops, text settles
//
// The sweep is one background-clip gradient (CSS: .text-shimmer), paused by
// reduced motion and dropped in forced-colors mode.

import { h } from '../lib/dom.js';

export function textShimmer(text, { active = true, as = 'span', className = '' } = {}) {
  const el = h(as, { class: `text-shimmer ${className}`.trim() });
  let current = null;

  const set = (next, { active: on = true } = {}) => {
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-busy', String(on));
    if (next === current) return;
    const first = current === null;
    current = next;
    el.textContent = next;
    if (!first) {
      // A changed label rises in with a soft blur.
      el.classList.remove('is-changing');
      void el.offsetWidth;
      el.classList.add('is-changing');
    }
  };

  set(text, { active });
  return { el, set };
}
