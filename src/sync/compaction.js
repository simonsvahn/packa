import { Repository } from '../domain/repository.js';
import { materializedToLegacyV1 } from '../domain/schema-v1.js';
import { SyncEngine } from './sync-engine.js';

const safeGeneration = value => {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(text)) throw new TypeError('Ogiltig kompakteringsgeneration');
  return text;
};

export async function publishCompaction({ syncEngine, generation, savedAt = new Date().toISOString(), createdAt = savedAt }) {
  if (!(syncEngine instanceof SyncEngine)) throw new TypeError('Kompaktering kräver SyncEngine');
  const id = safeGeneration(generation);
  const synced = await syncEngine.syncOnce();
  const repository = syncEngine.repository;
  const transport = syncEngine.transport;
  const snapshot = repository.state.exportSnapshot();
  const archive = materializedToLegacyV1(repository.state, { savedAt });
  const snapshotPath = `/snapshots/${id}.json`;
  const archivePath = `/archive/packlista-data-${id}.json`;
  const manifestPath = '/meta/manifest.json';
  const manifest = {
    manifest_version: 1,
    generation: id,
    created_at: createdAt,
    cursor: synced.cursor,
    snapshot_path: snapshotPath,
    archive_path: archivePath,
    archive_schema_version: archive.schema_version,
    pruning: 'disabled-until-device-ack-protocol'
  };

  await transport.putImmutable(snapshotPath, snapshot);
  await transport.putImmutable(archivePath, archive);
  await transport.putMutable(manifestPath, manifest);
  return { manifest, snapshot, archive };
}

export async function bootstrapFromCompaction({ store, transport, deviceId, now = () => Date.now(), batchSize = 250 }) {
  const manifest = await transport.getJson('/meta/manifest.json');
  if (!manifest || manifest.manifest_version !== 1 || !manifest.snapshot_path || !manifest.cursor) throw new TypeError('Ogiltigt kompakteringsmanifest');
  const snapshot = await transport.getJson(manifest.snapshot_path);
  await store.saveSnapshot(manifest.generation, snapshot);
  await store.putMeta('latest_snapshot', manifest.generation);
  const repository = await new Repository({ store, deviceId, now }).init();
  const syncEngine = new SyncEngine({ repository, transport, batchSize });
  await store.putMeta(`${syncEngine.keyPrefix}:cursor`, manifest.cursor);
  const tail = await syncEngine.downloadRemote();
  return { repository, syncEngine, manifest, tail };
}
