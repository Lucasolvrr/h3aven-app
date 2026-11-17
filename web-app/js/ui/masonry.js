// Masonry grid + bookmark cards.
//
// Layout strategy (not CSS columns, not a fixed-row grid):
//   - cards are absolutely positioned, each one the width of a column
//   - items are placed in list order into the currently shortest column
//     (leftmost wins ties), so a newest-first list reads left-to-right,
//     top-to-bottom and stays that way when heights change
//   - heights are the cards' real rendered heights; a thumbnail keeps the
//     proportions of its image, and that ratio is remembered per image so
//     the grid is stable on the next visit
//
// Column counts: 4 on desktop, 2 on phones, 3 in between.

import { STORAGE } from '../config.js';
import { h, readJson, writeJson, debounce } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { faviconFor } from '../lib/url.js';
import { select } from '../data/store.js';
import { selection } from './selection.js';

export function columnsFor(width = window.innerWidth) {
  if (width >= 1200) return 4;
  if (width >= 640) return 3;
  return 2;
}

const PAGE = 48;
const DEFAULT_RATIO = 1.5;
const MIN_RATIO = 0.6; // very tall screenshots are cropped past this
const MAX_RATIO = 2.4;

const ratioCache = readJson(STORAGE.aspect, {});
const persistRatios = debounce(() => {
  const keys = Object.keys(ratioCache);
  // Keep the cache bounded: drop the oldest entries first.
  for (const key of keys.slice(0, Math.max(0, keys.length - 1500))) delete ratioCache[key];
  writeJson(STORAGE.aspect, ratioCache);
}, 800);

/** Width / height of a thumbnail as last measured here, if known. */
export const knownRatio = (url) => (url && ratioCache[url]) || null;

// --- card ----------------------------------------------------------------------

export function fallbackTile(bookmark) {
  const letter = (bookmark.domain || bookmark.title || '?').charAt(0);
  const iconBox = h('div', { class: 'bm-fallback-icon' });
  const src = bookmark.favicon || faviconFor(bookmark.domain);
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => iconBox.replaceChildren(letter));
    iconBox.append(img);
  } else {
    iconBox.append(letter);
  }
  return h('div', { class: 'bm-fallback' }, iconBox, h('div', { class: 'bm-fallback-domain' }, bookmark.domain || 'Saved link'));
}

function faviconImg(bookmark, className) {
  const src = bookmark.favicon || faviconFor(bookmark.domain);
  if (!src) return null;
  const img = h('img', { class: className, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(iconEl('globe', 14, `${className} muted`)));
  return img;
}

function signature(b) {
  return [b.title, b.domain, b.thumbnail, b.favicon, b.isFavorite, b.status, select.locationLabel(b), b.categoryId].join('\u0001');
}

function buildCard(bookmark, requestLayout) {
  const title = bookmark.title || bookmark.domain || bookmark.url;
  const place = select.locationLabel(bookmark);
  const placeIcon = bookmark.categoryId ? select.category(bookmark.categoryId)?.icon || 'folder' : 'inbox';
  const thumb = h('div', { class: 'bm-thumb' });
  const setRatio = (ratio) => thumb.style.setProperty('--ar', String(ratio));

  const showFallback = () => {
    thumb.classList.remove('is-loading');
    setRatio(DEFAULT_RATIO);
    thumb.prepend(fallbackTile(bookmark));
    if (bookmark.status === 'failed') {
      thumb.append(h('span', { class: 'bm-badge' }, iconEl('alert', 12), 'Unavailable'));
    }
  };

  if (bookmark.thumbnail) {
    const known = ratioCache[bookmark.thumbnail];
    setRatio(known || DEFAULT_RATIO);
    thumb.classList.add('is-loading');
    const img = h('img', { class: 'bm-image', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: bookmark.thumbnail });
    img.addEventListener('load', () => {
      thumb.classList.remove('is-loading');
      thumb.classList.add('is-loaded');
      if (!img.naturalWidth || !img.naturalHeight) return;
      const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, img.naturalWidth / img.naturalHeight));
      const rounded = Math.round(ratio * 100) / 100;
      if (known !== rounded) {
        ratioCache[bookmark.thumbnail] = rounded;
        persistRatios();
        setRatio(rounded);
        requestLayout();
      }
    });
    // The backing behind the title on hover: the same picture, blurred. It is
    // bigger than the card and clipped by it, so the soft blurred edges fall
    // outside instead of leaving a light rim (which backdrop-filter did).
    const veil = h('div', { class: 'bm-veil', 'aria-hidden': 'true' }, h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: bookmark.thumbnail }));
    img.addEventListener('error', () => {
      img.remove();
      veil.remove();
      showFallback();
      requestLayout();
    });
    thumb.append(img, veil);
  } else if (bookmark.status === 'pending') {
    // Metadata is still being fetched.
    setRatio(DEFAULT_RATIO);
    thumb.classList.add('is-loading');
  } else {
    showFallback();
  }

  // Everything about the bookmark lives on the image and shows on hover:
  // where it is saved (click to move it) and a tick to select at the top,
  // title, site and the two actions at the bottom.
  thumb.append(
    h(
      'div',
      { class: 'bm-top' },
      h(
        'button',
        { type: 'button', class: 'bm-place', dataset: { act: 'move' }, 'aria-haspopup': 'menu', 'aria-label': `Saved in ${place}. Move to another place`, title: 'Move to…' },
        iconEl(placeIcon, 14),
        h('span', { class: 'bm-place-label' }, place),
        iconEl('chevron-down', 13)
      ),
      h('button', { type: 'button', class: 'bm-check', dataset: { act: 'select' }, 'aria-label': 'Select bookmark' }, iconEl('check', 13))
    ),
    h(
      'div',
      { class: 'bm-bottom' },
      h(
        'div',
        { class: 'bm-info' },
        faviconImg(bookmark, 'bm-favicon'),
        h('div', { class: 'bm-text' }, h('h3', { class: 'bm-title' }, title), h('p', { class: 'bm-domain' }, bookmark.domain))
      ),
      h(
        'div',
        { class: 'bm-actions' },
        // Open first, heart last: a favourite's heart stays visible when the
        // card is not hovered, so it sits in the corner rather than floating.
        h('button', { type: 'button', class: 'bm-act', dataset: { act: 'open' }, 'aria-label': 'Open link in a new tab' }, iconEl('arrow-up-right', 15)),
        h(
          'button',
          {
            type: 'button',
            class: `bm-act${bookmark.isFavorite ? ' is-on' : ''}`,
            dataset: { act: 'favorite' },
            'aria-label': bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites',
            'aria-pressed': String(bookmark.isFavorite),
          },
          iconEl('heart', 15)
        )
      )
    )
  );

  return h('article', { class: 'bm-card', tabindex: '0', 'aria-label': `${title}, ${bookmark.domain}. Press Enter to open`, dataset: { id: bookmark.id } }, thumb);
}

// --- grid ----------------------------------------------------------------------

export class Masonry {
  /** handlers: { onOpen(id), onFavorite(id), onOpenLink(id), onMove(id, anchorEl) } */
  constructor(handlers) {
    this.handlers = handlers;
    this.items = [];
    this.limit = PAGE;
    this.cards = new Map(); // id -> { el, sig }
    this.lastWidth = 0;
    this.frame = 0;

    this.el = h('div', { class: 'masonry' });
    this.sentinel = h('div', { class: 'masonry-more', hidden: true });
    this.root = h('div', null, this.el, this.sentinel);
    this.requestLayout = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.layout();
      });
    };

    this.el.addEventListener('click', (event) => this.onClick(event));
    this.el.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('bm-card')) {
        event.preventDefault();
        this.activate(event.target.dataset.id);
      }
    });

    new ResizeObserver(() => {
      const width = this.el.clientWidth;
      if (width && width !== this.lastWidth) this.layout();
    }).observe(this.el);

    new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && this.limit < this.items.length) {
          this.limit += PAGE;
          this.sync();
        }
      },
      { rootMargin: '900px 0px' }
    ).observe(this.sentinel);

    selection.subscribe(() => this.paintSelection());
  }

  /** `fresh` = a different list (route change): restart paging, no move animation. */
  setItems(items, { fresh = false } = {}) {
    this.items = items;
    if (fresh) {
      this.limit = PAGE;
      this.el.classList.remove('is-settled');
    }
    this.sync();
  }

  sync() {
    const visible = this.items.slice(0, this.limit);
    const nodes = visible.map((bookmark) => {
      const sig = signature(bookmark);
      let card = this.cards.get(bookmark.id);
      if (!card || card.sig !== sig) {
        card = { el: buildCard(bookmark, this.requestLayout), sig };
        this.cards.set(bookmark.id, card);
      }
      return card.el;
    });
    this.el.replaceChildren(...nodes);
    this.sentinel.hidden = this.limit >= this.items.length;

    // Forget cards for bookmarks that are gone, so the cache can't grow forever.
    if (this.cards.size > 600) {
      const keep = new Set(this.items.map((b) => b.id));
      for (const id of this.cards.keys()) if (!keep.has(id)) this.cards.delete(id);
    }

    this.paintSelection();
    this.layout();
  }

  layout() {
    const width = this.el.clientWidth;
    if (!width) return; // not attached yet; the ResizeObserver will call back
    this.lastWidth = width;
    const columns = columnsFor();
    const gap = columns === 2 ? 10 : columns === 3 ? 14 : 16;
    const columnWidth = (width - gap * (columns - 1)) / columns;
    const cards = [...this.el.children];
    // Narrow cards drop the favicon so the title keeps its room (see components.css).
    this.el.classList.toggle('is-narrow', columnWidth < 230);

    for (const card of cards) card.style.width = `${columnWidth}px`;
    const heights = cards.map((card) => card.offsetHeight); // one reflow for all reads

    const tops = new Array(columns).fill(0);
    cards.forEach((card, index) => {
      let column = 0;
      for (let c = 1; c < columns; c += 1) if (tops[c] < tops[column] - 0.5) column = c;
      card.style.transform = `translate(${Math.round(column * (columnWidth + gap))}px, ${Math.round(tops[column])}px)`;
      tops[column] += heights[index] + gap;
    });
    this.el.style.height = `${Math.max(0, Math.max(...tops) - gap)}px`;

    // Cards only glide to new positions once the first layout has calmed down
    // (fonts, scrollbar and first images all nudge heights right after load).
    if (!this.el.classList.contains('is-settled')) {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.el.classList.add('is-settled'), 700);
    }
  }

  paintSelection() {
    this.el.classList.toggle('is-selecting', selection.active);
    for (const [id, card] of this.cards) {
      const on = selection.has(id);
      if (card.el.classList.contains('is-selected') !== on) card.el.classList.toggle('is-selected', on);
    }
  }

  activate(id) {
    if (selection.active) selection.toggle(id);
    else this.handlers.onOpen(id);
  }

  onClick(event) {
    const card = event.target.closest('.bm-card');
    if (!card) return;
    const id = card.dataset.id;
    const control = event.target.closest('[data-act]');
    const act = control?.dataset.act;
    if (act === 'select') selection.toggle(id);
    else if (act === 'move') this.handlers.onMove(id, control);
    else if (act === 'favorite') this.handlers.onFavorite(id);
    else if (act === 'open') this.handlers.onOpenLink(id);
    else this.activate(id);
  }
}
