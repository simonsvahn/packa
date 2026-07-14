import { createDemoWorkspace } from './core-demo.js';
import { createRealWorkspace } from './real-workspace.js';
import { VIEW_META, normalizeView, renderView } from './views.js';
import {
  beginDropboxLiveTest,
  completeDropboxLiveTest,
  hasActiveDropboxSession,
  isDropboxCallback,
  syncActiveDropboxSession
} from './dropbox-live.js';

const shell = document.getElementById('app-shell');
const viewRoot = document.getElementById('view');
const title = document.getElementById('view-title');
const kicker = document.getElementById('view-kicker');

let currentView = normalizeView(location.hash);
let coreWorkspace = null;
let realWorkspace = null;
const runtime = {
  dropboxAuthorized: false,
  syncStatus: navigator.onLine === false ? 'offline' : 'local_saved',
  detail: 'Anslut Dropbox för att hämta dina befintliga resor.',
  error: ''
};

const ui = {
  newTripOpen: false,
  newTripTemplates: new Set(['Basresa']),
  customRowOpen: false,
  historyTripId: null,
  filters: { search: '', activities: new Set(), functions: new Set() },
  showBags: true,
  hidePacked: false,
  hideTaken: false
};

const STATUS_LABEL = {
  offline: 'Offline · lokalt sparat',
  local_saved: 'Lokalt sparat · Dropbox ej ansluten',
  syncing: 'Synkar med Dropbox…',
  synced: 'Synkad med Dropbox',
  action_required: 'Åtgärd krävs'
};

function setCurrentLinks(view) {
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function currentCore() {
  return coreWorkspace?.snapshot() || null;
}

export function showView(value, { updateHash = true } = {}) {
  const view = normalizeView(value);
  const meta = VIEW_META[view];
  currentView = view;
  title.textContent = meta.title;
  kicker.textContent = meta.kicker;
  viewRoot.innerHTML = renderView(view, { core: currentCore(), ui, error: runtime.error });
  viewRoot.dataset.view = view;
  setCurrentLinks(view);
  document.title = `${meta.title} · Packa`;
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  updateSyncUi();
  return view;
}

function connectionText(compact = false) {
  const status = navigator.onLine === false ? 'offline' : runtime.syncStatus;
  const full = STATUS_LABEL[status] || STATUS_LABEL.local_saved;
  if (!compact) return full;
  if (status === 'offline') return 'Offline';
  if (status === 'syncing') return 'Synkar…';
  if (status === 'synced') return 'Synkad';
  if (status === 'action_required') return 'Åtgärd krävs';
  return 'Dropbox ej ansluten';
}

function updateSyncUi() {
  document.querySelectorAll('[data-sync-detail]').forEach(el => { el.textContent = runtime.detail; });
  document.querySelectorAll('[data-action="connect-dropbox"]').forEach(button => {
    const realData = Boolean(currentCore()?.real);
    button.disabled = runtime.syncStatus === 'syncing';
    button.textContent = runtime.syncStatus === 'syncing'
      ? 'Synkar privata resor…'
      : (runtime.dropboxAuthorized || realData ? 'Synka privata resor med Dropbox' : 'Anslut Dropbox och hämta mina resor');
  });
  updateConnectionState();
}

function setSyncState(syncStatus, detail, { authorized = runtime.dropboxAuthorized } = {}) {
  runtime.syncStatus = syncStatus;
  runtime.detail = detail;
  runtime.dropboxAuthorized = authorized;
  updateSyncUi();
}

export function updateConnectionState() {
  const offline = navigator.onLine === false;
  shell.classList.toggle('offline', offline);
  document.querySelectorAll('[data-connection-label]').forEach(el => { el.textContent = connectionText(el.classList.contains('connection-chip')); });
  document.querySelectorAll('.status-dot').forEach(el => { el.classList.toggle('offline', offline); });
}

function confirmAction(message) {
  return typeof window.confirm !== 'function' || window.confirm(message);
}

async function mutateCore(mutation, { nextView = currentView } = {}) {
  if (!coreWorkspace) return;
  try {
    await mutation();
    runtime.error = '';
    if (hasActiveDropboxSession() && currentCore()?.real) {
      setSyncState('syncing', 'Ändringen är lokalt sparad och synkas nu…', { authorized: true });
      const result = await syncActiveDropboxSession();
      setSyncState('synced', `Synkad. ${result.uploadedOps} lokala ändringar skickades och ${result.downloadedOps} fjärändringar hämtades.`, { authorized: true });
    }
  } catch (error) {
    console.error('Ändringen stoppades.', error);
    runtime.error = error.message;
  }
  showView(nextView);
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

document.addEventListener('click', async event => {
  const actionTarget = event.target.closest('[data-action]');
  const action = actionTarget?.dataset.action;
  if (action) event.preventDefault();

  if (action === 'connect-dropbox') {
    setSyncState('syncing', 'Öppnar Dropbox-auktorisering…');
    beginDropboxLiveTest().catch(error => setSyncState('action_required', error.message));
    return;
  }
  if (action === 'open-new-trip') {
    const core = currentCore();
    if (core?.real && ![...ui.newTripTemplates].some(template => core.templates.includes(template))) {
      ui.newTripTemplates.clear();
      if (core.templates[0]) ui.newTripTemplates.add(core.templates[0]);
    }
    ui.newTripOpen = true;
    showView('resor');
    return;
  }
  if (action === 'close-new-trip') {
    ui.newTripOpen = false;
    showView('resor');
    return;
  }
  if (action === 'toggle-new-template') {
    toggleSetValue(ui.newTripTemplates, actionTarget.dataset.template);
    const active = ui.newTripTemplates.has(actionTarget.dataset.template);
    actionTarget.classList.toggle('active', active);
    actionTarget.setAttribute('aria-pressed', String(active));
    const preview = currentCore().catalog.filter(item => item.templates.some(template => ui.newTripTemplates.has(template))).length;
    const previewLabel = document.querySelector('.preview-count b');
    if (previewLabel) previewLabel.textContent = `${preview} artiklar förbockas`;
    return;
  }
  if (action === 'open-trip') {
    coreWorkspace.selectTrip(actionTarget.dataset.tripId);
    ui.customRowOpen = false;
    showView(actionTarget.dataset.targetView || 'planera');
    return;
  }
  if (action === 'open-history') {
    ui.historyTripId = actionTarget.dataset.tripId;
    showView('resor');
    return;
  }
  if (action === 'close-history') {
    ui.historyTripId = null;
    showView('resor');
    return;
  }
  if (action === 'copy-trip') {
    const source = currentCore().trips.find(trip => trip.id === actionTarget.dataset.tripId);
    if (!source) return;
    await mutateCore(() => coreWorkspace.createTrip({
      name: `${source.name} – kopia`,
      destination: source.destination,
      sourceTripId: source.id
    }), { nextView: 'planera' });
    return;
  }
  if (action === 'toggle-filter') {
    const key = actionTarget.dataset.filterKind === 'activity' ? 'activities' : 'functions';
    toggleSetValue(ui.filters[key], actionTarget.dataset.filterValue);
    showView(currentView);
    return;
  }
  if (action === 'clear-filters') {
    ui.filters.search = '';
    ui.filters.activities.clear();
    ui.filters.functions.clear();
    showView(currentView);
    return;
  }
  if (action === 'set-included') {
    const catalogId = actionTarget.dataset.catalogId;
    const included = actionTarget.dataset.included === 'true';
    const rows = currentCore().activeTrip.items.filter(item => item.catalogId === catalogId);
    if (!included && rows.length > 1 && !confirmAction(`Artikeln är uppdelad på ${rows.length} rader. Ta bort alla delrader?`)) return;
    await mutateCore(() => coreWorkspace.setIncluded(catalogId, included));
    return;
  }
  if (action === 'quantity') {
    const next = Number(actionTarget.dataset.next);
    if (next === 0 && !confirmAction('Antal 0 tar bort raden från resan. Fortsätta?')) return;
    await mutateCore(() => coreWorkspace.setQuantity(actionTarget.dataset.itemId, next));
    return;
  }
  if (action === 'open-custom-row') {
    ui.customRowOpen = true;
    showView(currentView);
    return;
  }
  if (action === 'close-custom-row') {
    ui.customRowOpen = false;
    showView(currentView);
    return;
  }
  if (action === 'start-packing') {
    await mutateCore(() => coreWorkspace.setTripStatus('packing'), { nextView: 'packa' });
    return;
  }
  if (action === 'toggle-taken') {
    await mutateCore(() => coreWorkspace.toggleTaken(actionTarget.dataset.itemId));
    return;
  }
  if (action === 'toggle-packed') {
    await mutateCore(() => coreWorkspace.togglePacked(actionTarget.dataset.itemId));
    return;
  }
  if (action === 'toggle-pack-view') {
    const key = actionTarget.dataset.packKey;
    if (['showBags', 'hidePacked', 'hideTaken'].includes(key)) ui[key] = !ui[key];
    showView('packa');
    return;
  }
  if (action === 'split-item') {
    await mutateCore(() => coreWorkspace.splitItem(actionTarget.dataset.itemId));
    return;
  }
  if (action === 'merge-items') {
    await mutateCore(() => coreWorkspace.mergeItems(actionTarget.dataset.mergeKey));
    return;
  }
  if (action === 'finish-trip') {
    if (!confirmAction('Avsluta resan och markera den som klar?')) return;
    await mutateCore(() => coreWorkspace.setTripStatus('complete'), { nextView: 'resor' });
    return;
  }

  const link = event.target.closest('[data-view-link]');
  if (!link) return;
  event.preventDefault();
  ui.customRowOpen = false;
  showView(link.dataset.viewLink);
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const values = new FormData(form);
  if (form.dataset.form === 'new-trip') {
    await mutateCore(() => coreWorkspace.createTrip({
      name: values.get('name'),
      destination: values.get('destination'),
      templates: [...ui.newTripTemplates]
    }), { nextView: 'planera' });
    ui.newTripOpen = false;
    return;
  }
  if (form.dataset.form === 'filter-search') {
    ui.filters.search = String(values.get('search') || '');
    showView(currentView);
    return;
  }
  if (form.dataset.form === 'custom-item') {
    ui.customRowOpen = false;
    await mutateCore(() => coreWorkspace.addCustomItem(values.get('name')));
  }
});

document.addEventListener('change', async event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  if (control.dataset.action === 'set-bag') {
    await mutateCore(() => coreWorkspace.setBag(control.dataset.itemId, control.value));
  }
  if (control.dataset.action === 'set-location') {
    await mutateCore(() => coreWorkspace.setLocation(control.dataset.itemId, control.value));
  }
});

window.addEventListener('hashchange', () => showView(location.hash, { updateHash: false }));
window.addEventListener('online', updateConnectionState);
window.addEventListener('offline', updateConnectionState);

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (error) {
    console.warn('Service Worker kunde inte registreras.', error);
    return null;
  }
}

try {
  realWorkspace = await createRealWorkspace();
  coreWorkspace = realWorkspace.hasData() ? realWorkspace : await createDemoWorkspace();
} catch (error) {
  console.error('Packas lokala datalager kunde inte starta.', error);
  runtime.error = `Datalagret kunde inte starta: ${error.message}`;
}

showView(currentView, { updateHash: !location.hash });
updateConnectionState();
registerServiceWorker();

if (isDropboxCallback()) {
  setSyncState('syncing', 'Verifierar Dropbox och hämtar dina privata resor…');
  completeDropboxLiveTest({ repository: realWorkspace?.repository })
    .then(async result => {
      if (!result) return;
      realWorkspace = realWorkspace || await createRealWorkspace();
      await realWorkspace.init();
      if (!realWorkspace.hasData()) throw new Error('Dropbox-synken slutfördes men ingen master hittades');
      coreWorkspace = realWorkspace;
      ui.historyTripId = null;
      setSyncState(
        'synced',
        `Dina resor är hämtade. ${result.downloadedOps} privata operationer lästes och ${result.uploadedOps} lokala ändringar skickades.`,
        { authorized: true }
      );
      showView('resor');
    })
    .catch(error => {
      console.error('Dropbox-synken stoppades.', error);
      history.replaceState(null, '', `${new URL('./', location.href).href}#resor`);
      setSyncState('action_required', `Dropbox-synken stoppades: ${error.message}`);
    });
}

window.__PACKA__ = Object.freeze({
  get view() { return currentView; },
  get phase() { return currentCore()?.real ? 'real-data' : 'core-demo'; },
  get dataConnected() { return Boolean(currentCore()?.real); },
  get demoOnly() { return !currentCore()?.real; },
  get demoSnapshot() { return currentCore(); },
  get dropboxAuthorized() { return runtime.dropboxAuthorized; },
  get syncStatus() { return runtime.syncStatus; }
});
