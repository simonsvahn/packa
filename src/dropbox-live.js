import {
  DropboxTransport,
  IndexedDBStore,
  Repository,
  SyncEngine,
  beginDropboxOAuth,
  completeDropboxOAuth,
  exchangeDropboxRefreshToken,
  openPackaDB
} from './data-layer.js';

export const DROPBOX_CLIENT_ID = '1eivtm3plbhvy9b';
const DEVICE_KEY = 'packa:live-test-device';
const REAL_DB = 'packa-live-v1';
const DROPBOX_REFRESH_META_KEY = 'dropbox:refresh-token-v1';
const TOKEN_EXPIRY_SKEW_MS = 60_000;

let activeSession = null;

const sessionStore = repository => repository?.store?.getMeta && repository?.store?.putMeta ? repository.store : null;

async function storedRefreshToken(repository) {
  const store = sessionStore(repository);
  return store ? store.getMeta(DROPBOX_REFRESH_META_KEY) : null;
}

async function persistRefreshToken(repository, refreshToken) {
  const store = sessionStore(repository);
  if (!store || !refreshToken) return false;
  await store.putMeta(DROPBOX_REFRESH_META_KEY, String(refreshToken));
  return true;
}

export async function hasStoredDropboxCredential(repository) {
  return Boolean(await storedRefreshToken(repository));
}

export async function disconnectDropboxSession(repository) {
  const store = sessionStore(repository);
  if (store) await store.putMeta(DROPBOX_REFRESH_META_KEY, null);
  activeSession = null;
}

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
  refreshToken = null,
  expiresAt = null,
  repository = null,
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
  crypto = globalThis.crypto,
  fetchImpl = (...args) => globalThis.fetch(...args)
}) {
  let resolvedRepository = repository;
  if (!resolvedRepository) {
    const db = await openPackaDB({ indexedDB, name: REAL_DB });
    const store = new IndexedDBStore(db);
    const deviceId = liveDeviceId({ storage: localStorage, crypto });
    resolvedRepository = await new Repository({ store, deviceId }).init();
  }
  const transport = new DropboxTransport({ accessToken, fetchImpl, id: 'dropbox-real' });
  const syncEngine = new SyncEngine({ repository: resolvedRepository, transport, batchSize: 250 });
  const result = await syncEngine.syncOnce();
  activeSession = { transport, repository: resolvedRepository, syncEngine, refreshToken, expiresAt, fetchImpl };
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
    refreshToken: token.refresh_token || null,
    expiresAt: Number.isFinite(token.expires_in) ? Date.now() + token.expires_in * 1000 : null,
    repository,
    indexedDB,
    localStorage,
    crypto,
    fetchImpl
  });
  if (!token.refresh_token) {
    await disconnectDropboxSession(result.repository);
    throw new Error('Dropbox returnerade ingen beständig behörighet. Anslut Dropbox igen.');
  }
  await persistRefreshToken(result.repository, token.refresh_token);
  history.replaceState(null, '', `${redirectUri}#resor`);
  return result;
}

export async function restoreDropboxLiveSession({
  repository,
  fetchImpl = (...args) => globalThis.fetch(...args),
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
  crypto = globalThis.crypto
} = {}) {
  const refreshToken = await storedRefreshToken(repository);
  if (!refreshToken) return null;
  const token = await exchangeDropboxRefreshToken({ clientId: DROPBOX_CLIENT_ID, refreshToken, fetchImpl });
  const nextRefreshToken = token.refresh_token || refreshToken;
  const result = await runRealSync({
    accessToken: token.access_token,
    refreshToken: nextRefreshToken,
    expiresAt: Number.isFinite(token.expires_in) ? Date.now() + token.expires_in * 1000 : null,
    repository,
    indexedDB,
    localStorage,
    crypto,
    fetchImpl
  });
  if (nextRefreshToken !== refreshToken) await persistRefreshToken(result.repository, nextRefreshToken);
  return result;
}

export function hasActiveDropboxSession() {
  return Boolean(activeSession);
}

export async function getDropboxSyncDiagnostics(repository) {
  if (!repository?.store?.getAllOps) return null;
  if (activeSession?.repository === repository) return activeSession.syncEngine.diagnostics();
  const all = await repository.store.getAllOps();
  const uploadedSeq = await repository.store.getMeta(`sync:dropbox-real:uploaded_seq:${repository.deviceId}`) ?? 0;
  const ownOps = all.filter(op => op.device_id === repository.deviceId);
  const appDevices = [...new Set([repository.deviceId, ...all.map(op => op.device_id)])
    .values()]
    .filter(id => /^(?:packa-web-|web-)/.test(id));
  return {
    deviceId: repository.deviceId,
    localSeq: ownOps.reduce((max, op) => Math.max(max, op.seq), 0),
    uploadedSeq,
    pendingOps: ownOps.filter(op => op.seq > uploadedSeq).length,
    knownAppDevices: appDevices.length
  };
}

async function refreshActiveDropboxSession({ force = false } = {}) {
  if (!activeSession?.refreshToken) return activeSession;
  if (!force && activeSession.expiresAt && activeSession.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS) return activeSession;
  const token = await exchangeDropboxRefreshToken({
    clientId: DROPBOX_CLIENT_ID,
    refreshToken: activeSession.refreshToken,
    fetchImpl: activeSession.fetchImpl
  });
  const refreshToken = token.refresh_token || activeSession.refreshToken;
  const transport = new DropboxTransport({ accessToken: token.access_token, fetchImpl: activeSession.fetchImpl, id: 'dropbox-real' });
  const syncEngine = new SyncEngine({ repository: activeSession.repository, transport, batchSize: 250 });
  activeSession = {
    ...activeSession,
    transport,
    syncEngine,
    refreshToken,
    expiresAt: Number.isFinite(token.expires_in) ? Date.now() + token.expires_in * 1000 : null
  };
  await persistRefreshToken(activeSession.repository, refreshToken);
  return activeSession;
}

export async function syncActiveDropboxSession() {
  if (!activeSession) return null;
  await refreshActiveDropboxSession();
  try {
    return await activeSession.syncEngine.syncOnce();
  } catch (error) {
    if (!activeSession.refreshToken || error?.status !== 401) throw error;
    await refreshActiveDropboxSession({ force: true });
    return activeSession.syncEngine.syncOnce();
  }
}

export async function backupActiveDropboxSession(filename, value) {
  if (!activeSession) return null;
  await refreshActiveDropboxSession();
  const safeName = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safeName.endsWith('.json')) throw new Error('Dropbox-backup måste vara en JSON-fil');
  return activeSession.transport.putMutable(`/archive/${safeName}`, value);
}
