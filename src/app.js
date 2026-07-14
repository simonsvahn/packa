import { VIEW_META, normalizeView, renderView } from './views.js';
import { beginDropboxLiveTest, completeDropboxLiveTest, isDropboxCallback } from './dropbox-live.js';

const shell = document.getElementById('app-shell');
const viewRoot = document.getElementById('view');
const title = document.getElementById('view-title');
const kicker = document.getElementById('view-kicker');

let currentView = normalizeView(location.hash);
const runtime = {
  dropboxAuthorized: false,
  syncStatus: navigator.onLine === false ? 'offline' : 'local_saved',
  detail: 'Ingen skarp data är ansluten.'
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

export function showView(value, { updateHash = true } = {}) {
  const view = normalizeView(value);
  const meta = VIEW_META[view];
  currentView = view;
  title.textContent = meta.title;
  kicker.textContent = meta.kicker;
  viewRoot.innerHTML = renderView(view);
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
    button.disabled = runtime.syncStatus === 'syncing';
    button.textContent = runtime.syncStatus === 'syncing'
      ? 'Ansluter…'
      : (runtime.dropboxAuthorized ? 'Kör nytt syntetiskt test' : 'Anslut Dropbox och kör test');
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

document.addEventListener('click', event => {
  const connect = event.target.closest('[data-action="connect-dropbox"]');
  if (connect) {
    event.preventDefault();
    setSyncState('syncing', 'Öppnar Dropbox-auktorisering…');
    beginDropboxLiveTest().catch(error => setSyncState('action_required', error.message));
    return;
  }
  const link = event.target.closest('[data-view-link]');
  if (!link) return;
  event.preventDefault();
  showView(link.dataset.viewLink);
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

showView(currentView, { updateHash: !location.hash });
updateConnectionState();
registerServiceWorker();

if (isDropboxCallback()) {
  setSyncState('syncing', 'Verifierar Dropbox och kör ett isolerat syntetiskt test…');
  completeDropboxLiveTest()
    .then(result => {
      if (!result) return;
      setSyncState(
        'synced',
        `Syntetiskt test synkat. ${result.uploadedOps} lokal op laddades upp och ${result.downloadedOps} fjärrops lästes säkert.`,
        { authorized: true }
      );
    })
    .catch(error => {
      console.error('Dropbox live-test stoppades.', error);
      history.replaceState(null, '', `${new URL('./', location.href).href}#resor`);
      setSyncState('action_required', `Dropbox-testet stoppades: ${error.message}`);
    });
}

window.__PACKA__ = Object.freeze({
  get view() { return currentView; },
  phase: 'sync-validation',
  dataConnected: false,
  get dropboxAuthorized() { return runtime.dropboxAuthorized; },
  get syncStatus() { return runtime.syncStatus; }
});
