// Morphing tabs: a rail of tabs and the panel under it drawn as one shape.
//
// The selected tab has no background of its own. A single surface (an SVG
// "bump" sitting on the panel's top edge, in the panel's colour) rises under
// it and flows into the panel with concave joins, so the tab reads as part of
// the content. Choosing another tab slides and resizes that bump across the
// rail while the content underneath fades through.
//
// Views are rebuilt on every route change, so the previous bump position is
// remembered here and the new instance animates from it.

import { h, formatNumber } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

const TAB_HEIGHT = 44;
const JOIN = 18; // how far the concave joins reach out on each side of the tab
const RADIUS = 16;
const SLIDE_MS = 440;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Last bump of each tab set: { key, x, width, scroll } by set id. */
const memory = new Map();

/** The bump for a tab `width` wide. Drawn in a box of width + 2 × JOIN. */
function bumpPath(width) {
  const total = width + JOIN * 2;
  const bottom = TAB_HEIGHT;
  const k = JOIN * 0.55;
  const r = Math.min(RADIUS, width / 2);
  const left = JOIN;
  const right = JOIN + width;
  return [
    `M0 ${bottom}`,
    `C${k} ${bottom} ${left} ${bottom - JOIN + k} ${left} ${bottom - JOIN}`,
    `V${r}`,
    `Q${left} 0 ${left + r} 0`,
    `H${right - r}`,
    `Q${right} 0 ${right} ${r}`,
    `V${bottom - JOIN}`,
    `C${right} ${bottom - JOIN + k} ${total - k} ${bottom} ${total} ${bottom}`,
    // one extra pixel down, so no seam shows between the bump and the panel
    `V${bottom + 1} H0 Z`,
  ].join(' ');
}

/**
 * id: stable name of the tab set (e.g. the category id)
 * tabs: [{ key, label, count, href, tint }] — tint is an inline style for a colour dot
 * activeKey: key of the selected tab
 * trailing: optional element after the tabs (e.g. an add button)
 * panel: content of the selected tab (node or array)
 */
export function morphingTabs({ id, label, tabs, activeKey, trailing, panel }) {
  const previous = memory.get(id);
  const switched = Boolean(previous && previous.key !== activeKey);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  const bump = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  bump.setAttribute('class', 'mtabs-bump');
  bump.setAttribute('aria-hidden', 'true');
  bump.setAttribute('focusable', 'false');
  bump.append(path);

  const tabEls = new Map();
  const track = h(
    'div',
    { class: 'mtabs-track', role: 'tablist', 'aria-label': label, 'aria-orientation': 'horizontal' },
    tabs.map((tab) => {
      const selected = tab.key === activeKey;
      const el = h(
        'a',
        {
          class: 'mtab', href: tab.href, role: 'tab', id: `mtab-${id}-${tab.key}`,
          'aria-selected': String(selected), 'aria-controls': `mtabs-panel-${id}`, tabindex: selected ? '0' : '-1',
        },
        tab.tint && h('span', { class: 'mtab-dot', style: tab.tint, 'aria-hidden': 'true' }),
        h('span', { class: 'mtab-label' }, tab.label),
        h('span', { class: 'mtab-count' }, formatNumber(tab.count))
      );
      tabEls.set(tab.key, el);
      return el;
    }),
    trailing
  );
  track.prepend(bump);

  const rail = h('div', { class: 'mtabs-rail' }, track);
  const content = h('div', { class: 'mtabs-content' }, panel);
  const root = h(
    'div',
    { class: 'mtabs' },
    rail,
    h('div', { class: 'mtabs-panel', role: 'tabpanel', id: `mtabs-panel-${id}`, 'aria-labelledby': `mtab-${id}-${activeKey}` }, content)
  );

  // Left / right move between tabs, as in any tab list.
  track.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = tabs.findIndex((tab) => tab.key === activeKey);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next || next.key === activeKey) return;
    event.preventDefault();
    sessionStorage.setItem('mtabs-focus', '1');
    location.hash = next.href;
  });

  const draw = (x, width) => {
    bump.setAttribute('width', String(width + JOIN * 2));
    bump.setAttribute('height', String(TAB_HEIGHT + 1));
    bump.setAttribute('viewBox', `0 0 ${width + JOIN * 2} ${TAB_HEIGHT + 1}`);
    bump.style.transform = `translateX(${x - JOIN}px)`;
    path.setAttribute('d', bumpPath(width));
  };

  let frame = 0;
  const target = () => {
    const el = tabEls.get(activeKey) || tabEls.values().next().value;
    return el ? { x: el.offsetLeft, width: el.offsetWidth } : null;
  };
  const remember = () => {
    const to = target();
    if (to) memory.set(id, { key: activeKey, x: to.x, width: to.width, scroll: rail.scrollLeft });
  };

  /** Runs once the view is in the document and has a layout. */
  const settle = () => {
    if (!root.isConnected) return;
    const to = target();
    if (!to) return;
    if (previous) rail.scrollLeft = previous.scroll;

    if (switched && !reducedMotion.matches) {
      // The surface glides from the tab it was under to the new one…
      const from = previous;
      const start = performance.now();
      const step = (now) => {
        if (!root.isConnected) return;
        const t = Math.min(1, (now - start) / SLIDE_MS);
        const eased = 1 - Math.pow(1 - t, 4);
        draw(from.x + (to.x - from.x) * eased, from.width + (to.width - from.width) * eased);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      draw(from.x, from.width);
      frame = requestAnimationFrame(step);
      // …and the content arrives through a short blur, not as a new page.
      content.animate(
        [{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 300, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
      );
    } else {
      draw(to.x, to.width);
    }

    // Keep the selected tab fully in view on a crowded rail.
    const el = tabEls.get(activeKey);
    if (el) {
      const left = el.offsetLeft - JOIN;
      const right = el.offsetLeft + el.offsetWidth + JOIN;
      if (left < rail.scrollLeft) rail.scrollTo({ left, behavior: switched && !reducedMotion.matches ? 'smooth' : 'auto' });
      else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: right - rail.clientWidth, behavior: switched && !reducedMotion.matches ? 'smooth' : 'auto' });
      if (sessionStorage.getItem('mtabs-focus')) {
        sessionStorage.removeItem('mtabs-focus');
        el.focus({ preventScroll: true });
      }
    }
    remember();
  };
  requestAnimationFrame(settle);

  rail.addEventListener('scroll', remember, { passive: true });
  // Fonts loading or the panel resizing change tab widths: follow without animating.
  let observed = false;
  new ResizeObserver(() => {
    // The first call only reports the initial size; it must not cut the slide short.
    if (!observed) return void (observed = true);
    if (!root.isConnected || !bump.hasAttribute('width')) return;
    cancelAnimationFrame(frame);
    const to = target();
    if (to) draw(to.x, to.width);
    remember();
  }).observe(track);

  return root;
}

/** Drop the remembered bump of a tab set, so its next appearance starts fresh instead of sliding in. */
export function forgetTabs(id) {
  memory.delete(id);
}

/** The small "+" that sits after the tabs. */
export function tabAddButton(label, onClick) {
  return h('button', { type: 'button', class: 'mtab-add', 'aria-label': label, title: label, onClick }, iconEl('plus', 16));
}
