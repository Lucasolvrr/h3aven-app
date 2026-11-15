// Multi-selection shared by the grid (cards) and the shell (bulk bar).

const selected = new Set();
const listeners = new Set();
let mode = false; // explicit "Select" mode, needed on touch screens (no hover)

function notify() {
  listeners.forEach((listener) => listener());
}

export const selection = {
  has: (id) => selected.has(id),
  ids: () => [...selected],
  get size() {
    return selected.size;
  },
  /** True while cards should behave as checkboxes. */
  get active() {
    return mode || selected.size > 0;
  },
  get mode() {
    return mode;
  },
  toggle(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    notify();
  },
  set(ids) {
    selected.clear();
    ids.forEach((id) => selected.add(id));
    notify();
  },
  setMode(next) {
    mode = next;
    if (!next) selected.clear();
    notify();
  },
  clear() {
    if (!selected.size && !mode) return;
    selected.clear();
    mode = false;
    notify();
  },
  /** Drop ids that no longer exist (deleted elsewhere). */
  prune(isValid) {
    let changed = false;
    for (const id of selected) {
      if (!isValid(id)) {
        selected.delete(id);
        changed = true;
      }
    }
    if (changed) notify();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
