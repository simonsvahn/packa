import { IndexedDBStore, MemoryStore, Repository, openPackaDB } from './data-layer.js';

const DB_NAME = 'packa-live-v1';
const DEVICE_KEY = 'packa:real-device';
const INTERNAL_TRIP_ID = '__packa_trip_id';

const TYPES = Object.freeze({
  root: 'root',
  catalog: 'item',
  trip: 'trip',
  item: 'trip_row'
});

const STATUS_FROM_V1 = Object.freeze({
  planering: 'planning',
  packning: 'packing',
  klar: 'complete',
  arkiverad: 'archived'
});

const STATUS_TO_V1 = Object.freeze({
  planning: 'planering',
  packing: 'packning',
  complete: 'klar',
  archived: 'arkiverad'
});

function environmentStorage() {
  return globalThis.window?.localStorage || globalThis.localStorage || null;
}

function environmentCrypto() {
  return globalThis.crypto || globalThis.window?.crypto || null;
}

function randomId(prefix, crypto = environmentCrypto()) {
  const suffix = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function deviceId(storage = environmentStorage(), crypto = environmentCrypto()) {
  const existing = storage?.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = randomId('packa-web', crypto);
  storage?.setItem(DEVICE_KEY, created);
  return created;
}

async function createDefaultStore(indexedDB = globalThis.indexedDB || globalThis.window?.indexedDB) {
  if (!indexedDB?.open) return new MemoryStore();
  const db = await openPackaDB({ indexedDB, name: DB_NAME });
  return new IndexedDBStore(db);
}

async function writeEntity(repository, type, id, fields) {
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined) await repository.setField(type, id, field, value);
  }
}

const valueOf = entity => entity ? { ...entity.fields, id: entity.entity_id } : null;
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

function quantityOf(fields) {
  return [fields.planned, fields.brought, fields.packed]
    .map(numeric)
    .find(value => value !== null && value > 0) ?? 1;
}

function normalizeCatalog(record) {
  const fields = valueOf(record);
  const activities = Array.isArray(fields.activities) ? fields.activities : [];
  return {
    ...fields,
    id: record.entity_id,
    name: fields.name || 'Namnlös artikel',
    category: fields.category || 'Övrigt',
    department: fields.area || 'Övrigt',
    activity: activities[0] || 'Övrigt',
    function: fields.description || fields.area || 'Övrigt',
    templates: activities,
    weight: numeric(fields.weight_g) || 0
  };
}

function normalizeTrip(record) {
  const fields = valueOf(record);
  return {
    ...fields,
    id: record.entity_id,
    name: fields.name || 'Namnlös resa',
    destination: fields.destination || '',
    startDate: fields.date_from || '',
    nights: fields.nights ?? null,
    season: fields.season || '',
    company: fields.companions || [],
    persons: Array.isArray(fields.persons) ? fields.persons : [],
    templates: Array.isArray(fields.activities) ? fields.activities : [],
    status: STATUS_FROM_V1[fields.status] || 'archived',
    source: fields.source || 'import',
    createdAt: fields.created || `${fields.year || 1900}-01-01`,
    real: true
  };
}

function normalizeRow(record, catalogById, trip) {
  const fields = valueOf(record);
  const catalog = fields.item_id ? catalogById.get(fields.item_id) : null;
  const quantity = quantityOf(fields);
  const person = fields.person || catalog?.person || trip?.persons?.[0] || '';
  return {
    ...fields,
    id: record.entity_id,
    tripId: fields[INTERNAL_TRIP_ID],
    catalogId: fields.item_id || null,
    nameSnapshot: fields.name_snapshot || catalog?.name || 'Egen rad',
    category: catalog?.category || 'Eget',
    department: catalog?.department || 'Eget',
    activity: catalog?.activity || 'Övrigt',
    function: catalog?.function || 'Övrigt',
    templates: catalog?.templates || [],
    person,
    quantity,
    taken: (numeric(fields.brought) || 0) > 0,
    packed: (numeric(fields.packed) || 0) > 0,
    bag: fields.bag || '',
    location: fields.pouch || '',
    custom: !catalog,
    mergeKey: fields.item_id || record.entity_id,
    real: true
  };
}

export class RealWorkspace {
  constructor({ repository, store, crypto = environmentCrypto() }) {
    this.repository = repository;
    this.store = store;
    this.crypto = crypto;
    this.activeTripId = null;
  }

  async init() {
    const trips = this.trips();
    this.activeTripId = trips.find(trip => trip.status === 'packing')?.id
      || trips.find(trip => trip.status === 'planning')?.id
      || null;
    return this;
  }

  hasData() {
    return Boolean(this.repository.getEntity(TYPES.root, 'root'));
  }

  catalog() {
    return this.repository.listEntities(TYPES.catalog)
      .map(normalizeCatalog)
      .filter(item => !item.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }

  trips() {
    const statusOrder = { packing: 0, planning: 1, complete: 2, archived: 3 };
    return this.repository.listEntities(TYPES.trip).map(normalizeTrip).sort((a, b) => {
      const status = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      return status || String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  tripItems(tripId = this.activeTripId) {
    const catalogById = new Map(this.catalog().map(item => [item.id, item]));
    const trip = this.trips().find(entry => entry.id === tripId);
    return this.repository.listEntities(TYPES.item)
      .filter(record => record.fields[INTERNAL_TRIP_ID] === tripId)
      .map(record => normalizeRow(record, catalogById, trip))
      .sort((a, b) => `${a.category}\u0000${a.nameSnapshot}\u0000${a.id}`.localeCompare(`${b.category}\u0000${b.nameSnapshot}\u0000${b.id}`, 'sv'));
  }

  selectTrip(tripId) {
    const trip = this.trips().find(entry => entry.id === tripId);
    if (!trip) throw new Error('Resan finns inte');
    if (trip.status === 'archived') throw new Error('Arkiverade resor öppnas i läsläge');
    this.activeTripId = tripId;
  }

  snapshot() {
    const catalog = this.catalog();
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const trips = this.trips();
    const tripsById = new Map(trips.map(trip => [trip.id, trip]));
    const rowsByTrip = new Map();
    for (const record of this.repository.listEntities(TYPES.item)) {
      const tripId = record.fields[INTERNAL_TRIP_ID];
      if (!rowsByTrip.has(tripId)) rowsByTrip.set(tripId, []);
      rowsByTrip.get(tripId).push(normalizeRow(record, catalogById, tripsById.get(tripId)));
    }
    const withRows = trips.map(trip => ({
      ...trip,
      items: (rowsByTrip.get(trip.id) || []).sort((a, b) => `${a.category}\u0000${a.nameSnapshot}\u0000${a.id}`.localeCompare(`${b.category}\u0000${b.nameSnapshot}\u0000${b.id}`, 'sv'))
    }));
    const templates = [...new Set(catalog.flatMap(item => item.templates))].sort((a, b) => a.localeCompare(b, 'sv'));
    const root = this.repository.getEntity(TYPES.root, 'root');
    return {
      syntheticOnly: false,
      real: true,
      dataReady: this.hasData(),
      catalog,
      trips: withRows,
      activeTripId: this.activeTripId,
      activeTrip: withRows.find(trip => trip.id === this.activeTripId) || null,
      templates,
      bags: this.repository.listEntities('bag').map(record => record.fields.name).filter(Boolean),
      pouches: this.repository.listEntities('pouch').map(record => record.fields.name).filter(Boolean),
      persons: Array.isArray(root?.fields.persons) ? root.fields.persons : []
    };
  }

  async createTrip({ name, destination = '', templates = [], sourceTripId = null }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Resan måste ha ett namn');
    const id = randomId('trip', this.crypto);
    const now = new Date();
    const snapshot = this.snapshot();
    const source = sourceTripId ? snapshot.trips.find(trip => trip.id === sourceTripId) : null;
    const selectedTemplates = source ? source.templates : [...new Set(templates)];
    const persons = source?.persons?.length ? source.persons : snapshot.persons.slice(0, 1);
    await writeEntity(this.repository, TYPES.trip, id, {
      id,
      name: cleanName,
      destination: String(destination || '').trim(),
      year: now.getFullYear(),
      date_from: '',
      nights: null,
      season: '',
      activities: selectedTemplates,
      persons,
      companions: [],
      status: 'planering',
      source: 'app',
      notes: '',
      created: now.toISOString()
    });

    if (source) {
      const grouped = new Map();
      for (const item of source.items) {
        const key = item.mergeKey;
        const current = grouped.get(key);
        if (current) current.quantity += item.quantity;
        else grouped.set(key, { ...item });
      }
      for (const item of grouped.values()) await this.addRow(id, item.catalogId, item.nameSnapshot, item.quantity, item.person);
    } else {
      const selected = snapshot.catalog.filter(item => item.templates.some(template => selectedTemplates.includes(template)));
      for (const item of selected) await this.addRow(id, item.id, item.name, 1, item.person);
    }
    this.activeTripId = id;
    return id;
  }

  async addRow(tripId, catalogId, name, quantity = 1, person = '') {
    const id = randomId('trip-row', this.crypto);
    await writeEntity(this.repository, TYPES.item, id, {
      item_id: catalogId || null,
      name_snapshot: name,
      planned: Math.max(1, Number(quantity) || 1),
      brought: null,
      packed: null,
      bag: null,
      pouch: null,
      comment: '',
      person,
      [INTERNAL_TRIP_ID]: tripId,
      __packa_position: this.repository.listEntities(TYPES.item).length
    });
    return id;
  }

  async setTripStatus(status) {
    if (!STATUS_TO_V1[status]) throw new Error('Ogiltig resestatus');
    await this.repository.setField(TYPES.trip, this.activeTripId, 'status', STATUS_TO_V1[status]);
  }

  async setIncluded(catalogId, included) {
    const rows = this.tripItems().filter(item => item.catalogId === catalogId);
    if (included && !rows.length) {
      const catalog = this.catalog().find(item => item.id === catalogId);
      if (!catalog) throw new Error('Artikeln finns inte');
      await this.addRow(this.activeTripId, catalog.id, catalog.name, 1, catalog.person);
    }
    if (!included) for (const row of rows) await this.repository.deleteEntity(TYPES.item, row.id);
  }

  async setQuantity(itemId, quantity) {
    const next = Math.max(0, Number(quantity) || 0);
    if (next === 0) return this.repository.deleteEntity(TYPES.item, itemId);
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    await this.repository.setField(TYPES.item, itemId, 'planned', next);
    if (row.taken) await this.repository.setField(TYPES.item, itemId, 'brought', next);
    if (row.packed) await this.repository.setField(TYPES.item, itemId, 'packed', next);
  }

  async toggleTaken(itemId) {
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    const next = !row.taken;
    await this.repository.setField(TYPES.item, itemId, 'brought', next ? row.quantity : null);
    if (!next && row.packed) await this.repository.setField(TYPES.item, itemId, 'packed', null);
  }

  async togglePacked(itemId) {
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    const next = !row.packed;
    if (next && !row.taken) await this.repository.setField(TYPES.item, itemId, 'brought', row.quantity);
    await this.repository.setField(TYPES.item, itemId, 'packed', next ? row.quantity : null);
  }

  async setBag(itemId, bag) {
    await this.repository.setField(TYPES.item, itemId, 'bag', bag ? String(bag) : null);
  }

  async setLocation(itemId, location) {
    await this.repository.setField(TYPES.item, itemId, 'pouch', location ? String(location).trim() : null);
  }

  async addCustomItem(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Den egna raden måste ha ett namn');
    return this.addRow(this.activeTripId, null, cleanName, 1, this.snapshot().activeTrip?.persons?.[0] || '');
  }

  async splitItem(itemId) {
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row || row.quantity < 2) throw new Error('Det behövs minst två exemplar för att dela raden');
    await this.setQuantity(itemId, row.quantity - 1);
    return this.addRow(this.activeTripId, row.catalogId, row.nameSnapshot, 1, row.person);
  }

  async mergeItems(mergeKey) {
    const rows = this.tripItems().filter(item => item.mergeKey === mergeKey);
    if (rows.length < 2) return null;
    const [target, ...rest] = rows;
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const taken = rows.every(row => row.taken);
    const packed = rows.every(row => row.packed);
    const bag = rows.every(row => row.bag === target.bag) ? target.bag : '';
    const location = rows.every(row => row.location === target.location) ? target.location : '';
    await this.repository.setField(TYPES.item, target.id, 'planned', quantity);
    await this.repository.setField(TYPES.item, target.id, 'brought', taken ? quantity : null);
    await this.repository.setField(TYPES.item, target.id, 'packed', packed ? quantity : null);
    await this.setBag(target.id, bag);
    await this.setLocation(target.id, location);
    for (const row of rest) await this.repository.deleteEntity(TYPES.item, row.id);
    return target.id;
  }
}

export async function createRealWorkspace({ store = null, device = null, indexedDB } = {}) {
  const resolvedStore = store || await createDefaultStore(indexedDB);
  const repository = await new Repository({ store: resolvedStore, deviceId: device || deviceId() }).init();
  return new RealWorkspace({ repository, store: resolvedStore }).init();
}
