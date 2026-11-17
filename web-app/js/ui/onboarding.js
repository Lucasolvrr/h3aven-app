// Getting started: the three things that make h3aven click, as a checklist
// (ui/checklist.js) in Settings and, until they are done, on Home.
//
// Progress comes from the app itself: the extension is connected, a link is
// saved, a collection exists. A step can also be ticked by hand (say, no
// extension on this computer); that choice is kept in this browser.

import { STORAGE } from '../config.js';
import { readJson, writeJson } from '../lib/dom.js';
import { state } from '../data/store.js';
import { extension } from '../services/extension.js';
import { createChecklist } from './checklist.js';
import { confetti } from './confetti.js';
import { openQuickAdd, openCategoryDialog } from './dialogs.js';

const STEPS = [
  {
    id: 'extension',
    title: 'Add the browser extension',
    description: 'Save the page you’re on from the toolbar, in one click.',
    actionLabel: 'Set up',
    onAction: () => {
      location.hash = '#/connect';
    },
  },
  {
    id: 'link',
    title: 'Save your first link',
    description: 'Paste any link and it lands in your library with its preview.',
    actionLabel: 'Save a link',
    onAction: () => openQuickAdd(),
  },
  {
    id: 'collection',
    title: 'Create your first collection',
    description: 'Group links by project or topic, with folders inside.',
    actionLabel: 'New collection',
    onAction: () => openCategoryDialog(),
  },
];

let card = null;
let cardOwner = null; // which account (or preview) the card was built for
let extensionConnected = null; // null until the extension has answered (or not)
let extensionAskedAt = 0;
let sawUnfinished = false; // this visit had steps to do: keep the card on Home to show it finishing
let redraw = () => {}; // the page, once the extension's answer changes what Home shows
let celebrated = false; // the last step was done in this visit and Home has said goodbye

const storageKey = () => `${STORAGE.onboarding}:${state.user?.id || 'local'}`;
const prefs = () => readJson(storageKey(), { manual: [], hidden: false });
const savePrefs = (patch) => writeJson(storageKey(), { ...prefs(), ...patch });

function progress() {
  const manual = new Set(prefs().manual);
  const auto = {
    extension: extensionConnected === true,
    link: state.bookmarks.length > 0,
    collection: state.categories.length > 0,
  };
  const done = Object.fromEntries(STEPS.map((step) => [step.id, auto[step.id] || manual.has(step.id)]));
  return { done, auto };
}

const finished = () => Object.values(progress().done).every(Boolean);

/** Asks the extension whether it is connected (at most every few seconds); the card updates when it answers. */
function checkExtension() {
  if (Date.now() - extensionAskedAt < 4000) return;
  extensionAskedAt = Date.now();
  const firstAnswer = extensionConnected === null;
  extension.status().then((status) => {
    const connected = Boolean(status?.connected);
    if (connected === extensionConnected) return;
    extensionConnected = connected;
    // The first answer only says how things already were: no tick animation for that.
    card?.update(progress(), { instant: firstAnswer });
    if (firstAnswer) redraw();
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** All done: confetti from the ring; on Home the card then folds away for good. */
async function celebrate() {
  const el = card?.el;
  if (!el?.isConnected) return;
  const ring = el.querySelector('.ocl-ring').getBoundingClientRect();
  confetti({ x: ring.left + ring.width / 2, y: ring.top + ring.height / 2 });
  const wrap = el.closest('.home-onboarding');
  if (!wrap) return; // Settings keeps showing "You're all set"
  await wait(1200);
  if (wrap.isConnected) {
    wrap.style.height = `${wrap.offsetHeight}px`;
    void wrap.offsetHeight; // start from the measured height
    wrap.classList.add('is-leaving');
    wrap.style.height = '0px';
    await wait(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520);
  }
  celebrated = true;
  redraw();
}

function getCard() {
  const owner = state.user?.id || 'local';
  if (!card || cardOwner !== owner) {
    cardOwner = owner;
    card = createChecklist({
      title: 'Get started with h3aven',
      doneTitle: 'You’re all set',
      steps: STEPS,
      hidden: prefs().hidden,
      onHiddenChange: (hidden) => savePrefs({ hidden }),
      onComplete: celebrate,
      onToggle: (id, done) => {
        const manual = new Set(prefs().manual);
        if (done) manual.add(id);
        else manual.delete(id);
        savePrefs({ manual: [...manual] });
        card.update(progress());
      },
    });
    card.update(progress());
  } else {
    card.update(progress());
  }
  checkExtension();
  return card;
}

/**
 * The checklist for a page. Settings always shows it; Home only while
 * something is left to do (and through the visit in which it gets finished).
 * Returns the same element each time, so its animations survive re-renders.
 */
export function onboardingCard({ where, rerender }) {
  if (!state.ready) return null;
  if (rerender) redraw = rerender;
  const { done } = progress();
  const known = extensionConnected !== null;
  // Until the extension answers, only the other steps can say "unfinished".
  const unfinished = known ? !finished() : !(done.link && done.collection);
  if (unfinished) sawUnfinished = true;
  if (where === 'home' && celebrated) return null;
  if (where === 'home' && !unfinished && !sawUnfinished) {
    if (!known) checkExtension(); // ask; Home redraws when the answer comes
    return null;
  }
  return getCard().el;
}
