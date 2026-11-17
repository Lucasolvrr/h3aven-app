// Settings → Import: choose a browser bookmarks file, see what will happen,
// import it, then watch the preview images fill in.

import { h, plural, formatNumber } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { parseBookmarksFile, planImport, runImport, previews } from '../services/importer.js';
import { openModal, toast } from './overlay.js';
import { textShimmer } from './shimmer.js';
import { checkbox } from './checkbox.js';

/** The "Choose File…" button for the Settings row. */
export function importButton() {
  const input = h('input', { type: 'file', accept: '.html,.htm,text/html', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    try {
      const parsed = parseBookmarksFile(await file.text());
      if (!parsed.links.length) {
        toast('No bookmarks found in that file. Export them from the browser’s bookmark manager as HTML.', { type: 'error' });
        return;
      }
      openImportDialog(file.name, parsed);
    } catch (error) {
      console.error(error);
      toast('That file could not be read. Choose the HTML file your browser exported.', { type: 'error' });
    }
  });
  return h(
    'div',
    { class: 'section-actions' },
    input,
    h('button', { type: 'button', class: 'btn btn-subtle', onClick: () => input.click() }, iconEl('upload', 15), 'Choose File…')
  );
}

// The import dialog, in the language of a planning card: a header tile with
// the file, a summary line, a segmented bar (one segment per collection, in
// proportion to its links), numbered rows, and a footer with the actions.
// It opens with a short "Reading your bookmarks" beat (shimmering text, the
// bar's segments growing in, rows arriving one after another), then the same
// bar shows the import's real progress.

const READ_BEAT = 650; // ms: brief, but enough to see the bar build up
const MIN_SAVE_BEAT = 900; // ms: the shortest the saving state shows, however fast the save
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function openImportDialog(fileName, parsed) {
  const plan = planImport(parsed);
  const total = plan.items.length;
  const skippedTotal = plan.duplicates + plan.skipped;

  // --- what to import: every collection, folder and the Inbox can be left out ---
  // A link's place: its folder, the collection itself (links loose in it), or the Inbox.
  const keyOf = (item) => (!item.category ? 'inbox' : item.folder ? `f:${item.category}/${item.folder}` : `c:${item.category}`);
  const countByKey = new Map();
  for (const item of plan.items) countByKey.set(keyOf(item), (countByKey.get(keyOf(item)) || 0) + 1);
  const included = new Set(countByKey.keys()); // everything, to start with
  const groups = [
    ...plan.tree.map((category) => ({
      name: category.name,
      category,
      // the collection's own links (outside its folders) count as part of it
      keys: [`c:${category.name}`, ...category.folders.map((folder) => `f:${category.name}/${folder.name}`)].filter((key) => countByKey.has(key)),
    })),
    ...(plan.inbox ? [{ name: 'Inbox', category: null, keys: ['inbox'] }] : []),
  ];
  const chosen = () => plan.items.filter((item) => included.has(keyOf(item)));
  const sumKeys = (keys) => keys.reduce((n, key) => n + (included.has(key) ? countByKey.get(key) || 0 : 0), 0);

  // --- header tile ---
  const head = h(
    'div',
    { class: 'imp-head' },
    h('span', { class: 'imp-head-icon', 'aria-hidden': 'true' }, iconEl('upload', 16)),
    h('div', { class: 'imp-head-text' }, h('h2', { class: 'imp-title', id: 'imp-title' }, 'Import bookmarks'), h('p', { class: 'imp-file' }, fileName)),
    h('span', { class: 'imp-head-count' }, `${formatNumber(plan.total)} in file`)
  );

  // --- summary line and segmented bar ---
  const status = textShimmer('Reading your bookmarks');
  const summaryLeft = h('p', { class: 'imp-summary-left' }, status.el);
  const summaryRight = h('p', { class: 'imp-summary-right' });
  const summary = h('div', { class: 'imp-summary' }, summaryLeft, summaryRight);

  // One segment per collection (plus the Inbox), as a share of every link in the
  // file; a segment shrinks as its folders are left out.
  const share = (n) => (plan.total ? (n / plan.total) * 100 : 0);
  const segments = groups.map((group, i) => h('span', { class: 'imp-seg', title: group.name, style: `--w: ${share(sumKeys(group.keys))}%; --i: ${i}` }));
  const fill = h('span', { class: 'imp-fill' });
  const marker = h('span', { class: 'imp-marker', 'aria-hidden': 'true' });
  const scaleMark = h('span', { class: 'imp-scale-mark' });
  const bar = h('div', { class: 'imp-bar', role: 'img' }, h('div', { class: 'imp-segs' }, segments), fill, marker);
  const scale = h('div', { class: 'imp-scale', 'aria-hidden': 'true' }, h('span', null, '0'), scaleMark, h('span', null, formatNumber(plan.total)));

  // --- rows: one per collection with a checkbox; its folders open underneath ---
  const badge = (isNew) => h('span', { class: `imp-badge${isNew ? ' is-new' : ''}` }, isNew ? 'new' : 'exists');
  const boxes = []; // { box, keys }
  const rows = groups.map((group, index) => {
    const folders = group.category?.folders || [];
    const folderRows = folders.map((folder) => {
      const key = `f:${group.name}/${folder.name}`;
      const box = checkbox({ label: `Import ${folder.name}`, checked: true, onChange: (on) => toggle([key], on) });
      boxes.push({ box, keys: [key] });
      return h('li', { class: 'imp-folder' }, box.el, h('span', { class: 'imp-folder-name' }, folder.name), h('span', { class: 'imp-row-count' }, formatNumber(folder.count)), badge(folder.isNew));
    });
    const sub = folders.length > 0 && h('ul', { class: 'imp-folders', hidden: true }, folderRows);
    const box = checkbox({ label: `Import ${group.name}`, checked: true, onChange: (on) => toggle(group.keys, on) });
    boxes.push({ box, keys: group.keys });
    const main = h(
      'button',
      { type: 'button', class: 'imp-row-main', 'aria-expanded': folders.length ? 'false' : null },
      h('span', { class: 'imp-row-index' }, String(index + 1)),
      h('span', { class: 'imp-row-name' }, group.name),
      h('span', { class: 'imp-row-meta' }, group.category ? [iconEl('folder', 13), folders.length ? plural(folders.length, 'folder') : 'no folders'] : [iconEl('inbox', 13), 'outside any folder']),
      h('span', { class: 'imp-row-count' }, formatNumber(group.category ? group.category.count : plan.inbox)),
      group.category ? badge(group.category.isNew) : h('span', { class: 'imp-badge' }, 'inbox'),
      folders.length ? iconEl('chevron-down', 14, 'imp-row-chevron') : h('span', { class: 'imp-row-chevron' })
    );
    // With folders the row opens them; without, the whole row toggles the checkbox.
    main.addEventListener('click', () => {
      if (!folders.length) return box.el.click();
      const open = main.getAttribute('aria-expanded') !== 'true';
      main.setAttribute('aria-expanded', String(open));
      sub.hidden = !open;
    });
    return h('li', { class: 'imp-item', style: `--i: ${index}` }, h('div', { class: 'imp-row' }, box.el, main), sub);
  });
  const list = h('ul', { class: 'imp-list', 'aria-label': 'Collections to import' }, rows);
  const empty = !groups.length && h('p', { class: 'imp-empty' }, total ? 'No folders in the file: everything goes to your Inbox.' : 'Everything in this file is already in your library.');

  // --- footer ---
  const fetchSwitch = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': 'imp-fetch-label' }, h('span', { class: 'switch-knob' }));
  fetchSwitch.addEventListener('click', () => fetchSwitch.setAttribute('aria-checked', String(fetchSwitch.getAttribute('aria-checked') !== 'true')));
  const fetchOption =
    total > 0 &&
    h(
      'div',
      { class: 'imp-option', title: 'In the background, a few at a time. Until then each link shows its site icon.' },
      fetchSwitch,
      h('span', { id: 'imp-fetch-label' }, 'Fetch preview images')
    );
  const error = h('p', { class: 'imp-error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'imp-btn', onClick: () => modal.close() }, 'Cancel');
  const submit = h('button', { type: 'button', class: 'imp-btn is-primary', disabled: true }, total ? `Import ${plural(total, 'link')}` : 'Nothing new to import');
  const foot = h('footer', { class: 'imp-foot' }, fetchOption || h('span'), h('div', { class: 'imp-actions' }, cancel, submit));

  const card = h('div', { class: 'imp', 'data-phase': 'reading' }, head, h('section', { class: 'imp-plan' }, summary, bar, scale), h('div', { class: 'imp-body' }, list, empty, error), foot);

  // --- the selection, painted everywhere it shows ---
  function toggle(keys, on) {
    for (const key of keys) on ? included.add(key) : included.delete(key);
    paintSelection();
  }
  function paintSelection() {
    for (const { box, keys } of boxes) {
      const on = keys.filter((key) => included.has(key)).length;
      box.set(on === 0 ? false : on === keys.length ? true : 'mixed');
    }
    groups.forEach((group, i) => {
      const n = sumKeys(group.keys);
      segments[i].style.setProperty('--w', `${share(n)}%`);
      segments[i].title = `${group.name}: ${plural(n, 'link')}`;
      segments[i].classList.toggle('is-out', n === 0);
      rows[i].classList.toggle('is-out', n === 0);
    });
    const count = chosen().length;
    const newShare = share(count);
    marker.hidden = !(count > 0 && count < plan.total);
    marker.style.left = `${newShare}%`;
    scaleMark.hidden = marker.hidden || newShare < 12 || newShare > 88;
    scaleMark.style.left = `${newShare}%`;
    scaleMark.textContent = formatNumber(count);
    bar.setAttribute('aria-label', `${plural(count, 'link')} chosen out of ${plural(plan.total, 'link')} in the file`);
    if (card.dataset.phase === 'ready') {
      paintSummary(count);
      submit.disabled = count === 0;
      submit.textContent = count ? `Import ${plural(count, 'link')}` : 'Choose something to import';
    }
  }
  function paintSummary(count) {
    const collections = plan.tree.filter((category) => sumKeys(groups.find((g) => g.category === category).keys) > 0).length;
    const folders = plan.tree.reduce((n, category) => n + category.folders.filter((folder) => included.has(`f:${category.name}/${folder.name}`)).length, 0);
    summaryLeft.replaceChildren(
      ...[
        h('strong', null, formatNumber(count)),
        ` new ${count === 1 ? 'link' : 'links'}`,
        collections > 0 && h('span', { class: 'imp-dot', 'aria-hidden': 'true' }, '•'),
        collections > 0 && h('strong', null, formatNumber(collections)),
        collections > 0 && ` ${collections === 1 ? 'collection' : 'collections'}${folders ? ', ' : ''}`,
        folders > 0 && h('strong', null, formatNumber(folders)),
        folders > 0 && ` ${folders === 1 ? 'folder' : 'folders'}`,
      ].filter(Boolean)
    );
  }

  // --- phases ---
  const showPlan = () => {
    card.dataset.phase = 'ready';
    status.set(total ? `${formatNumber(total)} new ${total === 1 ? 'link' : 'links'}` : 'Nothing new', { active: false });
    const skippedParts = [
      plan.duplicates > 0 && `${formatNumber(plan.duplicates)} already saved`,
      plan.skipped > 0 && `${formatNumber(plan.skipped)} not web ${plan.skipped === 1 ? 'link' : 'links'}`,
    ].filter(Boolean);
    summaryRight.replaceChildren(...(skippedParts.length ? [iconEl('check', 14), `${skippedParts.join(', ')}, skipped`] : []));
    paintSelection();
  };

  let busy = false;
  submit.addEventListener('click', async () => {
    if (busy) return;
    const items = chosen();
    if (!items.length) return;
    busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    error.hidden = true;
    card.dataset.phase = 'importing';
    card.querySelectorAll('.cbx').forEach((box) => (box.disabled = true));
    summaryLeft.replaceChildren(status.el);
    summaryRight.replaceChildren();
    const newShare = share(items.length);
    const paint = (done, all) => {
      fill.style.width = `${(done / Math.max(all, 1)) * newShare}%`;
      status.set(done < all ? `Saving ${formatNumber(done)} of ${formatNumber(all)}` : `Saving ${plural(all, 'link')}`, { active: true });
    };
    paint(0, items.length);
    const started = performance.now();
    try {
      const ids = await runImport({ ...plan, items }, paint);
      // Even an instant import gets a short beat on the bar, so it reads as done rather than skipped.
      fill.style.width = `${newShare}%`;
      const rest = (reduceMotion() ? 0 : MIN_SAVE_BEAT) - (performance.now() - started);
      if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
      card.dataset.phase = 'done';
      status.set(`Imported ${plural(ids.length, 'link')}`, { active: false });
      summaryRight.replaceChildren(iconEl('check', 14), 'Done');
      if (fetchSwitch.getAttribute('aria-checked') === 'true' && ids.length) previews.start(ids);
      setTimeout(() => modal.close(), reduceMotion() ? 400 : 1100);
    } catch (problem) {
      // Whatever was saved before the error stays; running the import again skips it.
      card.dataset.phase = 'ready';
      card.querySelectorAll('.cbx').forEach((box) => (box.disabled = false));
      status.set('Import stopped', { active: false });
      error.textContent = `${problem.message || 'The import stopped.'} Links saved so far are kept; import the same file again to add the rest.`;
      error.hidden = false;
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = 'Try again';
    }
  });

  paintSelection();
  const modal = openModal({ label: 'Import bookmarks', className: 'imp-modal', content: card });
  modal.panel.removeAttribute('aria-label');
  modal.panel.setAttribute('aria-labelledby', 'imp-title');
  // The reading beat: the bar builds up and rows arrive, then the numbers settle in.
  setTimeout(() => card.classList.add('is-building'), 30);
  setTimeout(showPlan, reduceMotion() ? 0 : READ_BEAT);
}

/** Live "Preview images" status for Settings, with Pause / Resume. Empty until an import ran. */
export function previewStatus() {
  const text = h('span', { class: 'set-row-desc' });
  const button = h('button', { type: 'button', class: 'btn btn-ghost' });
  const root = h('div', { class: 'preview-status' }, text, button);
  const paint = ({ done, total, running, note }) => {
    if (!root.isConnected && unsubscribe && root.dataset.mounted) return unsubscribe();
    root.hidden = !total;
    text.textContent = note || (running ? `Fetching previews: ${formatNumber(done)} of ${formatNumber(total)}` : `${formatNumber(done)} of ${formatNumber(total)} previews`);
    const remaining = total - done;
    button.hidden = !(running || remaining > 0);
    button.textContent = running ? 'Pause' : 'Resume';
    button.onclick = () => (running ? previews.stop() : previews.resume());
  };
  const unsubscribe = previews.subscribe(paint);
  paint(previews.state);
  requestAnimationFrame(() => (root.dataset.mounted = '1'));
  return root;
}
