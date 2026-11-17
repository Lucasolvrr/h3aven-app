// Password strength (after uiarc's password-strength): a new-password field
// that shows how strong the password is while it is typed. Four segments fill
// and change tone, each rule ticks off with a drawn check, the strength word
// rises when it improves and drops when it falls, and an eye with a drawn
// slash shows or hides it. Scoring happens here, on the device.
//
//   const field = passwordStrength({ label: 'New password', minLength: 8 });
//   form.append(field.el);  field.value;  field.suggest()  // fills a strong one, shown
//
// minLength: below it the meter holds at "Too short" (the server's minimum).
// The rules ask for more (12 characters, mixed case, a number, a symbol); they
// guide, they don't block.

import { h } from '../lib/dom.js';

let uid = 0;
const LEVELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const count = (text) => Array.from(text).length; // an emoji counts once

export function createRules(minLength = 12) {
  return [
    { id: 'length', label: `At least ${minLength} characters`, test: (p) => count(p) >= minLength, remaining: (p) => Math.max(0, minLength - count(p)) },
    { id: 'case', label: 'Upper and lowercase letters', test: (p) => /\p{Ll}/u.test(p) && /\p{Lu}/u.test(p) },
    { id: 'number', label: 'At least one number', test: (p) => /\p{N}/u.test(p) },
    { id: 'symbol', label: 'At least one symbol', test: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
  ];
}

/** 0 (empty) to 4: one step per share of rules met, held at 1 ("Too short") below shortLength. */
export function estimateStrength(password, rules, shortLength = 8) {
  if (!password) return { level: 0, label: '', met: [] };
  const met = rules.filter((rule) => rule.test(password)).map((rule) => rule.id);
  if (count(password) < shortLength) return { level: 1, label: 'Too short', met, short: true };
  const level = Math.min(4, Math.max(1, Math.round((met.length / rules.length) * 4)));
  return { level, label: LEVELS[level], met };
}

/** A strong random password, made with the browser's cryptographic generator. */
export function suggestPassword(length = 18) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*?-_+='];
  const all = sets.join('');
  const random = (n) => {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % n;
  };
  const chars = sets.map((set) => set[random(set.length)]); // one of each kind
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const EYE = (maskId) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white" stroke="none"/><path class="pws-slash" pathLength="1" d="M3 3l18 18" stroke="black" stroke-width="5"/></mask>
  <g mask="url(#${maskId})"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></g>
  <path class="pws-slash" pathLength="1" d="M3 3l18 18"/></svg>`;
const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="pws-tick" pathLength="1" d="M4.75 8.25 7 10.5l4.25-4.75"/></svg>';

export function passwordStrength({ label = 'New password', minLength = 8, ruleLength = 12, autocomplete = 'new-password', placeholder = '', onInput } = {}) {
  const id = `pws-${++uid}`;
  const rules = createRules(ruleLength);

  const input = h('input', { class: 'input pws-input', id, type: 'password', autocomplete, autocapitalize: 'off', spellcheck: 'false', required: true, minlength: String(minLength), placeholder, 'aria-describedby': `${id}-rules` });
  const reveal = h('button', { type: 'button', class: 'pws-reveal', 'aria-label': 'Show password', 'aria-pressed': 'false', 'aria-controls': id, html: EYE(`${id}-eye`) });
  const segments = [0, 1, 2, 3].map(() => h('span', { class: 'pws-seg' }, h('span', { class: 'pws-fill' })));
  const meter = h('div', { class: 'pws-meter', role: 'meter', 'aria-label': 'Password strength', 'aria-valuemin': '0', 'aria-valuemax': '4', 'aria-valuenow': '0', 'aria-valuetext': 'No password yet' }, segments);
  const word = h('span', { class: 'pws-word', 'aria-hidden': 'true' });
  const rows = rules.map((rule) => {
    const mark = h('span', { class: 'pws-mark', 'aria-hidden': 'true', html: `<span class="pws-mark-fill"></span>${TICK}` });
    const sr = h('span', { class: 'sr-only' }, ', not met');
    const remaining = h('span', { class: 'pws-remaining', 'aria-hidden': 'true' });
    const li = h('li', { class: 'pws-rule' }, mark, h('span', { class: 'pws-rule-label' }, rule.label, sr), remaining);
    return { rule, li, sr, remaining };
  });
  const status = h('span', { class: 'sr-only', role: 'status' });
  const el = h(
    'div',
    { class: 'pws', 'data-level': '0' },
    h('label', { class: 'field-label', for: id }, label),
    h('div', { class: 'pws-shell' }, input, reveal),
    h('div', { class: 'pws-meter-row' }, meter, word),
    h('ul', { class: 'pws-rules', id: `${id}-rules`, 'aria-label': 'Password requirements' }, rows.map((row) => row.li)),
    status
  );

  let previous = { level: 0, rank: 0, met: new Set() };
  let statusTimer = 0;

  function paint() {
    const value = input.value;
    const strength = estimateStrength(value, rules, minLength);
    const met = new Set(strength.met);
    const rank = strength.short ? 0.5 : strength.level;
    const direction = rank >= previous.rank ? 1 : -1;
    el.dataset.level = String(strength.level);

    // Segments: a jump fills left to right, a drop empties right to left.
    segments.forEach((segment, index) => {
      const on = index < strength.level;
      const wave = on ? index - previous.level : previous.level - 1 - index;
      segment.firstChild.style.transitionDelay = `${Math.max(0, wave) * (on ? 50 : 30)}ms`;
      segment.classList.toggle('is-on', on);
    });
    meter.setAttribute('aria-valuenow', String(strength.level));
    meter.setAttribute('aria-valuetext', strength.level ? strength.label : 'No password yet');

    // The word rises when strength improves and drops when it falls.
    if ((word.firstChild?.textContent || '') !== strength.label) {
      for (const old of [...word.children]) {
        old.className = `pws-word-text is-leaving ${direction > 0 ? 'up' : 'down'}`;
        setTimeout(() => old.remove(), 200);
      }
      if (strength.label) word.append(h('span', { class: `pws-word-text is-entering ${direction > 0 ? 'up' : 'down'}` }, strength.label));
    }

    // Rules: newly met ones tick in a short wave.
    let wave = 0;
    for (const row of rows) {
      const ok = met.has(row.rule.id);
      if (ok !== previous.met.has(row.rule.id)) row.li.style.setProperty('--delay', `${(wave++) * 50}ms`);
      row.li.toggleAttribute('data-met', ok);
      row.sr.textContent = ok ? ', met' : ', not met';
      const left = value && !ok && row.rule.remaining ? row.rule.remaining(value) : 0;
      row.remaining.textContent = left > 0 ? `${left} more` : '';
    }

    // One polite summary once typing pauses.
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = strength.level ? `Strength: ${strength.label}. ${strength.met.length} of ${rules.length} requirements met.` : '';
    }, 400);
    previous = { level: strength.level, rank, met };
    onInput?.(value, strength);
  }

  const setRevealed = (on) => {
    input.type = on ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(on));
    el.classList.toggle('is-revealed', on);
  };
  reveal.addEventListener('click', () => {
    setRevealed(input.type === 'password');
    input.focus();
  });
  input.addEventListener('input', paint);
  paint();

  return {
    el,
    input,
    get value() {
      return input.value;
    },
    get strength() {
      return estimateStrength(input.value, rules, minLength);
    },
    /** Fills in a strong password and shows it, so it can be read and saved. */
    suggest() {
      input.value = suggestPassword();
      setRevealed(true);
      paint();
      return input.value;
    },
    reset() {
      input.value = '';
      setRevealed(false);
      paint();
    },
  };
}
