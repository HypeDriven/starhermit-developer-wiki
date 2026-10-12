import { CloudSaveStore } from './cloud-save-store.js';

const sh = globalThis.StarHermit;
const el = id => document.getElementById(id);
const valid = value => value?.version === 1 && Number.isSafeInteger(value.points) && value.points >= 0;
let mode = 'menu';
let progress = { version: 1, points: 0 };
let store;
let displayedTerms;
let busy = false;
let generation = 0; // Ignore completions after the player changes entry mode.

function show(section) {
  for (const id of ['entry', 'terms', 'game']) el(id).hidden = id !== section;
}
function message(text = '') { el('message').textContent = text; }
function render() {
  el('points').textContent = progress.points;
  el('collect').disabled = busy || (mode === 'account' && !store?.loaded);
}
function entry() {
  generation++;
  mode = 'menu';
  busy = false;
  sh.autoRefresh = false;
  // Stop an already-scheduled refresh while the player is choosing a mode.
  if (sh.token) sh.setToken(sh.token);
  show('entry');
  el('account').textContent = sh.signedIn ? 'Continue with your StarHermit account' : 'Sign in with StarHermit';
  el('account').disabled = !sh.signedIn && !sh.canSignIn();
  el('entry-note').textContent = el('account').disabled
    ? 'Account play is available when this game is hosted on StarHermit.' : '';
}

async function showTerms() {
  displayedTerms = await sh.getTerms();
  if (!displayedTerms?.hash || typeof displayedTerms.text !== 'string') throw new Error('Terms could not be loaded.');
  el('terms-text').textContent = displayedTerms.text;
  show('terms');
  message();
}

async function startAccount() {
  const current = ++generation;
  mode = 'account';
  busy = true;
  show('game');
  el('mode').textContent = 'Account play · progress saved to StarHermit';
  el('sync').textContent = 'Loading cloud progress…';
  el('retry').hidden = true;
  el('reload').hidden = true;
  render();
  try {
    store = new CloudSaveStore({ gameId: sh.slug, token: () => sh.token });
    const remote = await store.load(valid);
    if (current !== generation) return;
    progress = remote ?? { version: 1, points: 0 };
    sh.autoRefresh = true;
    sh.setToken(sh.token); // Start renewal only after choosing account play.
    el('sync').textContent = remote ? 'Cloud progress loaded' : 'No saved progress yet';
    message();
  } catch (error) {
    if (current !== generation) return;
    el('sync').textContent = 'Progress could not be loaded. Saving is blocked.';
    if (error.body?.error === 'terms_acceptance_required') {
      try { await showTerms(); } catch (termsError) { message(termsError.message); }
    } else {
      message(error.status === 401 ? 'Your session expired. Return to the start and sign in again.' : error.message);
      if (error.status === 401) sh.signOut('expired');
      el('reload').hidden = false;
    }
  } finally {
    if (current === generation) { busy = false; render(); }
  }
}

async function save() {
  if (mode !== 'account' || busy || !store?.loaded) return;
  const current = generation;
  busy = true;
  render();
  el('sync').textContent = 'Saving…';
  try {
    await store.save(progress);
    if (current === generation) {
      el('sync').textContent = 'Saved';
      el('retry').hidden = true;
      el('reload').hidden = true;
      message();
    }
  } catch (error) {
    if (current !== generation) return;
    el('sync').textContent = 'Progress is not saved';
    if (error.status === 412) message('Another tab or device saved newer progress. Load that copy before continuing.');
    else message(error.message);
    // Ambiguous writes require a new load; known failures may retry with the
    // same condition. The visible reload action makes any loss of local play explicit.
    el('reload').hidden = !!store.loaded;
    el('retry').hidden = !store.loaded;
  } finally {
    if (current === generation) { busy = false; render(); }
  }
}

el('account').onclick = () => {
  if (sh.signedIn) startAccount();
  else sh.signIn();
};
el('guest').onclick = () => {
  generation++;
  sh.signOut('single-player'); // No account calls or background renewal in this mode.
  mode = 'guest';
  store = null;
  busy = false;
  progress = { version: 1, points: 0 };
  show('game');
  el('mode').textContent = 'Single player · progress stays in this play session';
  el('sync').textContent = "Progress isn't tracked or saved";
  el('retry').hidden = true;
  el('reload').hidden = true;
  message();
  render();
};
el('collect').onclick = () => {
  if (busy || (mode === 'account' && !store?.loaded)) return;
  if (progress.points === Number.MAX_SAFE_INTEGER) return;
  progress = { ...progress, points: progress.points + 1 };
  render();
  if (mode === 'account') save();
};
el('accept').onclick = async () => {
  if (!displayedTerms || busy) return;
  busy = true;
  el('accept').disabled = true;
  try {
    await sh.acceptTerms(displayedTerms.hash); // Explicit click accepts this exact displayed revision.
    busy = false;
    await startAccount();
  } catch (error) {
    if (error.status === 409) {
      await showTerms();
      message('The terms changed. Read this revision and choose whether to accept it.');
    } else message(error.message);
  } finally { busy = false; el('accept').disabled = false; }
};
el('decline').onclick = entry;
el('menu').onclick = entry;
el('retry').onclick = save;
el('reload').onclick = startAccount;
sh.on('auth', event => {
  if (mode === 'account' && !event.signedIn) {
    generation++;
    busy = false;
    if (store) store.loaded = false;
    render();
    message('Your account session ended. Return to the start to sign in.');
  }
});
sh.on('termsrequired', () => {
  if (mode !== 'account') return;
  if (store) store.loaded = false;
  render();
  showTerms().catch(error => message(error.message));
});
entry();
