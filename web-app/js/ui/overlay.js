// Floating UI primitives: modal stack, menus, toasts, confirm / prompt.
// Every overlay in the app is built on these so focus handling, Escape and
// click-outside behave the same everywhere.

import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';

const overlayRoot = () => document.getElementById('overlays');
const stack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function hasOpenModal() {
  return stack.length > 0;
}

/**
 * openModal({ content, className, align: 'center' | 'top' | 'dock', label, onClose })
 * align 'dock': a glass sheet that grows out of the search dock (creation flows).
 * Returns { close, panel }.
 */
export function openModal({ content, className = '', align = 'center', label = 'Dialog', onClose, dismissible = true }) {
  const previousFocus = document.activeElement;
  const panel = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, content);
  // Anchor to the dock when it is on screen; otherwise fall back to the centre.
  const dock = align === 'dock' ? document.querySelector('.dock') : null;
  const dockRect = dock && dock.getBoundingClientRect();
  const docked = Boolean(dockRect && dockRect.width && getComputedStyle(dock).visibility !== 'hidden');
  if (docked) {
    panel.classList.add('is-docked', 'glass');
    panel.style.left = `${dockRect.left + dockRect.width / 2}px`;
    panel.style.bottom = `${window.innerHeight - dockRect.top + 8}px`;
    panel.style.width = `${dockRect.width}px`;
    panel.style.maxHeight = `${Math.max(200, dockRect.top - 24)}px`;
  }
  const overlay = h('div', { class: `overlay ${align === 'top' ? 'overlay-top' : ''}${docked ? ' overlay-dock' : ''}` }, panel);
  const entry = { closed: false };

  entry.close = () => {
    if (entry.closed) return;
    entry.closed = true;
    stack.splice(stack.indexOf(entry), 1);
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 140);
    onClose?.();
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
  };

  // mousedown (not click) so a text selection dragged out of the panel
  // doesn't dismiss the dialog.
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && dismissible) entry.close();
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  overlayRoot().append(overlay);
  stack.push(entry);
  (panel.querySelector('[autofocus]') || panel).focus({ preventScroll: true });
  return { close: entry.close, panel };
}

// --- Menus -------------------------------------------------------------------

let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return false;
  const { menu, anchor, onOutside } = activeMenu;
  activeMenu = null;
  menu.remove();
  anchor?.removeAttribute('aria-expanded');
  document.removeEventListener('mousedown', onOutside, true);
  return true;
}

/**
 * items: { label, icon, onSelect, danger, checked, hint, indent, disabled }
 *        | { separator: true } | { heading: 'Text' } | null (skipped)
 */
/**
 * items: { label, icon, hint, onSelect, danger, indent, disabled, checked }
 *   checkbox: true  — a toggle; the menu stays open and onSelect(checked) gets the new state
 *   input: { placeholder, onSubmit(value) } — a text field; onSubmit may return an item to add above it
 *   heading / separator
 */
export function openMenu(anchor, items, { align = 'start' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });

  const renderItem = (item) => {
    if (item.separator) return h('div', { class: 'menu-sep', role: 'separator' });
    if (item.heading) return h('div', { class: 'menu-label' }, item.heading);
    if (item.input) {
      const field = h('input', { class: 'menu-input', type: 'text', placeholder: item.input.placeholder, 'aria-label': item.input.placeholder, autocomplete: 'off', maxlength: '40' });
      const row = h('label', { class: 'menu-input-row' }, iconEl('plus', 14), field);
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const value = field.value.trim();
        if (!value) return;
        field.value = '';
        const added = item.input.onSubmit(value);
        if (added) row.before(renderItem(added));
      });
      return row;
    }
    const button = h(
      'button',
      {
        type: 'button',
        role: item.checkbox ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': item.checkbox ? String(Boolean(item.checked)) : null,
        class: `menu-item${item.danger ? ' is-danger' : ''}${item.indent ? ' is-indent' : ''}${item.checkbox ? ' is-checkbox' : ''}`,
        disabled: item.disabled,
        onClick: () => {
          if (item.checkbox) {
            const next = button.getAttribute('aria-checked') !== 'true';
            button.setAttribute('aria-checked', String(next));
            item.onSelect?.(next);
            return;
          }
          closeMenu();
          item.onSelect?.();
        },
      },
      item.checkbox ? h('span', { class: 'menu-box', 'aria-hidden': 'true' }, iconEl('check', 11)) : item.icon && iconEl(item.icon, 15),
      h('span', { class: 'menu-text' }, item.label),
      item.hint && h('span', { class: 'menu-hint' }, item.hint),
      !item.checkbox && item.checked && iconEl('check', 14, 'menu-tick')
    );
    return button;
  };
  for (const item of items) if (item) menu.append(renderItem(item));

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = menu;
  let left = align === 'end' ? rect.right - width : rect.left;
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  document.addEventListener('mousedown', onOutside, true);
  anchor.setAttribute('aria-expanded', 'true');

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });

  activeMenu = { menu, anchor, onOutside };
  menu.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (closeMenu()) {
    event.preventDefault();
    return;
  }
  const top = stack[stack.length - 1];
  if (top) {
    event.preventDefault();
    top.close();
  }
});
window.addEventListener('resize', closeMenu);
window.addEventListener('hashchange', closeMenu);

// --- Toasts ------------------------------------------------------------------

const TOAST_ICON = { success: 'check', error: 'alert', info: 'info' };

export function toast(message, { type = 'success', action } = {}) {
  const host = document.getElementById('toasts');
  const el = h(
    'div',
    { class: `toast is-${type}`, role: type === 'error' ? 'alert' : 'status' },
    iconEl(TOAST_ICON[type] || 'info', 15),
    h('span', null, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onClick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label
      )
  );
  function dismiss() {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  }
  host.append(el);
  setTimeout(dismiss, type === 'error' ? 5200 : action ? 4600 : 3000);
}

/** Runs an async action and reports failure as a toast. Returns true on success. */
export async function attempt(action, successMessage) {
  try {
    await action();
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    console.error(error);
    toast(error.message || 'Something went wrong', { type: 'error' });
    return false;
  }
}

// --- Confirm / prompt ---------------------------------------------------------

export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = openModal({
      label: title,
      onClose: () => resolve(answer),
      content: h(
        'div',
        { class: 'dialog' },
        h('h2', { class: 'dialog-title' }, title),
        message && h('p', { class: 'dialog-text' }, message),
        h(
          'div',
          { class: 'dialog-foot' },
          h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'),
          h(
            'button',
            {
              type: 'button',
              class: `btn ${danger ? 'btn-subtle btn-danger' : 'btn-primary'}`,
              autofocus: true,
              onClick: () => {
                answer = true;
                modal.close();
              },
            },
            confirmLabel
          )
        )
      ),
    });
  });
}

/**
 * A one-field dialog. `onSubmit(value)` may throw: the message is shown
 * inline and the dialog stays open, so validation lives with the action.
 */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', align = 'center', onSubmit }) {
  const input = h('input', { class: 'input', type: 'text', value, placeholder, autofocus: true, autocomplete: 'off', maxlength: '80' });
  const error = h('p', { class: 'field-error', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, confirmLabel);
  const form = h(
    'form',
    { class: 'dialog' },
    h('h2', { class: 'dialog-title' }, title),
    h('label', { class: 'field' }, label && h('span', { class: 'field-label' }, label), input, error),
    h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'), submit)
  );
  const modal = openModal({ label: title, content: form, align });
  input.select();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await onSubmit(input.value);
      modal.close();
    } catch (err) {
      error.textContent = err.message || 'Something went wrong';
      error.hidden = false;
      submit.disabled = false;
      input.focus();
    }
  });
  return modal;
}
