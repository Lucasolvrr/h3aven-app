// Settings → Import: choose a browser bookmarks file, see what will happen,
// import it, then watch the preview images fill in.

import { h, plural, formatNumber } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { parseBookmarksFile, planImport, runImport, previews } from '../services/importer.js';
import { openModal, toast } from './overlay.js';
import { textShimmer } from './shimmer.js';

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
  const count = plan.items.length;
  const folderTotal = plan.tree.reduce((n, c) => n + c.folders.length, 0);
  const skippedTotal = plan.duplicates + plan.skipped;

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

  // One segment per collection (plus the Inbox), as a share of every link in the file.
  const groups = [
    ...plan.tree.map((category) => ({ name: category.name, count: category.count })),
    ...(plan.inbox ? [{ name: 'Inbox', count: plan.inbox }] : []),
  ];
  const share = (n) => (plan.total ? (n / plan.total) * 100 : 0);
  const segments = groups.map((group, i) => h('span', { class: 'imp-seg', title: `${group.name}: ${plural(group.count, 'link')}`, style: `--w: ${share(group.count)}%; --i: ${i}` }));
  const fill = h('span', { class: 'imp-fill' });
  const newShare = share(count);
  const marker = skippedTotal > 0 && count > 0 && h('span', { class: 'imp-marker', style: { left: `${newShare}%` }, 'aria-hidden': 'true' });
  const bar = h(
    'div',
    { class: 'imp-bar', role: 'img', 'aria-label': `${plural(count, 'new link')} out of ${plural(plan.total, 'link')} in the file` },
    h('div', { class: 'imp-segs' }, segments),
    fill,
    marker
  );
  const scale = h(
    'div',
    { class: 'imp-scale', 'aria-hidden': 'true' },
    h('span', null, '0'),
    marker && newShare > 12 && newShare < 88 && h('span', { class: 'imp-scale-mark', style: { left: `${newShare}%` } }, formatNumber(count)),
    h('span', null, formatNumber(plan.total))
  );

  // --- rows: one per collection, folders open underneath ---
  const badge = (isNew) => h('span', { class: `imp-badge${isNew ? ' is-new' : ''}` }, isNew ? 'new' : 'exists');
  const rows = groups.map((group, index) => {
    const category = plan.tree[index];
    const folders = category?.folders || [];
    const sub =
      folders.length > 0 &&
      h(
        'ul',
        { class: 'imp-folders', hidden: true },
        folders.map((folder) => h('li', { class: 'imp-folder' }, h('span', { class: 'imp-folder-name' }, folder.name), h('span', { class: 'imp-row-count' }, formatNumber(folder.count)), badge(folder.isNew)))
      );
    const toggle = h(
      'button',
      { type: 'button', class: 'imp-row', 'aria-expanded': folders.length ? 'false' : null, disabled: !folders.length },
      h('span', { class: 'imp-row-index' }, String(index + 1)),
      h('span', { class: 'imp-row-name' }, group.name),
      h('span', { class: 'imp-row-meta' }, category ? [iconEl('folder', 13), folders.length ? plural(folders.length, 'folder') : 'no folders'] : [iconEl('inbox', 13), 'outside any folder']),
      h('span', { class: 'imp-row-count' }, formatNumber(group.count)),
      category ? badge(category.isNew) : h('span', { class: 'imp-badge' }, 'inbox'),
      folders.length ? iconEl('chevron-down', 14, 'imp-row-chevron') : h('span', { class: 'imp-row-chevron' })
    );
    if (folders.length) {
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        sub.hidden = !open;
      });
    }
    return h('li', { class: 'imp-item', style: `--i: ${index}` }, toggle, sub);
  });
  const list = h('ul', { class: 'imp-list', 'aria-label': 'Collections to create' }, rows);
  const empty = !groups.length && h('p', { class: 'imp-empty' }, count ? 'No folders in the file: everything goes to your Inbox.' : 'Everything in this file is already in your library.');

  // --- footer ---
  const fetchSwitch = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': 'imp-fetch-label' }, h('span', { class: 'switch-knob' }));
  fetchSwitch.addEventListener('click', () => fetchSwitch.setAttribute('aria-checked', String(fetchSwitch.getAttribute('aria-checked') !== 'true')));
  const fetchOption =
    count > 0 &&
    h(
      'div',
      { class: 'imp-option', title: 'In the background, a few at a time. Until then each link shows its site icon.' },
      fetchSwitch,
      h('span', { id: 'imp-fetch-label' }, 'Fetch preview images')
    );
  const error = h('p', { class: 'imp-error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'imp-btn', onClick: () => modal.close() }, 'Cancel');
  const submit = h('button', { type: 'button', class: 'imp-btn is-primary', disabled: true }, count ? `Import ${plural(count, 'link')}` : 'Nothing new to import');
  const foot = h('footer', { class: 'imp-foot' }, fetchOption || h('span'), h('div', { class: 'imp-actions' }, cancel, submit));

  const card = h('div', { class: 'imp', 'data-phase': 'reading' }, head, h('section', { class: 'imp-plan' }, summary, bar, scale), h('div', { class: 'imp-body' }, list, empty, error), foot);

  // --- phases ---
  const showPlan = () => {
    card.dataset.phase = 'ready';
    status.set(count ? `${formatNumber(count)} new ${count === 1 ? 'link' : 'links'}` : 'Nothing new', { active: false });
    summaryLeft.replaceChildren(
      ...[
        h('strong', null, formatNumber(count)),
        ` new ${count === 1 ? 'link' : 'links'}`,
        plan.tree.length > 0 && h('span', { class: 'imp-dot', 'aria-hidden': 'true' }, '•'),
        plan.tree.length > 0 && h('strong', null, formatNumber(plan.tree.length)),
        plan.tree.length > 0 && ` ${plan.tree.length === 1 ? 'collection' : 'collections'}${folderTotal ? ', ' : ''}`,
        folderTotal > 0 && h('strong', null, formatNumber(folderTotal)),
        folderTotal > 0 && ` ${folderTotal === 1 ? 'folder' : 'folders'}`,
      ].filter(Boolean)
    );
    const skippedParts = [
      plan.duplicates > 0 && `${formatNumber(plan.duplicates)} already saved`,
      plan.skipped > 0 && `${formatNumber(plan.skipped)} not web ${plan.skipped === 1 ? 'link' : 'links'}`,
    ].filter(Boolean);
    summaryRight.replaceChildren(...(skippedParts.length ? [iconEl('check', 14), `${skippedParts.join(', ')}, skipped`] : []));
    submit.disabled = !count;
  };

  let busy = false;
  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    error.hidden = true;
    card.dataset.phase = 'importing';
    summaryLeft.replaceChildren(status.el);
    summaryRight.replaceChildren();
    const paint = (done, total) => {
      fill.style.width = `${(done / Math.max(total, 1)) * newShare}%`;
      status.set(done < total ? `Saving ${formatNumber(done)} of ${formatNumber(total)}` : `Saving ${plural(total, 'link')}`, { active: true });
    };
    paint(0, count);
    const started = performance.now();
    try {
      const ids = await runImport(plan, paint);
      // Even an instant import gets a short beat on the bar, so it reads as done rather than skipped.
      fill.style.width = `${newShare}%`;
      const rest = (reduceMotion() ? 0 : MIN_SAVE_BEAT) - (performance.now() - started);
      if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
      card.dataset.phase = 'done';
      fill.style.width = `${newShare}%`;
      status.set(`Imported ${plural(ids.length, 'link')}`, { active: false });
      summaryRight.replaceChildren(iconEl('check', 14), 'Done');
      if (fetchSwitch.getAttribute('aria-checked') === 'true' && ids.length) previews.start(ids);
      setTimeout(() => modal.close(), reduceMotion() ? 400 : 1100);
    } catch (problem) {
      // Whatever was saved before the error stays; running the import again skips it.
      card.dataset.phase = 'ready';
      status.set('Import stopped', { active: false });
      error.textContent = `${problem.message || 'The import stopped.'} Links saved so far are kept; import the same file again to add the rest.`;
      error.hidden = false;
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = 'Try again';
    }
  });

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
