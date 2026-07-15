import { createDemoWorkspace } from './core-demo.js';
import { createRealWorkspace } from './real-workspace.js';
import { VIEW_META, normalizeView, renderView } from './views.js';
import {
  beginDropboxLiveTest,
  backupActiveDropboxSession,
  completeDropboxLiveTest,
  disconnectDropboxSession,
  hasActiveDropboxSession,
  hasStoredDropboxCredential,
  isDropboxCallback,
  restoreDropboxLiveSession,
  syncActiveDropboxSession
} from './dropbox-live.js';

const shell = document.getElementById('app-shell');
const viewRoot = document.getElementById('view');
const title = document.getElementById('view-title');
const kicker = document.getElementById('view-kicker');
const ACTIVE_TRIP_KEY = 'packa:active-trip-id';
const LAST_SYNC_KEY = 'packa:last-successful-dropbox-sync';
const APP_VERSION = '2026-07-15-17';

function storedLastSyncAt() {
  try {
    const value = localStorage.getItem(LAST_SYNC_KEY);
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

let currentView = normalizeView(location.hash);
let coreWorkspace = null;
let realWorkspace = null;
const runtime = {
  dropboxAuthorized: false,
  dropboxCredentialStored: false,
  syncStatus: navigator.onLine === false ? 'offline' : 'local_saved',
  detail: 'Anslut Dropbox för att hämta dina befintliga resor.',
  lastSyncedAt: storedLastSyncAt(),
  appUpdateStatus: navigator.onLine === false ? 'offline' : 'checking',
  appUpdateDetail: navigator.onLine === false ? 'Anslut till internet för att söka efter en ny version.' : 'Kontrollerar den installerade appversionen…',
  error: ''
};

const ui = {
  newTripOpen: false,
  newTripTemplates: new Set(['Basresa']),
  newTripPersons: new Set(),
  copySourceTripId: null,
  tripEditOpen: false,
  customRowOpen: false,
  historyTripId: null,
  filters: { search: '', activities: new Set(), functions: new Set(), persons: new Set() },
  filtersOpen: typeof window.matchMedia === 'function' ? window.matchMedia('(min-width:821px)').matches : true,
  tripFilters: { search: '', person: '', season: '' },
  tripFiltersOpen: typeof window.matchMedia === 'function' ? window.matchMedia('(min-width:821px)').matches : true,
  planGroup: 'category',
  packGroup: 'category',
  groupsOpen: true,
  showBags: typeof window.matchMedia === 'function' ? window.matchMedia('(min-width:821px)').matches : true,
  hidePacked: false,
  hideTaken: false,
  splitItemId: null,
  masterArchiveMode: 'active',
  masterPerson: '',
  masterEditId: null,
  masterNewOpen: false,
  matrixPerson: '',
  matrixGroup: 'category',
  matrixTemplates: new Set(),
  matrixShowArchived: false,
  habitFilters: null,
  newBagOpen: false,
  newPouchOpen: false,
  editBagId: null,
  editPouchId: null,
  restoreReport: null,
  storageStatus: { supported: false, persisted: null, usage: null, quota: null }
};

let pendingRestore = null;
let backgroundSyncPromise = null;
let restoreDropboxPromise = null;
let serviceWorkerRegistration = null;

function setCurrentLinks(view) {
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function currentCore() {
  return coreWorkspace?.snapshot() || null;
}

function storedActiveTripId() {
  try {
    return localStorage.getItem(ACTIVE_TRIP_KEY) || null;
  } catch {
    return null;
  }
}

function rememberActiveTrip() {
  const core = currentCore();
  if (!core?.real) return;
  try {
    if (core.activeTripId) localStorage.setItem(ACTIVE_TRIP_KEY, core.activeTripId);
    else localStorage.removeItem(ACTIVE_TRIP_KEY);
  } catch {
    // IndexedDB är fortfarande sanningskällan om privat läge blockerar localStorage.
  }
}

export function showView(value, { updateHash = true } = {}) {
  const view = normalizeView(value);
  const meta = VIEW_META[view];
  const viewChanged = currentView !== view;
  currentView = view;
  title.textContent = meta.title;
  kicker.textContent = meta.kicker;
  viewRoot.innerHTML = renderView(view, { core: currentCore(), ui, error: runtime.error, status: statusViewModel() });
  viewRoot.dataset.view = view;
  shell.dataset.currentView = view;
  setCurrentLinks(view);
  document.title = `${meta.title} · Packa`;
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (viewChanged) {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
  updateSyncUi();
  updateVersionUi();
  return view;
}

function connectionText(compact = false) {
  const status = navigator.onLine === false ? 'offline' : runtime.syncStatus;
  if (status === 'offline') return compact ? 'Offline' : 'Offline · lokalt sparat';
  if (status === 'syncing') return 'Synkar…';
  if (status === 'synced') return compact ? 'Synkad' : 'Dropbox ansluten';
  if (status === 'action_required') return 'Åtgärd krävs';
  return compact ? 'Ej ansluten' : 'Lokalt sparat · Dropbox ej ansluten';
}

function formattedLastSync(compact = false) {
  if (!runtime.lastSyncedAt) return '';
  const value = new Date(runtime.lastSyncedAt);
  if (!Number.isFinite(value.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', compact
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(value);
}

function appUpdateLabel() {
  return ({
    checking: 'Kontrollerar…',
    current: 'Uppdaterad',
    available: 'Ny version hämtas',
    offline: 'Offline',
    unavailable: 'Kan inte kontrolleras',
    error: 'Kontroll misslyckades'
  })[runtime.appUpdateStatus] || 'Okänd status';
}

function statusViewModel() {
  return {
    syncLabel: connectionText(false),
    syncDetail: runtime.detail,
    lastSync: formattedLastSync(false),
    dropboxAuthorized: runtime.dropboxAuthorized,
    dropboxCredentialStored: runtime.dropboxCredentialStored,
    appVersion: APP_VERSION,
    appUpdateLabel: appUpdateLabel(),
    appUpdateDetail: runtime.appUpdateDetail
  };
}

function updateSyncUi() {
  document.querySelectorAll('[data-sync-detail]').forEach(el => { el.textContent = runtime.detail; });
  document.querySelectorAll('[data-status-sync-state]').forEach(el => { el.textContent = connectionText(false); });
  document.querySelectorAll('[data-status-last-sync]').forEach(el => { el.textContent = formattedLastSync(false) || 'Ingen lyckad synk registrerad på den här enheten'; });
  document.querySelectorAll('[data-status-dropbox-session]').forEach(el => {
    el.textContent = runtime.dropboxAuthorized
      ? 'Aktiv – automatisk synk är igång'
      : (runtime.dropboxCredentialStored ? 'Sparad behörighet finns men kunde inte aktiveras' : 'Inte ansluten på den här enheten');
  });
  document.querySelectorAll('[data-action="connect-dropbox"]').forEach(button => {
    const realData = Boolean(currentCore()?.real);
    button.disabled = runtime.syncStatus === 'syncing';
    if (runtime.syncStatus === 'syncing') button.textContent = 'Synkar privata resor…';
    else if (button.dataset.syncLabel === 'status') button.textContent = runtime.dropboxAuthorized ? 'Synka nu' : (runtime.dropboxCredentialStored ? 'Anslut Dropbox igen' : (realData ? 'Anslut Dropbox och synka' : 'Anslut Dropbox och hämta privata resor'));
    else button.textContent = runtime.dropboxAuthorized || realData ? 'Synka privata resor med Dropbox' : 'Anslut Dropbox och hämta mina resor';
  });
  updateConnectionState();
}

function updateVersionUi() {
  document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = APP_VERSION; });
  document.querySelectorAll('[data-app-update-summary]').forEach(el => { el.textContent = appUpdateLabel(); });
  document.querySelectorAll('[data-app-update-detail]').forEach(el => { el.textContent = runtime.appUpdateDetail; });
  document.querySelectorAll('[data-action="check-app-update"]').forEach(button => {
    button.disabled = runtime.appUpdateStatus === 'checking';
    button.textContent = runtime.appUpdateStatus === 'checking' ? 'Söker efter uppdatering…' : 'Sök efter uppdatering';
  });
}

function setAppUpdateState(appUpdateStatus, appUpdateDetail) {
  runtime.appUpdateStatus = appUpdateStatus;
  runtime.appUpdateDetail = appUpdateDetail;
  updateVersionUi();
}

function setSyncState(syncStatus, detail, { authorized = runtime.dropboxAuthorized } = {}) {
  runtime.syncStatus = syncStatus;
  runtime.detail = detail;
  runtime.dropboxAuthorized = authorized;
  if (authorized) runtime.dropboxCredentialStored = true;
  if (syncStatus === 'synced') {
    runtime.lastSyncedAt = new Date().toISOString();
    try { localStorage.setItem(LAST_SYNC_KEY, runtime.lastSyncedAt); } catch {
      // Tidsstämpeln är hjälpinformation; synkresultatet är fortfarande giltigt.
    }
  }
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
    rememberActiveTrip();
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

function formValues(form) {
  const data = new FormData(form);
  return {
    data,
    text: name => String(data.get(name) || '').trim(),
    list: name => data.getAll(name).map(value => String(value)).filter(Boolean)
  };
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function currentDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function preparePersistentStorage() {
  const storage = navigator.storage;
  if (!storage) return;
  const persistedBefore = typeof storage.persisted === 'function' ? await storage.persisted().catch(() => null) : null;
  const persisted = persistedBefore || (typeof storage.persist === 'function' ? await storage.persist().catch(() => false) : false);
  const estimate = typeof storage.estimate === 'function' ? await storage.estimate().catch(() => ({})) : {};
  ui.storageStatus = {
    supported: true,
    persisted: Boolean(persisted),
    usage: Number.isFinite(estimate.usage) ? estimate.usage : null,
    quota: Number.isFinite(estimate.quota) ? estimate.quota : null
  };
  if (currentView === 'data') showView('data');
}

async function syncOpenSession() {
  if (!hasActiveDropboxSession() || navigator.onLine === false || backgroundSyncPromise) return backgroundSyncPromise;
  backgroundSyncPromise = (async () => {
    try {
      setSyncState('syncing', 'Kontrollerar ändringar från andra enheter…', { authorized: true });
      const result = await syncActiveDropboxSession();
      await realWorkspace?.init({ preferredTripId: currentCore()?.activeTripId || storedActiveTripId() });
      if (realWorkspace?.hasData()) coreWorkspace = realWorkspace;
      rememberActiveTrip();
      setSyncState('synced', `Synkad. ${result.uploadedOps} lokala ändringar skickades och ${result.downloadedOps} fjärändringar hämtades.`, { authorized: true });
      showView(currentView);
      return result;
    } catch (error) {
      setSyncState('action_required', `Synken behöver åtgärdas: ${error.message}`, { authorized: true });
      return null;
    } finally {
      backgroundSyncPromise = null;
    }
  })();
  return backgroundSyncPromise;
}

async function restorePersistedDropboxSession() {
  if (restoreDropboxPromise) return restoreDropboxPromise;
  restoreDropboxPromise = (async () => {
    if (!realWorkspace?.repository) return null;
    runtime.dropboxCredentialStored = await hasStoredDropboxCredential(realWorkspace.repository);
    if (!runtime.dropboxCredentialStored) {
      updateSyncUi();
      return null;
    }
    if (navigator.onLine === false) {
      setSyncState('offline', 'Dropbox-behörigheten är sparad. Synken återupptas automatiskt när enheten är online.', { authorized: false });
      showView(currentView);
      return null;
    }
    setSyncState('syncing', 'Återansluter till Dropbox och kontrollerar ändringar från andra enheter…', { authorized: false });
    try {
      const result = await restoreDropboxLiveSession({ repository: realWorkspace.repository });
      if (!result) return null;
      await realWorkspace.init({ preferredTripId: currentCore()?.activeTripId || storedActiveTripId() });
      if (!realWorkspace.hasData()) throw new Error('Dropbox-synken slutfördes men ingen master hittades');
      coreWorkspace = realWorkspace;
      rememberActiveTrip();
      setSyncState('synced', `Automatisk synk klar. ${result.uploadedOps} lokala ändringar skickades och ${result.downloadedOps} ändringar hämtades.`, { authorized: true });
      showView(currentView);
      return result;
    } catch (error) {
      console.error('Dropbox kunde inte återanslutas.', error);
      setSyncState('action_required', `Dropbox kunde inte återanslutas: ${error.message}`, { authorized: false });
      showView(currentView);
      return null;
    }
  })();
  try {
    return await restoreDropboxPromise;
  } finally {
    restoreDropboxPromise = null;
  }
}

async function checkAppUpdate() {
  if (navigator.onLine === false) {
    setAppUpdateState('offline', 'Anslut till internet för att söka efter en ny version.');
    return null;
  }
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    setAppUpdateState('unavailable', 'Webbläsaren kan inte kontrollera appuppdateringar här.');
    return null;
  }
  setAppUpdateState('checking', 'Kontrollerar om en ny Packa-version finns…');
  try {
    if (!serviceWorkerRegistration) await registerServiceWorker();
    if (!serviceWorkerRegistration) return null;
    await serviceWorkerRegistration.update?.();
    if (serviceWorkerRegistration.waiting || serviceWorkerRegistration.installing) {
      setAppUpdateState('available', 'En ny version hämtas och aktiveras. Appen laddas om automatiskt.');
    } else {
      setAppUpdateState('current', `Version ${APP_VERSION} är den senaste publicerade versionen.`);
    }
    return serviceWorkerRegistration;
  } catch (error) {
    setAppUpdateState('error', `Versionskontrollen misslyckades: ${error.message}`);
    return null;
  }
}

document.addEventListener('click', async event => {
  const actionTarget = event.target.closest('[data-action]');
  const action = actionTarget?.dataset.action;
  if (action) event.preventDefault();

  if (action === 'connect-dropbox') {
    if (hasActiveDropboxSession()) {
      await syncOpenSession();
      return;
    }
    setSyncState('syncing', 'Öppnar Dropbox-auktorisering…');
    beginDropboxLiveTest().catch(error => setSyncState('action_required', error.message));
    return;
  }
  if (action === 'disconnect-dropbox') {
    if (!confirmAction('Koppla från Dropbox på den här enheten? Dina lokala resor ligger kvar.')) return;
    await disconnectDropboxSession(realWorkspace?.repository);
    runtime.dropboxAuthorized = false;
    runtime.dropboxCredentialStored = false;
    setSyncState('local_saved', 'Dropbox är frånkopplad på den här enheten. Dina resor ligger kvar lokalt.', { authorized: false });
    showView('status');
    return;
  }
  if (action === 'check-app-update') {
    await checkAppUpdate();
    return;
  }
  if (action === 'open-new-trip') {
    const core = currentCore();
    if (core?.real && ![...ui.newTripTemplates].some(template => core.templates.includes(template))) {
      ui.newTripTemplates.clear();
      if (core.templates[0]) ui.newTripTemplates.add(core.templates[0]);
    }
    ui.copySourceTripId = null;
    if (!ui.newTripPersons.size && core?.persons?.[0]) ui.newTripPersons.add(core.persons[0]);
    ui.newTripOpen = true;
    showView('resor');
    return;
  }
  if (action === 'close-new-trip') {
    ui.newTripOpen = false;
    ui.copySourceTripId = null;
    showView('resor');
    return;
  }
  if (action === 'toggle-new-template') {
    toggleSetValue(ui.newTripTemplates, actionTarget.dataset.template);
    showView('resor');
    return;
  }
  if (action === 'toggle-new-person') {
    toggleSetValue(ui.newTripPersons, actionTarget.dataset.person);
    showView('resor');
    return;
  }
  if (action === 'create-template') {
    const value = typeof window.prompt === 'function' ? window.prompt('Namn på den nya mallen:') : '';
    if (!value) return;
    await mutateCore(async () => {
      if (typeof coreWorkspace.createTemplate !== 'function') throw new Error('Nya mallar kan bara skapas i den privata mastern');
      const created = await coreWorkspace.createTemplate(value);
      ui.newTripTemplates.add(created);
      ui.matrixTemplates.add(created);
    });
    return;
  }
  if (action === 'open-trip') {
    coreWorkspace.selectTrip(actionTarget.dataset.tripId);
    rememberActiveTrip();
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
    ui.copySourceTripId = source.id;
    ui.newTripOpen = true;
    ui.historyTripId = null;
    ui.newTripTemplates = new Set(source.templates || []);
    ui.newTripPersons = new Set(source.persons || []);
    showView('resor');
    return;
  }
  if (action === 'open-trip-edit') {
    ui.tripEditOpen = true;
    showView(currentView);
    return;
  }
  if (action === 'close-trip-edit') {
    ui.tripEditOpen = false;
    showView(currentView);
    return;
  }
  if (action === 'delete-trip') {
    if (!confirmAction('Ta bort resan helt? Detta kan inte ångras utom via Dropbox-historik eller en JSON-export.')) return;
    ui.tripEditOpen = false;
    await mutateCore(() => coreWorkspace.deleteActiveTrip(), { nextView: 'resor' });
    return;
  }
  if (action === 'unlock-trip') {
    if (!confirmAction('Lås upp resan för redigering? Den återgår till planering.')) return;
    ui.historyTripId = null;
    await mutateCore(() => coreWorkspace.unlockTrip(actionTarget.dataset.tripId), { nextView: 'planera' });
    return;
  }
  if (action === 'archive-trip') {
    if (!confirmAction('Arkivera den klara resan? Den blir skrivskyddad.')) return;
    await mutateCore(() => coreWorkspace.archiveTrip(actionTarget.dataset.tripId), { nextView: 'resor' });
    return;
  }
  if (action === 'toggle-filter') {
    const key = actionTarget.dataset.filterKind === 'activity' ? 'activities' : (actionTarget.dataset.filterKind === 'person' ? 'persons' : 'functions');
    toggleSetValue(ui.filters[key], actionTarget.dataset.filterValue);
    showView(currentView);
    return;
  }
  if (action === 'clear-filters') {
    ui.filters.search = '';
    ui.filters.activities.clear();
    ui.filters.functions.clear();
    ui.filters.persons.clear();
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
  if (action === 'bulk-included') {
    const ids = String(actionTarget.dataset.catalogIds || '').split(',').filter(Boolean);
    const included = actionTarget.dataset.included === 'true';
    if (!ids.length) return;
    if (!confirmAction(`${included ? 'Lägg till' : 'Ta bort'} ${ids.length} synliga artiklar?`)) return;
    await mutateCore(() => coreWorkspace.setIncludedMany(ids, included));
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
  if (action === 'set-plan-group') {
    ui.planGroup = actionTarget.dataset.group === 'activity' ? 'activity' : 'category';
    showView('planera');
    return;
  }
  if (action === 'set-pack-group') {
    ui.packGroup = ['category', 'activity', 'bag'].includes(actionTarget.dataset.group) ? actionTarget.dataset.group : 'category';
    showView('packa');
    return;
  }
  if (action === 'set-groups-open') {
    ui.groupsOpen = actionTarget.dataset.open === 'true';
    showView('planera');
    return;
  }
  if (action === 'open-split') {
    ui.splitItemId = actionTarget.dataset.itemId;
    showView('packa');
    return;
  }
  if (action === 'close-split') {
    ui.splitItemId = null;
    showView('packa');
    return;
  }
  if (action === 'merge-items') {
    await mutateCore(() => coreWorkspace.mergeItems(actionTarget.dataset.mergeKey));
    return;
  }
  if (action === 'finish-trip') {
    const trip = currentCore()?.activeTrip;
    if (!trip) return;
    const packed = trip.items.filter(item => item.packed).length;
    const remaining = trip.items.length - packed;
    const message = remaining
      ? `${packed} av ${trip.items.length} rader är markerade som packade. Avsluta och arkivera ändå? De ${remaining} omarkerade raderna bevaras oförändrade i historiken.`
      : `Alla ${packed} rader är packade. Avsluta och arkivera resan?`;
    if (!confirmAction(message)) return;
    await mutateCore(() => coreWorkspace.finishAndArchiveActiveTrip(), { nextView: 'resor' });
    return;
  }
  if (action === 'clear-trip-filters') {
    ui.tripFilters = { search: '', person: '', season: '' };
    showView('resor');
    return;
  }
  if (action === 'print-trip') {
    if (!currentCore()?.activeTrip) {
      runtime.error = 'Välj en resa innan du skriver ut.';
      showView(currentView);
      return;
    }
    window.print?.();
    return;
  }

  if (action === 'open-new-catalog') {
    ui.masterNewOpen = true;
    ui.masterEditId = null;
    showView('master');
    return;
  }
  if (action === 'edit-catalog') {
    ui.masterEditId = actionTarget.dataset.itemId;
    ui.masterNewOpen = false;
    showView('master');
    return;
  }
  if (action === 'close-catalog-editor') {
    ui.masterEditId = null;
    ui.masterNewOpen = false;
    showView('master');
    return;
  }
  if (action === 'set-master-archive') {
    ui.masterArchiveMode = actionTarget.dataset.mode;
    showView('master');
    return;
  }
  if (action === 'set-catalog-archived') {
    const archived = actionTarget.dataset.archived === 'true';
    if (archived && !confirmAction('Arkivera artikeln? Historiken ligger kvar och artikeln kan återställas.')) return;
    await mutateCore(() => coreWorkspace.setCatalogArchived(actionTarget.dataset.itemId, archived), { nextView: 'master' });
    return;
  }
  if (action === 'toggle-matrix-template') {
    toggleSetValue(ui.matrixTemplates, actionTarget.dataset.template);
    showView('matris');
    return;
  }
  if (action === 'set-matrix-group') {
    ui.matrixGroup = ['category', 'activity', 'function'].includes(actionTarget.dataset.group) ? actionTarget.dataset.group : 'category';
    showView('matris');
    return;
  }
  if (action === 'toggle-catalog-template') {
    await mutateCore(() => coreWorkspace.toggleCatalogTemplate(actionTarget.dataset.itemId, actionTarget.dataset.template), { nextView: 'matris' });
    return;
  }
  if (action === 'open-new-bag') {
    ui.newBagOpen = !ui.newBagOpen;
    ui.editBagId = null;
    showView('bibliotek');
    return;
  }
  if (action === 'open-new-pouch') {
    ui.newPouchOpen = !ui.newPouchOpen;
    ui.editPouchId = null;
    showView('bibliotek');
    return;
  }
  if (action === 'edit-bag') {
    ui.editBagId = actionTarget.dataset.bagId;
    ui.newBagOpen = false;
    showView('bibliotek');
    return;
  }
  if (action === 'edit-pouch') {
    ui.editPouchId = actionTarget.dataset.pouchId;
    ui.newPouchOpen = false;
    showView('bibliotek');
    return;
  }
  if (action === 'set-bag-archived') {
    await mutateCore(() => coreWorkspace.updateBag(actionTarget.dataset.bagId, { archived: actionTarget.dataset.archived === 'true' }), { nextView: 'bibliotek' });
    return;
  }
  if (action === 'set-pouch-archived') {
    await mutateCore(() => coreWorkspace.updatePouch(actionTarget.dataset.pouchId, { archived: actionTarget.dataset.archived === 'true' }), { nextView: 'bibliotek' });
    return;
  }
  if (action === 'export-json') {
    downloadText(`packa-backup-${currentDateStamp()}.json`, JSON.stringify(coreWorkspace.exportLegacy(), null, 2), 'application/json;charset=utf-8');
    return;
  }
  if (action === 'export-csv') {
    downloadText(`packa-artikelmaster-${currentDateStamp()}.csv`, coreWorkspace.exportCatalogCsv(), 'text/csv;charset=utf-8');
    return;
  }
  if (action === 'restore-archive') {
    if (!pendingRestore || !ui.restoreReport) return;
    if (!confirmAction(`Återställ ${ui.restoreReport.items} artiklar och ${ui.restoreReport.trips} resor? Exportera gärna nuvarande JSON först. Åtgärden synkas som nya operationer.`)) return;
    const before = coreWorkspace.exportLegacy();
    const backupName = `packa-before-restore-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`;
    downloadText(backupName, JSON.stringify(before, null, 2), 'application/json;charset=utf-8');
    await mutateCore(async () => {
      if (hasActiveDropboxSession()) await backupActiveDropboxSession(backupName, before);
      await coreWorkspace.restoreArchive(pendingRestore);
    }, { nextView: 'resor' });
    pendingRestore = null;
    ui.restoreReport = null;
    return;
  }

  const link = event.target.closest('[data-view-link]');
  if (!link) return;
  event.preventDefault();
  ui.customRowOpen = false;
  document.querySelector('.mobile-more')?.removeAttribute('open');
  showView(link.dataset.viewLink);
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const values = formValues(form);
  if (form.dataset.form === 'new-trip') {
    await mutateCore(() => coreWorkspace.createTrip({
      name: values.text('name'),
      destination: values.text('destination'),
      dateFrom: values.text('dateFrom'),
      nights: values.text('nights'),
      season: values.text('season'),
      companions: values.text('companions'),
      notes: values.text('notes'),
      persons: [...ui.newTripPersons],
      templates: [...ui.newTripTemplates],
      sourceTripId: values.text('sourceTripId') || null
    }), { nextView: 'planera' });
    ui.newTripOpen = false;
    ui.copySourceTripId = null;
    return;
  }
  if (form.dataset.form === 'edit-trip') {
    ui.tripEditOpen = false;
    await mutateCore(() => coreWorkspace.updateTrip({
      name: values.text('name'), destination: values.text('destination'), dateFrom: values.text('dateFrom'), nights: values.text('nights'),
      season: values.text('season'), companions: values.text('companions'), notes: values.text('notes'), persons: values.list('persons'), templates: values.list('templates')
    }));
    return;
  }
  if (form.dataset.form === 'filter-search') {
    ui.filters.search = values.text('search');
    showView(currentView);
    return;
  }
  if (form.dataset.form === 'trip-filter') {
    ui.tripFilters = { search: values.text('search'), person: values.text('person'), season: values.text('season') };
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width:820px)').matches) ui.tripFiltersOpen = false;
    showView('resor');
    return;
  }
  if (form.dataset.form === 'custom-item') {
    ui.customRowOpen = false;
    await mutateCore(() => coreWorkspace.addCustomItem(values.text('name'), values.text('person')));
    return;
  }
  if (form.dataset.form === 'split-item') {
    ui.splitItemId = null;
    await mutateCore(() => coreWorkspace.splitItem(values.text('itemId'), Number(values.text('quantity')) || 1), { nextView: 'packa' });
    return;
  }
  if (form.dataset.form === 'new-catalog' || form.dataset.form === 'edit-catalog') {
    const fields = {
      name: values.text('name'), person: values.text('person'), category: values.text('category'), department: values.text('department'),
      function: values.text('function'), templates: values.list('templates'), brand: values.text('brand'), model: values.text('model'),
      weight: values.text('weight'), comment: values.text('comment'), howToPack: values.text('howToPack')
    };
    if (form.dataset.form === 'new-catalog') {
      const duplicate = (currentCore().allCatalog || currentCore().catalog).find(item => !item.archived && item.person === fields.person && item.name.toLocaleLowerCase('sv') === fields.name.toLocaleLowerCase('sv'));
      if (duplicate && !confirmAction(`${duplicate.name} finns redan för ${duplicate.person}. Skapa ändå?`)) return;
      ui.masterNewOpen = false;
      ui.masterEditId = null;
      await mutateCore(() => coreWorkspace.createCatalogItem(fields), { nextView: 'master' });
    } else {
      ui.masterNewOpen = false;
      ui.masterEditId = null;
      await mutateCore(() => coreWorkspace.updateCatalogItem(values.text('itemId'), fields), { nextView: 'master' });
    }
    return;
  }
  if (form.dataset.form === 'habit-filter') {
    ui.habitFilters = {
      person: values.text('person'), template: values.text('template'), season: values.text('season'), function: values.text('function'),
      search: values.text('search'), never: values.data.get('never') === 'on'
    };
    showView('vanor');
    return;
  }
  if (form.dataset.form === 'new-bag' || form.dataset.form === 'edit-bag') {
    ui.newBagOpen = false;
    ui.editBagId = null;
    const fields = { name: values.text('name'), compartments: values.text('compartments').split(',').map(value => value.trim()).filter(Boolean) };
    await mutateCore(() => form.dataset.form === 'edit-bag' ? coreWorkspace.updateBag(values.text('bagId'), fields) : coreWorkspace.createBag(fields), { nextView: 'bibliotek' });
    return;
  }
  if (form.dataset.form === 'new-pouch' || form.dataset.form === 'edit-pouch') {
    ui.newPouchOpen = false;
    ui.editPouchId = null;
    await mutateCore(() => form.dataset.form === 'edit-pouch' ? coreWorkspace.updatePouch(values.text('pouchId'), { name: values.text('name') }) : coreWorkspace.createPouch(values.text('name')), { nextView: 'bibliotek' });
    return;
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
  if (control.dataset.action === 'set-person') {
    await mutateCore(() => coreWorkspace.setPerson(control.dataset.itemId, control.value));
  }
  if (control.dataset.action === 'set-master-person') {
    ui.masterPerson = control.value;
    showView('master');
  }
  if (control.dataset.action === 'set-matrix-person') {
    ui.matrixPerson = control.value;
    showView('matris');
  }
  if (control.dataset.action === 'toggle-matrix-archived') {
    ui.matrixShowArchived = control.checked;
    showView('matris');
  }
  if (control.dataset.action === 'select-restore-file') {
    const file = control.files?.[0];
    if (!file) return;
    try {
      const text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      pendingRestore = JSON.parse(text);
      ui.restoreReport = coreWorkspace.validateArchive(pendingRestore);
      runtime.error = '';
    } catch (error) {
      pendingRestore = null;
      ui.restoreReport = null;
      runtime.error = `Arkivfilen kunde inte valideras: ${error.message}`;
    }
    showView('data');
  }
});

document.addEventListener('toggle', event => {
  if (event.target.matches?.('.filter-panel')) ui.filtersOpen = event.target.open;
  if (event.target.matches?.('.trip-filter-panel')) ui.tripFiltersOpen = event.target.open;
}, true);

window.addEventListener('hashchange', () => showView(location.hash, { updateHash: false }));
window.addEventListener('online', () => {
  updateConnectionState();
  if (hasActiveDropboxSession()) syncOpenSession();
  else restorePersistedDropboxSession();
  checkAppUpdate();
});
window.addEventListener('offline', () => {
  updateConnectionState();
  setAppUpdateState('offline', `Version ${APP_VERSION} körs. Anslut till internet för att kontrollera om en nyare version finns.`);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (hasActiveDropboxSession()) syncOpenSession();
  else if (runtime.dropboxCredentialStored) restorePersistedDropboxSession();
});

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    setAppUpdateState('unavailable', 'Webbläsaren kan inte kontrollera appuppdateringar här.');
    return null;
  }
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    serviceWorkerRegistration = registration;
    if (hadController && typeof navigator.serviceWorker.addEventListener === 'function') {
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      }, { once: true });
    }
    registration.addEventListener?.('updatefound', () => {
      setAppUpdateState('available', 'En ny version hämtas och aktiveras. Appen laddas om automatiskt.');
    });
    if (navigator.onLine === false) {
      setAppUpdateState('offline', `Version ${APP_VERSION} körs. Anslut till internet för att kontrollera om en nyare version finns.`);
      return registration;
    }
    setAppUpdateState('checking', 'Kontrollerar om en ny Packa-version finns…');
    if (typeof registration.update === 'function') await registration.update();
    if (registration.waiting || registration.installing) {
      setAppUpdateState('available', 'En ny version hämtas och aktiveras. Appen laddas om automatiskt.');
    } else {
      setAppUpdateState('current', `Version ${APP_VERSION} är den senaste publicerade versionen.`);
    }
    return registration;
  } catch (error) {
    console.warn('Service Worker kunde inte registreras.', error);
    setAppUpdateState(navigator.onLine === false ? 'offline' : 'error', navigator.onLine === false
      ? `Version ${APP_VERSION} körs offline. Versionskontroll kräver internet.`
      : `Versionskontrollen misslyckades: ${error.message}`);
    return null;
  }
}

try {
  realWorkspace = await createRealWorkspace({ preferredTripId: storedActiveTripId() });
  coreWorkspace = realWorkspace.hasData() ? realWorkspace : await createDemoWorkspace();
  rememberActiveTrip();
} catch (error) {
  console.error('Packas lokala datalager kunde inte starta.', error);
  runtime.error = `Datalagret kunde inte starta: ${error.message}`;
}

showView(currentView, { updateHash: !location.hash });
updateConnectionState();
registerServiceWorker();
preparePersistentStorage();

if (isDropboxCallback()) {
  setSyncState('syncing', 'Verifierar Dropbox och hämtar dina privata resor…');
  completeDropboxLiveTest({ repository: realWorkspace?.repository })
    .then(async result => {
      if (!result) return;
      realWorkspace = realWorkspace || await createRealWorkspace({ preferredTripId: storedActiveTripId() });
      await realWorkspace.init({ preferredTripId: currentCore()?.activeTripId || storedActiveTripId() });
      if (!realWorkspace.hasData()) throw new Error('Dropbox-synken slutfördes men ingen master hittades');
      coreWorkspace = realWorkspace;
      rememberActiveTrip();
      ui.historyTripId = null;
      setSyncState(
        'synced',
        `Dina resor är hämtade. ${result.downloadedOps} privata operationer lästes och ${result.uploadedOps} lokala ändringar skickades.`,
        { authorized: true }
      );
      showView('status');
    })
    .catch(error => {
      console.error('Dropbox-synken stoppades.', error);
      history.replaceState(null, '', `${new URL('./', location.href).href}#status`);
      setSyncState('action_required', `Dropbox-synken stoppades: ${error.message}`);
      showView('status');
    });
} else {
  restorePersistedDropboxSession();
}

window.__PACKA__ = Object.freeze({
  get view() { return currentView; },
  get phase() { return currentCore()?.real ? 'real-data' : 'core-demo'; },
  get dataConnected() { return Boolean(currentCore()?.real); },
  get demoOnly() { return !currentCore()?.real; },
  get demoSnapshot() { return currentCore(); },
  get dropboxAuthorized() { return runtime.dropboxAuthorized; },
  get dropboxCredentialStored() { return runtime.dropboxCredentialStored; },
  get syncStatus() { return runtime.syncStatus; },
  get lastSyncedAt() { return runtime.lastSyncedAt; },
  get appVersion() { return APP_VERSION; },
  get appUpdateStatus() { return runtime.appUpdateStatus; }
});
