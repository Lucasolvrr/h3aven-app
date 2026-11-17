// Inline edit (after uiarc's inline-edit): text that becomes a field in place,
// with the same type and position, then saves on its own.
//
//   inlineEdit({ value, label, onSave, validate, placeholder, multiline, variant })
//
// Resting, it is a button ("<label>: <value>") with a pencil on hover. Editing:
// Enter saves (Shift+Enter for a new line when multiline), Escape cancels,
// leaving the field saves, like a rename. onSave may return a promise; the new
// text shows at once and rolls back with the error if it rejects.
//
// Titles and descriptions edit in a textarea the width of the text block, so
// the words wrap on the same lines and nothing on the page moves. While a field
// is open the shell holds back page redraws (see shell.js renderMain); the
// 'h3aven:inline-edit-done' event tells it to catch up.

import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

let uid = 0;

export function inlineEdit({ value = '', label, onSave, validate, placeholder = '', multiline = false, variant = 'title' }) {
  const id = `ie-${++uid}`;
  let saved = value;
  let editing = false;

  const text = h('span', { class: 'ie-text' });
  const pencil = h('span', { class: 'ie-pencil', 'aria-hidden': 'true' }, iconEl('pencil', 14));
  const display = h('button', { type: 'button', class: 'ie-display' }, text, pencil);
  // Section titles are one short line; titles and descriptions wrap like their text.
  const wraps = variant !== 'section';
  const field = wraps
    ? h('textarea', { class: 'ie-field', rows: '1', 'aria-label': label, 'aria-describedby': `${id}-msg`, placeholder, spellcheck: 'false' })
    : h('input', { class: 'ie-field', type: 'text', 'aria-label': label, 'aria-describedby': `${id}-msg`, placeholder, autocomplete: 'off', spellcheck: 'false' });
  const save = h('button', { type: 'button', class: 'ie-btn is-save', 'aria-label': `Save ${label.toLowerCase()}` }, iconEl('check', 14));
  const cancel = h('button', { type: 'button', class: 'ie-btn', 'aria-label': 'Cancel' }, iconEl('x', 14));
  const editor = h('span', { class: 'ie-editor', hidden: true }, field, h('span', { class: 'ie-actions' }, save, cancel));
  const message = h('span', { class: 'ie-msg', id: `${id}-msg`, role: 'status', 'aria-live': 'polite' });
  const root = h('span', { class: `ie is-${variant}${multiline ? ' is-multiline' : ''}` }, display, editor, message);

  const paint = () => {
    text.textContent = saved || placeholder;
    text.classList.toggle('is-empty', !saved);
    display.setAttribute('aria-label', `${label}: ${saved || 'empty'}. Edit`);
  };
  // A wrapping field follows its text's height. It lies over the text, which
  // stays in place (invisible) and holds the block's size; the block only grows
  // when the new text needs more lines than the old one had.
  const grow = () => {
    if (!wraps) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
    const inner = field.offsetHeight - 7; // minus the ring's padding and border (they hang outside the text box)
    root.style.minHeight = inner > display.offsetHeight ? `${inner}px` : '';
  };

  function open() {
    if (editing) return;
    editing = true;
    field.value = saved;
    message.textContent = '';
    root.classList.add('is-editing');
    root.classList.remove('is-invalid');
    // Titles and descriptions keep their text in the flow (hidden by .is-editing), so
    // nothing moves; the one-line section field takes the text's place instead.
    if (!wraps) display.hidden = true;
    editor.hidden = false;
    grow();
    field.focus();
    field.select();
  }

  function close() {
    editing = false;
    root.classList.remove('is-editing');
    editor.hidden = true;
    display.hidden = false;
    root.style.minHeight = '';
    window.dispatchEvent(new Event('h3aven:inline-edit-done'));
  }

  async function commit({ refocus = true } = {}) {
    if (!editing) return;
    const next = multiline ? field.value.trim() : field.value.replace(/\s+/g, ' ').trim();
    const problem = validate?.(next);
    if (problem) {
      message.textContent = problem;
      root.classList.add('is-invalid');
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    field.removeAttribute('aria-invalid');
    close();
    if (refocus) display.focus();
    if (next === saved) return;
    const before = saved;
    saved = next; // optimistic: the new text shows straight away
    paint();
    try {
      await onSave(next);
      message.textContent = `${label} saved`;
    } catch (error) {
      saved = before; // roll back, and say why
      paint();
      message.textContent = error?.message || 'Could not save. Try again.';
      root.classList.add('is-invalid');
    }
  }

  function revert() {
    close();
    message.textContent = '';
    root.classList.remove('is-invalid');
    display.focus();
  }

  display.addEventListener('click', open);
  save.addEventListener('mousedown', (event) => event.preventDefault()); // keep the field focused
  save.addEventListener('click', () => commit());
  cancel.addEventListener('mousedown', (event) => event.preventDefault());
  cancel.addEventListener('click', revert);
  field.addEventListener('input', () => {
    grow();
    if (root.classList.contains('is-invalid')) {
      root.classList.remove('is-invalid');
      message.textContent = '';
    }
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // don't close an overlay behind it
      revert();
    } else if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
      event.preventDefault();
      commit();
    }
  });
  // Leaving the component (Tab, a click elsewhere) saves, the way a rename does.
  // (Not when the window itself loses focus: switching apps, or a system popup
  // such as text suggestions, must not save half a word and close the field.)
  root.addEventListener('focusout', (event) => {
    if (!editing || root.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (editing && document.hasFocus() && !root.contains(document.activeElement)) commit({ refocus: false });
    }, 0);
  });

  paint();
  return root;
}
