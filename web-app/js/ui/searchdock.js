// Search dock: the bar fixed at the bottom centre of the workspace.
//
// What you search for becomes chips inside the bar. A chip is either a term
// (matched against titles, links, tags, notes…) or a place (one category or
// folder). While you type, a glass panel grows out of the bar with the places
// and tags that match; with the field empty it lists recent searches and the
// categories, so the library can be browsed from here without the sidebar.
//
// The chips live in the URL (#/search/t:word/c:<categoryId>), so a search can
// be reloaded, bookmarked and walked through with back/forward.

import { STORAGE } from '../config.js';
import { h, readJson, writeJson, debounce } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { state, select } from '../data/store.js';

const MAX_RECENTS = 5;
const MAX_SUGGESTIONS = 7;
const MAX_CHIPS = 6;
const SEED = { width: 112, height: 40, tuck: 28 }; // the pill the panel grows from
const SPRING = 'cubic-bezier(0.2, 1.25, 0.35, 1)'; // lands with a soft overshoot
const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Text typed in the dock but not yet turned into a chip; the search page filters by it live. */
export const live = { query: '' };

// --- chips <-> URL ---------------------------------------------------------------

/** tokens: the decoded path segments after #/search */
export function parseChips(tokens = []) {
  const chips = [];
  for (const token of tokens) {
    if (token.startsWith('c:')) chips.push({ kind: 'category', id: token.slice(2) });
    else if (token.startsWith('s:')) chips.push({ kind: 'sub', id: token.slice(2) });
    else {
      const value = (token.startsWith('t:') ? token.slice(2) : token).trim();
      if (value && !chips.some((chip) => chip.kind === 'term' && same(chip.value, value))) chips.push({ kind: 'term', value });
    }
  }
  return chips;
}

export function chipsToHash(chips) {
  const tokens = chips.map((chip) => (chip.kind === 'term' ? `t:${chip.value}` : `${chip.kind === 'category' ? 'c' : 's'}:${chip.id}`));
  return `#/search${tokens.map((token) => `/${encodeURIComponent(token)}`).join('')}`;
}

export function chipLabel(chip) {
  if (chip.kind === 'term') return chip.value;
  if (chip.kind === 'category') return select.category(chip.id)?.name || 'Deleted category';
  const sub = select.subcategory(chip.id);
  return sub ? sub.name : 'Deleted folder';
}

const chipIcon = (chip) => (chip.kind === 'term' ? null : chip.kind === 'category' ? select.category(chip.id)?.icon || 'folder' : 'folder');
const chipKey = (chip) => (chip.kind === 'term' ? `t:${chip.value.toLowerCase()}` : `${chip.kind}:${chip.id}`);

// --- recents -----------------------------------------------------------------------

const readRecents = () => readJson(STORAGE.recentSearches, []).filter((item) => typeof item === 'string').slice(0, MAX_RECENTS);
const writeRecents = (list) => writeJson(STORAGE.recentSearches, list.slice(0, MAX_RECENTS));

// --- the dock ------------------------------------------------------------------------

/**
 * host: element the dock is positioned in (the workspace panel).
 * getRoute(): the current parsed route. onLiveQuery(): re-render the page.
 * createActions(): [{ label, icon, hint, run }] offered by the + button.
 */
export function mountSearchDock(host, { getRoute, onLiveQuery, createActions }) {
  let chips = [];
  let open = false;
  let mode = 'search'; // 'create' while the + button's options are showing
  let rows = [];
  let active = 0;
  let marked = null; // key of the chip Backspace has armed for removal
  let returnHash = '#/'; // where to go back to when the last chip is removed
  let panelFloor = 0;
  let panelEl = null;

  const input = h('input', {
    class: 'dock-input', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: 'Search your library', 'aria-label': 'Search your library', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
    'aria-describedby': 'dock-hint',
  });
  const chipRow = h('div', { class: 'dock-chips' });
  const bar = h('div', { class: 'dock-bar glass' }, iconEl('search', 20, 'dock-lead'), chipRow, input);
  const announcer = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  const createBtn = h(
    'button',
    {
      type: 'button', class: 'dock-create glass', 'aria-label': 'Create', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: 'Create',
      // Keep focus in the field: it drives the rows with the arrow keys.
      onPointerdown: (event) => event.preventDefault(),
      onClick: () => toggleCreate(),
    },
    iconEl('plus', 20)
  );
  const root = h(
    'div',
    { class: 'dock' },
    bar,
    createBtn,
    h('span', { class: 'sr-only', id: 'dock-hint' }, 'Enter adds a filter. Backspace at the start of the field selects the last filter, and again removes it. Delete removes the highlighted recent search.'),
    announcer
  );
  host.append(root);

  const announce = (text) => {
    announcer.textContent = announcer.textContent === text ? `${text} ` : text;
  };
  const animate = (el, frames, options) => (reducedMotion.matches ? null : el.animate(frames, options));
  // Animations stall in a background tab; the timer makes sure the element still goes.
  const removeAfter = (el, animation, ms) => {
    if (!animation) return el.remove();
    animation.onfinish = () => el.remove();
    setTimeout(() => el.remove(), ms + 120);
  };

  // --- chips ---------------------------------------------------------------------------

  function paintChips({ animateNew = true } = {}) {
    const wanted = new Map(chips.map((chip) => [chipKey(chip), chip]));
    for (const el of [...chipRow.children]) {
      if (el.dataset.leaving) continue;
      if (!wanted.has(el.dataset.key)) {
        // Leaves faster than it came, folding back into the chip before it.
        el.dataset.leaving = '1';
        const gone = animate(el, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }], { duration: 140, easing: EASE_OUT, fill: 'forwards' });
        removeAfter(el, gone, 140);
      }
    }
    let previous = null;
    for (const chip of chips) {
      const key = chipKey(chip);
      let el = [...chipRow.children].find((node) => node.dataset.key === key && !node.dataset.leaving);
      if (!el) {
        const label = chipLabel(chip);
        const name = chipIcon(chip);
        el = h(
          'span',
          { class: `dock-chip${chip.kind === 'term' ? '' : ' is-place'}`, dataset: { key } },
          name && iconEl(name, 14),
          h('span', { class: 'dock-chip-label', title: label }, label),
          h('button', { type: 'button', class: 'dock-chip-x', 'aria-label': `Remove filter ${label}`, onClick: () => removeChip(chip) }, iconEl('x', 14))
        );
        if (animateNew) {
          animate(el, [{ opacity: 0, transform: 'scale(0.6)', filter: 'blur(4px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }], { duration: 320, easing: SPRING });
        }
      } else {
        // Names can change under a chip (a category was renamed).
        const labelEl = el.querySelector('.dock-chip-label');
        const label = chipLabel(chip);
        if (labelEl.textContent !== label) labelEl.textContent = label;
      }
      const anchor = previous ? previous.nextSibling : chipRow.firstChild;
      if (anchor !== el) chipRow.insertBefore(el, anchor);
      previous = el;
      el.classList.toggle('is-marked', marked === key);
    }
    chipRow.classList.toggle('has-chips', chips.length > 0);
    input.placeholder = chips.length ? 'Add a filter' : 'Search your library';
  }

  function navigate(next) {
    if (!next.length) {
      // Nothing left to filter by: back to the page the search started from.
      live.query = '';
      location.hash = returnHash;
    } else {
      location.hash = chipsToHash(next);
    }
  }

  function addChip(chip) {
    let next = chips;
    if (chip.kind === 'term') {
      const value = chip.value.trim();
      if (!value) return;
      if (!chips.some((c) => c.kind === 'term' && same(c.value, value))) {
        if (chips.length >= MAX_CHIPS) return announce(`Up to ${MAX_CHIPS} filters`);
        next = [...chips, { kind: 'term', value }];
      }
      writeRecents([value, ...readRecents().filter((item) => !same(item, value))]);
    } else {
      // One place at a time: a new category or folder replaces the old one.
      next = [...chips.filter((c) => c.kind === 'term'), chip];
    }
    announce(`Added filter ${chipLabel(chip)}`);
    input.value = '';
    live.query = '';
    if (next === chips) return refresh();
    navigate(next);
    scrollChipsToEnd();
  }

  function removeChip(chip) {
    marked = null;
    announce(`Removed filter ${chipLabel(chip)}`);
    input.focus();
    navigate(chips.filter((c) => chipKey(c) !== chipKey(chip)));
  }

  const scrollChipsToEnd = () =>
    requestAnimationFrame(() => {
      if (chipRow.scrollWidth > chipRow.clientWidth) chipRow.scrollTo({ left: chipRow.scrollWidth, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });

  // --- rows ------------------------------------------------------------------------------

  function buildRows() {
    if (mode === 'create') return createActions().map((action) => ({ group: 'Create', kind: 'action', ...action }));
    const query = input.value.trim();
    const recents = readRecents();
    const taken = new Set(chips.map(chipKey));
    const hasPlace = chips.some((chip) => chip.kind !== 'term');

    if (!query) {
      const list = recents.filter((term) => !taken.has(`t:${term.toLowerCase()}`)).map((term) => ({ group: 'Recent', kind: 'recent', label: term, icon: 'clock' }));
      if (!hasPlace) {
        for (const category of state.categories.slice(0, 8)) {
          list.push({ group: 'Categories', kind: 'category', id: category.id, label: category.name, icon: category.icon || 'folder', hint: String(select.counts().category.get(category.id) || 0) });
        }
      } else {
        // Inside a category: offer its folders as the next step.
        const place = chips.find((chip) => chip.kind === 'category');
        if (place) {
          for (const sub of select.subsOf(place.id).slice(0, 8)) {
            list.push({ group: 'Folders', kind: 'sub', id: sub.id, label: sub.name, icon: 'folder', hint: String(select.counts().subcategory.get(sub.id) || 0) });
          }
        }
      }
      return list;
    }

    const needle = query.toLowerCase();
    const has = (text) => text.toLowerCase().includes(needle);
    const matches = [];
    for (const category of state.categories) {
      if (has(category.name) && !taken.has(`category:${category.id}`)) matches.push({ kind: 'category', id: category.id, label: category.name, icon: category.icon || 'folder', hint: 'Category' });
    }
    for (const sub of state.subcategories) {
      if (has(sub.name) && !taken.has(`sub:${sub.id}`)) matches.push({ kind: 'sub', id: sub.id, label: sub.name, icon: 'folder', hint: select.category(sub.categoryId)?.name || 'Folder' });
    }
    const seen = new Set([needle]);
    for (const [kind, pool, icon, hint] of [['tag', select.tagNames(), 'hash', 'Tag'], ['recent', recents, 'clock', '']]) {
      for (const term of pool) {
        const key = term.toLowerCase();
        if (seen.has(key) || taken.has(`t:${key}`) || !has(term)) continue;
        seen.add(key);
        matches.push({ kind, label: term, icon, hint });
      }
    }
    return [
      { group: 'Suggestions', kind: 'query', label: query, icon: 'search', hint: 'Search' },
      ...matches.slice(0, MAX_SUGGESTIONS).map((row) => ({ ...row, group: 'Suggestions' })),
    ];
  }

  function pick(row) {
    if (!row) return;
    if (row.kind === 'action') {
      setOpen(false);
      input.blur();
      return row.run();
    }
    if (row.kind === 'category' || row.kind === 'sub') addChip({ kind: row.kind, id: row.id });
    else addChip({ kind: 'term', value: row.label });
  }

  function removeRecent(term) {
    writeRecents(readRecents().filter((item) => !same(item, term)));
    announce(`Removed ${term} from recent searches`);
    refresh();
  }

  function highlight(label, query) {
    const at = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (at < 0) return [label];
    return [label.slice(0, at), h('strong', null, label.slice(at, at + query.length)), label.slice(at + query.length)];
  }

  // --- panel -----------------------------------------------------------------------------

  function setActive(index, scroll = true) {
    if (!rows.length) return;
    active = (index + rows.length) % rows.length;
    const options = panelEl ? [...panelEl.querySelectorAll('.dock-row')] : [];
    options.forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const el = options[active];
    const glow = panelEl?.querySelector('.dock-row-glow');
    if (el && glow) {
      glow.style.opacity = '1';
      glow.style.height = `${el.offsetHeight}px`;
      glow.style.transform = `translateY(${el.offsetTop}px)`;
      if (scroll) el.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', el.id);
    }
  }

  function renderPanel() {
    const query = input.value.trim();
    const list = h('div', { class: 'dock-list', id: 'dock-list', role: 'listbox', 'aria-label': mode === 'create' ? 'Create' : query ? 'Suggestions' : 'Recent searches and categories' }, h('div', { class: 'dock-row-glow', 'aria-hidden': 'true' }));
    let lastGroup = null;
    rows.forEach((row, index) => {
      if (row.group !== lastGroup) {
        lastGroup = row.group;
        list.append(
          h(
            'div',
            { class: 'dock-group' },
            h('span', null, row.group),
            row.group === 'Recent' &&
              h(
                'button',
                {
                  type: 'button', class: 'dock-clear', onPointerdown: (event) => event.preventDefault(),
                  onClick: () => {
                    writeRecents([]);
                    announce('Cleared recent searches');
                    refresh();
                  },
                },
                'Clear'
              )
          )
        );
      }
      list.append(
        h(
          'div',
          {
            class: 'dock-row', id: `dock-option-${index}`, role: 'option', 'aria-selected': 'false',
            // Rows never take focus: the field drives them (aria-activedescendant).
            onPointerdown: (event) => event.preventDefault(),
            onPointermove: () => active !== index && setActive(index, false),
            onClick: () => pick(row),
          },
          iconEl(row.icon, 16),
          h('span', { class: 'dock-row-label' }, row.kind === 'query' ? row.label : highlight(row.label, query)),
          row.kind === 'recent' && !query
            ? h(
                'span',
                {
                  class: 'dock-row-x', 'aria-hidden': 'true',
                  onClick: (event) => {
                    event.stopPropagation();
                    removeRecent(row.label);
                  },
                },
                iconEl('x', 14)
              )
            : row.hint && h('span', { class: 'dock-row-hint' }, row.hint)
        )
      );
    });
    return list;
  }

  function showPanel() {
    if (!rows.length) return hidePanel();
    const content = h('div', { class: 'dock-panel-content' }, renderPanel());
    if (panelEl) {
      // Already open: swap the rows and let the glass follow the new size.
      const glass = panelEl.querySelector('.dock-panel-glass');
      const from = glass.getBoundingClientRect();
      panelEl.querySelector('.dock-panel-content').replaceWith(content);
      panelFloor = Math.max(panelFloor, content.offsetHeight);
      // Typing can grow the card but never shrink it while it stays open.
      content.style.minHeight = `${panelFloor}px`;
      const to = glass.getBoundingClientRect();
      if (Math.abs(from.height - to.height) > 1) {
        animate(glass, [{ height: `${from.height}px` }, { height: `${to.height}px` }], { duration: 260, easing: SPRING });
      }
    } else {
      const glass = h('div', { class: 'dock-panel-glass glass', 'aria-hidden': 'true' });
      panelEl = h('div', { class: 'dock-panel' }, glass, content);
      root.prepend(panelEl);
      panelFloor = content.offsetHeight;
      const size = panelEl.getBoundingClientRect();
      // The glass starts as a small pill tucked behind the bar and springs out
      // to the size of what it holds; the content waits for the shape.
      animate(
        glass,
        [
          { width: `${SEED.width}px`, height: `${SEED.height}px`, transform: `translate(-50%, ${SEED.tuck}px)`, opacity: 0 },
          { opacity: 1, offset: 0.25 },
          { width: `${size.width}px`, height: `${size.height}px`, transform: 'translate(-50%, 0)', opacity: 1 },
        ],
        { duration: 420, easing: SPRING }
      );
      animate(content, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: 120, easing: EASE_OUT, fill: 'backwards' });
    }
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'dock-list');
    setActive(Math.min(active, rows.length - 1), false);
  }

  function hidePanel() {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    input.removeAttribute('aria-activedescendant');
    const leaving = panelEl;
    if (!leaving) return;
    panelEl = null;
    leaving.style.pointerEvents = 'none';
    const glass = leaving.querySelector('.dock-panel-glass');
    const size = leaving.getBoundingClientRect();
    animate(leaving.querySelector('.dock-panel-content'), [{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' });
    // Folds back faster than it grew.
    const fold = animate(
      glass,
      [
        { width: `${size.width}px`, height: `${size.height}px`, transform: 'translate(-50%, 0)', opacity: 1 },
        { opacity: 1, offset: 0.6 },
        { width: `${SEED.width}px`, height: `${SEED.height}px`, transform: `translate(-50%, ${SEED.tuck}px)`, opacity: 0 },
      ],
      { duration: 220, easing: EASE_OUT, fill: 'forwards' }
    );
    removeAfter(leaving, fold, 220);
  }

  /** Rebuild rows and repaint everything that depends on the field or the chips. */
  function refresh({ keepActive = false } = {}) {
    rows = buildRows();
    if (!keepActive) active = 0;
    paintChips();
    if (open) showPanel();
  }

  // --- open / close: the bar hugs its content at rest and widens when used ---------------

  function paintMode() {
    root.classList.toggle('is-creating', mode === 'create');
    createBtn.setAttribute('aria-expanded', String(open && mode === 'create'));
  }

  /** The + button: show what can be created, in the same panel the search uses. */
  function toggleCreate() {
    if (open && mode === 'create') {
      setOpen(false);
      return input.blur();
    }
    mode = 'create';
    if (input.value) {
      input.value = '';
      if (live.query) {
        live.query = '';
        onLiveQuery();
      }
    }
    if (open) refresh();
    else {
      input.focus();
      setOpen(true);
    }
    paintMode();
  }

  function setOpen(next) {
    if (open === next) return;
    const from = bar.getBoundingClientRect().width;
    open = next;
    root.classList.toggle('is-open', open);
    const to = bar.getBoundingClientRect().width;
    if (Math.abs(from - to) > 1) animate(bar, [{ width: `${from}px` }, { width: `${to}px` }], { duration: 300, easing: SPRING });
    if (open) {
      panelFloor = 0;
      refresh();
    } else {
      marked = null;
      mode = 'search';
      paintChips();
      hidePanel();
    }
    paintMode();
  }

  // --- events ------------------------------------------------------------------------------

  const liveSoon = debounce(() => onLiveQuery(), 140);

  input.addEventListener('focus', () => setOpen(true));
  input.addEventListener('click', () => setOpen(true));
  input.addEventListener('input', () => {
    marked = null;
    mode = 'search'; // typing always means searching
    paintMode();
    setOpen(true);
    refresh();
    // On the search page the results follow the field as you type.
    if (getRoute().name === 'search') {
      live.query = input.value.trim();
      liveSoon();
    }
  });

  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) setOpen(false);
  });
  // A press anywhere on the bar that is not its own control lands in the field.
  bar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input')) return;
    event.preventDefault();
    input.focus();
    setOpen(true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (open && !root.contains(event.target)) setOpen(false);
  });

  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const markedChip = marked && chips.find((chip) => chipKey(chip) === marked);

    if (markedChip) {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        return removeChip(markedChip);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const at = chips.indexOf(markedChip) + (event.key === 'ArrowLeft' ? -1 : 1);
        marked = at >= chips.length ? null : chipKey(chips[Math.max(at, 0)]);
        return paintChips();
      }
      marked = null;
      paintChips();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Clear before closing: one press undoes typing, the next leaves.
      if (input.value) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
      } else if (open) {
        setOpen(false);
      } else {
        input.blur();
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && rows[active] && (input.value.trim() || panelEl)) pick(rows[active]);
    } else if (event.key === 'Delete' && open && rows[active]?.kind === 'recent' && !input.value) {
      event.preventDefault();
      removeRecent(rows[active].label);
    } else if (event.key === 'Backspace' && atStart && chips.length) {
      // Mark first, remove on the second press: one stray key never loses a filter.
      event.preventDefault();
      const last = chips[chips.length - 1];
      marked = chipKey(last);
      announce(`${chipLabel(last)} selected. Press Backspace again to remove it.`);
      paintChips();
    } else if (event.key === 'ArrowLeft' && atStart && chips.length) {
      event.preventDefault();
      marked = chipKey(chips[chips.length - 1]);
      paintChips();
    }
  });

  // --- public ---------------------------------------------------------------------------------

  return {
    /** Call on every route change and store update. */
    sync(route, previousHash) {
      const onSearch = route.name === 'search';
      if (onSearch && previousHash !== undefined && !previousHash.startsWith('#/search')) returnHash = previousHash || '#/';
      const next = onSearch ? route.chips : [];
      const changed = next.map(chipKey).join('|') !== chips.map(chipKey).join('|');
      chips = next;
      if (!onSearch) {
        live.query = '';
        if (document.activeElement !== input) input.value = '';
      }
      if (changed) scrollChipsToEnd();
      refresh({ keepActive: !changed });
    },
    focus() {
      input.focus();
      setOpen(true);
    },
  };
}
