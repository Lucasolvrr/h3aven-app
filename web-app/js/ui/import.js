// Settings → Import: choose a browser bookmarks file, see what will happen,
// import it, then watch the preview images fill in.

import { h, plural, formatNumber } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { parseBookmarksFile, planImport, runImport, previews } from '../services/importer.js';
import { openModal, toast } from './overlay.js';

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
    } catch {
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

function openImportDialog(fileName, parsed) {
  const plan = planImport(parsed);
  const count = plan.items.length;

  const fact = (value, label) => h('li', null, h('strong', null, value), ` ${label}`);
  const summary = h(
    'ul',
    { class: 'import-summary' },
    fact(formatNumber(plan.total), plan.total === 1 ? 'link in the file' : 'links in the file'),
    fact(formatNumber(count), count === 1 ? 'new link to import' : 'new links to import'),
    plan.duplicates > 0 && fact(formatNumber(plan.duplicates), 'already in your library, skipped'),
    plan.skipped > 0 && fact(formatNumber(plan.skipped), 'not web links (browser pages, scripts), skipped')
  );
  // The structure that will be created: each category with its folders.
  const MAX_SHOWN = 8;
  const badge = (isNew) => (isNew ? h('span', { class: 'import-new' }, 'new') : h('span', { class: 'import-existing' }, 'exists'));
  const mapping = plan.tree.length
    ? h(
        'div',
        { class: 'import-tree-wrap' },
        h(
          'p',
          { class: 'dialog-text' },
          `Your browser folders come across as they are: ${plural(plan.tree.length, 'collection', 'collections')}${plan.newCategories ? ` (${formatNumber(plan.newCategories)} new)` : ''} with ${plural(plan.tree.reduce((n, c) => n + c.folders.length, 0), 'folder')} inside${plan.newFolders ? ` (${formatNumber(plan.newFolders)} new)` : ''}.`,
          plan.inbox ? ` ${plural(plan.inbox, 'link')} outside any folder ${plan.inbox === 1 ? 'goes' : 'go'} to your Inbox.` : ''
        ),
        h(
          'ul',
          { class: 'import-tree' },
          plan.tree.slice(0, MAX_SHOWN).map((category) =>
            h(
              'li',
              null,
              h('div', { class: 'import-tree-row' }, iconEl('folder', 14), h('span', { class: 'import-tree-name' }, category.name), h('span', { class: 'import-tree-count' }, formatNumber(category.count)), badge(category.isNew)),
              category.folders.length > 0 &&
                h(
                  'ul',
                  null,
                  category.folders.map((folder) =>
                    h('li', { class: 'import-tree-row is-folder' }, h('span', { class: 'import-tree-dot' }), h('span', { class: 'import-tree-name' }, folder.name), h('span', { class: 'import-tree-count' }, formatNumber(folder.count)), badge(folder.isNew))
                  )
                )
            )
          ),
          plan.tree.length > MAX_SHOWN && h('li', { class: 'import-tree-more' }, `+ ${plural(plan.tree.length - MAX_SHOWN, 'more collection', 'more collections')}`)
        )
      )
    : h('p', { class: 'dialog-text' }, 'The file has no folders, so everything goes to your Inbox.');

  const fetchBox = h('input', { type: 'checkbox', checked: true });
  const fetchRow = h(
    'label',
    { class: 'check-row' },
    fetchBox,
    h('span', null, h('span', { class: 'check-row-title' }, 'Fetch preview images'), h('span', { class: 'check-row-text' }, 'In the background, a few at a time. Until then each link shows its site icon.'))
  );

  const bar = h('div', { class: 'import-bar' }, h('div', { class: 'import-bar-fill' }));
  const status = h('p', { class: 'import-status', role: 'status' });
  const progress = h('div', { class: 'import-progress', hidden: true }, bar, status);
  const error = h('p', { class: 'field-error', hidden: true });

  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel');
  const submit = h('button', { type: 'button', class: 'btn btn-primary', disabled: !count }, count ? `Import ${plural(count, 'Link')}` : 'Nothing New to Import');

  let busy = false;
  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    error.hidden = true;
    progress.hidden = false;
    const paint = (done, total) => {
      bar.firstChild.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
      status.textContent = done < total ? `Saving ${formatNumber(done)} of ${formatNumber(total)}…` : 'Done.';
    };
    paint(0, count);
    try {
      const ids = await runImport(plan, paint);
      modal.close();
      toast(`Imported ${plural(ids.length, 'link')}`);
      if (fetchBox.checked && ids.length) previews.start(ids);
    } catch (problem) {
      // Whatever was saved before the error stays; running the import again skips it.
      error.textContent = `${problem.message || 'The import stopped.'} Links saved so far are kept; import the same file again to add the rest.`;
      error.hidden = false;
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = 'Try Again';
    }
  });

  const modal = openModal({
    label: 'Import bookmarks',
    content: h(
      'div',
      { class: 'dialog import-dialog' },
      h('h2', { class: 'dialog-title' }, 'Import Bookmarks'),
      h('p', { class: 'import-file' }, iconEl('bookmark', 14), h('span', null, fileName)),
      summary,
      count > 0 && mapping,
      count > 0 && fetchRow,
      progress,
      error,
      h('div', { class: 'dialog-foot' }, cancel, submit)
    ),
  });
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
