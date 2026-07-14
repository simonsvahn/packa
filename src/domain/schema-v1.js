import { cloneJson } from './canonical.js';
import { createClock } from './hlc.js';
import { materialize } from './materializer.js';
import { createSetOperation } from './operations.js';

export const INTERNAL_PREFIX = '__packa_';
const ROOT_ID = 'root';
const COLLECTIONS = new Set(['items', 'trips', 'bags', 'pouches']);

function assertLegacyObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} måste vara ett objekt`);
}

function assertNoInternalFields(value, label) {
  for (const key of Object.keys(value)) {
    if (key.startsWith(INTERNAL_PREFIX)) throw new Error(`${label} använder reserverat fält ${key}`);
  }
}

function positionOf(record) {
  const value = record.fields[`${INTERNAL_PREFIX}position`];
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

const sortByPosition = records => records.sort((a, b) => positionOf(a) - positionOf(b) || a.entity_id.localeCompare(b.entity_id));

function withoutInternal(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(INTERNAL_PREFIX)) out[key] = cloneJson(value);
  }
  return out;
}

function parseBaseTime(savedAt) {
  const parsed = Date.parse(savedAt || '');
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : Date.UTC(2000, 0, 1);
}

export function legacyV1ToOperations(input, { deviceId = 'legacy-import', baseTime = null } = {}) {
  assertLegacyObject(input, 'Datafilen');
  if (input.schema_version !== 1) throw new Error(`Stöder endast schema_version 1, fick ${input.schema_version}`);
  if (!Array.isArray(input.items) || !Array.isArray(input.trips)) throw new TypeError('items och trips måste vara arrayer');
  if ('bags' in input && !Array.isArray(input.bags)) throw new TypeError('bags måste vara en array');
  if ('pouches' in input && !Array.isArray(input.pouches)) throw new TypeError('pouches måste vara en array');

  const source = cloneJson(input);
  const wallTime = baseTime ?? parseBaseTime(source.saved_at);
  const clock = createClock(deviceId, () => wallTime);
  const operations = [];
  let seq = 0;

  const addField = (entityType, entityId, field, value) => {
    seq += 1;
    operations.push(createSetOperation({
      deviceId,
      seq,
      entityType,
      entityId,
      field,
      value,
      hlc: clock.tick(),
      schemaVersion: 1
    }));
  };

  const addEntity = (entityType, entityId, object, internal = {}) => {
    assertLegacyObject(object, `${entityType}:${entityId}`);
    assertNoInternalFields(object, `${entityType}:${entityId}`);
    for (const [field, value] of Object.entries(object)) addField(entityType, entityId, field, value);
    for (const [field, value] of Object.entries(internal)) addField(entityType, entityId, `${INTERNAL_PREFIX}${field}`, value);
  };

  const root = {};
  for (const [key, value] of Object.entries(source)) {
    if (!COLLECTIONS.has(key)) root[key] = value;
  }
  addEntity('root', ROOT_ID, root, {
    bags_present: Object.hasOwn(source, 'bags'),
    pouches_present: Object.hasOwn(source, 'pouches')
  });

  const itemIds = new Set();
  source.items.forEach((item, index) => {
    assertLegacyObject(item, `items[${index}]`);
    if (!item.id || itemIds.has(item.id)) throw new Error(`Ogiltigt eller dubblerat artikel-id vid index ${index}`);
    itemIds.add(item.id);
    addEntity('item', item.id, item, { position: index });
  });

  const tripIds = new Set();
  let rowCount = 0;
  source.trips.forEach((trip, tripIndex) => {
    assertLegacyObject(trip, `trips[${tripIndex}]`);
    if (!trip.id || tripIds.has(trip.id)) throw new Error(`Ogiltigt eller dubblerat rese-id vid index ${tripIndex}`);
    if (!Array.isArray(trip.items)) throw new TypeError(`Resan ${trip.id} saknar items-array`);
    tripIds.add(trip.id);
    const tripFields = { ...trip };
    delete tripFields.items;
    addEntity('trip', trip.id, tripFields, { position: tripIndex });
    trip.items.forEach((row, rowIndex) => {
      assertLegacyObject(row, `${trip.id}.items[${rowIndex}]`);
      const rowId = `legacy-row:${encodeURIComponent(trip.id)}:${String(rowIndex).padStart(6, '0')}`;
      addEntity('trip_row', rowId, row, { trip_id: trip.id, position: rowIndex });
      rowCount += 1;
    });
  });

  (source.bags || []).forEach((bag, index) => addEntity('bag', `legacy-bag:${String(index).padStart(4, '0')}`, bag, { position: index }));
  (source.pouches || []).forEach((pouch, index) => addEntity('pouch', `legacy-pouch:${String(index).padStart(4, '0')}`, pouch, { position: index }));

  return {
    operations,
    report: {
      schema_version: 1,
      device_id: deviceId,
      operations: operations.length,
      items: source.items.length,
      trips: source.trips.length,
      trip_rows: rowCount,
      bags: source.bags?.length ?? 0,
      pouches: source.pouches?.length ?? 0
    }
  };
}

export function materializedToLegacyV1(state, { savedAt } = {}) {
  const rootRecord = state.getEntity('root', ROOT_ID);
  if (!rootRecord) throw new Error('Materialiseringen saknar root-entitet');
  const output = withoutInternal(rootRecord.fields);
  const itemRecords = sortByPosition(state.listEntities('item'));
  const tripRecords = sortByPosition(state.listEntities('trip'));
  const rowRecords = sortByPosition(state.listEntities('trip_row'));
  const bagRecords = sortByPosition(state.listEntities('bag'));
  const pouchRecords = sortByPosition(state.listEntities('pouch'));

  output.items = itemRecords.map(record => withoutInternal(record.fields));
  const rowsByTrip = new Map();
  for (const record of rowRecords) {
    const tripId = record.fields[`${INTERNAL_PREFIX}trip_id`];
    if (!rowsByTrip.has(tripId)) rowsByTrip.set(tripId, []);
    rowsByTrip.get(tripId).push(record);
  }
  output.trips = tripRecords.map(record => {
    const trip = withoutInternal(record.fields);
    trip.items = (rowsByTrip.get(record.entity_id) || []).map(row => withoutInternal(row.fields));
    return trip;
  });

  if (rootRecord.fields[`${INTERNAL_PREFIX}bags_present`]) output.bags = bagRecords.map(record => withoutInternal(record.fields));
  if (rootRecord.fields[`${INTERNAL_PREFIX}pouches_present`]) output.pouches = pouchRecords.map(record => withoutInternal(record.fields));
  if (savedAt !== undefined) output.saved_at = savedAt;
  return output;
}

export function migrateLegacyV1(input, options = {}) {
  const migration = legacyV1ToOperations(input, options);
  const state = materialize(migration.operations);
  return { ...migration, state, exported: materializedToLegacyV1(state) };
}
