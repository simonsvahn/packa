import {
  DropboxTransport,
  IndexedDBStore,
  Repository,
  SyncEngine,
  beginDropboxOAuth,
  completeDropboxOAuth,
  openPackaDB
} from './data-layer.js';

export const DROPBOX_CLIENT_ID = '1eivtm3plbhvy9b';
const DEVICE_KEY = 'packa:live-test-device';
const REAL_DB = 'packa-live-v1';

let activeSession = null;

export function currentDropboxRedirectUri(location = globalThis.location) {
  if (!location?.href) throw new TypeError('Webbadress saknas');
  const url = new URL('./', location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

export function isDropboxCallback(location = globalThis.location) {
  const search = new URL(location.href).searchParams;
  return search.has('code') || search.has('error') || search.has('error_description');
}

function liveDeviceId({ storage = globalThis.localStorage, crypto = globalThis.crypto } = {}) {
  const existing = storage.getItem(DEVICE_KEY);
  if (existing) return existing;
  if (!crypto?.randomUUID) throw new Error('Web Crypto randomUUID krävs för enhets-id');
  const created = `web-${crypto.randomUUID()}`;
  storage.setItem(DEVICE_KEY, created);
  return created;
}

export async function beginDropboxLiveTest({
  location = globalThis.location,
  storage = globalThis.sessionStorage,
  crypto = globalThis.crypto
} = {}) {
  const redirectUri = currentDropboxRedirectUri(location);
  const authorization = await beginDropboxOAuth({
    clientId: DROPBOX_CLIENT_ID,
    redirectUri,
    storage,
    crypto
  });
  location.assign(authorization.url);
  return authorization;
}

async function runRealSync({
  accessToken,
  repository = null,
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
  crypto = globalThis.crypto
}) {
  let resolvedRepository = repository;
  if (!resolvedRepository) {
    const db = await openPackaDB({ indexedDB, name: REAL_DB });
    const store = new IndexedDBStore(db);
    const deviceId = liveDeviceId({ storage: localStorage, crypto });
    resolvedRepository = await new Repository({ store, deviceId }).init();
  }
  const transport = new DropboxTransport({ accessToken, id: 'dropbox-real' });
  const syncEngine = new SyncEngine({ repository: resolvedRepository, transport, batchSize: 250 });
  const result = await syncEngine.syncOnce();
  activeSession = { transport, repository: resolvedRepository, syncEngine, expiresAt: null };
  return {
    uploadedOps: result.uploadedOps,
    downloadedOps: result.downloadedOps,
    cursorReset: result.cursorReset,
    repository: resolvedRepository
  };
}

export async function completeDropboxLiveTest({
  location = globalThis.location,
  history = globalThis.history,
  sessionStorage = globalThis.sessionStorage,
  localStorage = globalThis.localStorage,
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  repository = null,
  fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  if (!isDropboxCallback(location)) return null;
  const redirectUri = currentDropboxRedirectUri(location);
  const token = await completeDropboxOAuth({
    callbackUrl: location.href,
    storage: sessionStorage,
    fetchImpl
  });
  const result = await runRealSync({
    accessToken: token.access_token,
    repository,
    indexedDB,
    localStorage,
    crypto
  });
  activeSession.expiresAt = Number.isFinite(token.expires_in) ? Date.now() + token.expires_in * 1000 : null;
  history.replaceState(null, '', `${redirectUri}#resor`);
  return result;
}

export function hasActiveDropboxSession() {
  return Boolean(activeSession);
}

export async function syncActiveDropboxSession() {
  if (!activeSession) return null;
  return activeSession.syncEngine.syncOnce();
}

export async function backupActiveDropboxSession(filename, value) {
  if (!activeSession) return null;
  const safeName = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safeName.endsWith('.json')) throw new Error('Dropbox-backup måste vara en JSON-fil');
  return activeSession.transport.putMutable(`/archive/${safeName}`, value);
}
