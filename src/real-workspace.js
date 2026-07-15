import { IndexedDBStore, MemoryStore, Repository, legacyV1ToOperations, materializedToLegacyV1, openPackaDB } from './data-layer.js';
import { calculateCatalogInsights, catalogPreview, catalogToCsv, duplicateCatalogGroups } from './insights.js';

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
    activities,
    function: fields.description || fields.area || 'Övrigt',
    templates: activities,
    person: fields.person || '',
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
    company: fields.companions || '',
    companions: fields.companions || '',
    persons: Array.isArray(fields.persons) ? fields.persons : [],
    templates: Array.isArray(fields.activities) ? fields.activities : [],
    status: STATUS_FROM_V1[fields.status] || 'archived',
    source: fields.source || 'import',
    createdAt: fields.created || `${fields.year || 1900}-01-01`,
    editable: fields.source === 'app' && !['complete', 'archived'].includes(STATUS_FROM_V1[fields.status]),
    unlockable: fields.source === 'app' && ['complete', 'archived'].includes(STATUS_FROM_V1[fields.status]),
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
    plannedQuantity: numeric(fields.planned) || quantity,
    broughtQuantity: numeric(fields.brought) || 0,
    packedQuantity: numeric(fields.packed) || 0,
    taken: (numeric(fields.brought) || 0) > 0,
    packed: (numeric(fields.packed) || 0) > 0,
    bag: fields.bag || '',
    location: fields.pouch || '',
    custom: !catalog,
    mergeKey: fields.item_id || record.entity_id,
    real: true
  };
}

function normalizeBag(record) {
  const fields = valueOf(record);
  return {
    ...fields,
    id: record.entity_id,
    name: fields.name || 'Namnlös väska',
    compartments: Array.isArray(fields.fack) ? fields.fack.filter(Boolean) : [],
    archived: Boolean(fields.archived)
  };
}

function normalizePouch(record) {
  const fields = valueOf(record);
  return {
    ...fields,
    id: record.entity_id,
    name: fields.name || 'Namnlös påse',
    archived: Boolean(fields.archived)
  };
}

export class RealWorkspace {
  constructor({ repository, store, crypto = environmentCrypto() }) {
    this.repository = repository;
    this.store = store;
    this.crypto = crypto;
    this.activeTripId = null;
  }

  async init({ preferredTripId = this.activeTripId } = {}) {
    const trips = this.trips();
    const activeTrips = trips
      .filter(trip => ['packing', 'planning'].includes(trip.status))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const preferred = activeTrips.find(trip => trip.id === preferredTripId);
    this.activeTripId = preferred?.id || activeTrips[0]?.id || null;
    return this;
  }

  hasData() {
    return Boolean(this.repository.getEntity(TYPES.root, 'root'));
  }

  allCatalog() {
    return this.repository.listEntities(TYPES.catalog)
      .map(normalizeCatalog)
      .sort((a, b) => `${a.person}\u0000${a.name}`.localeCompare(`${b.person}\u0000${b.name}`, 'sv'));
  }

  catalog() {
    return this.allCatalog().filter(item => !item.archived);
  }

  trips() {
    const statusOrder = { packing: 0, planning: 1, complete: 2, archived: 3 };
    return this.repository.listEntities(TYPES.trip).map(normalizeTrip).sort((a, b) => {
      const status = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      return status || String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  tripItems(tripId = this.activeTripId) {
    const catalogById = new Map(this.allCatalog().map(item => [item.id, item]));
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

  assertActiveEditable() {
    const trip = this.trips().find(entry => entry.id === this.activeTripId);
    if (!trip) throw new Error('Ingen resa är vald');
    if (['complete', 'archived'].includes(trip.status)) throw new Error('Resan är låst och kan inte ändras');
    return trip;
  }

  snapshot() {
    const allCatalogBase = this.allCatalog();
    const catalogById = new Map(allCatalogBase.map(item => [item.id, item]));
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
    const insights = calculateCatalogInsights(allCatalogBase, withRows);
    const allCatalog = allCatalogBase.map(item => ({ ...item, insight: insights.get(item.id) }));
    const catalog = allCatalog.filter(item => !item.archived);
    const root = this.repository.getEntity(TYPES.root, 'root');
    const templates = [...new Set([
      ...catalog.flatMap(item => item.templates),
      ...(Array.isArray(root?.fields.packa_templates) ? root.fields.packa_templates : [])
    ])].sort((a, b) => a.localeCompare(b, 'sv'));
    const bagLibrary = this.repository.listEntities('bag').map(normalizeBag).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const pouchLibrary = this.repository.listEntities('pouch').map(normalizePouch).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    return {
      syntheticOnly: false,
      real: true,
      dataReady: this.hasData(),
      catalog,
      allCatalog,
      duplicateGroups: duplicateCatalogGroups(allCatalog),
      trips: withRows,
      activeTripId: this.activeTripId,
      activeTrip: withRows.find(trip => trip.id === this.activeTripId) || null,
      templates,
      bags: bagLibrary.filter(entry => !entry.archived).map(entry => entry.name),
      pouches: pouchLibrary.filter(entry => !entry.archived).map(entry => entry.name),
      bagLibrary,
      pouchLibrary,
      persons: Array.isArray(root?.fields.persons) ? root.fields.persons : []
    };
  }

  previewTrip({ templates = [], persons = [] } = {}) {
    return catalogPreview(this.catalog(), { templates, persons });
  }

  async createTrip({
    name,
    destination = '',
    dateFrom = '',
    nights = null,
    season = '',
    companions = '',
    persons = [],
    templates = [],
    notes = '',
    sourceTripId = null
  }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Resan måste ha ett namn');
    const id = randomId('trip', this.crypto);
    const now = new Date();
    const snapshot = this.snapshot();
    const source = sourceTripId ? snapshot.trips.find(trip => trip.id === sourceTripId) : null;
    const selectedTemplates = source ? source.templates : [...new Set(templates)];
    const selectedPersons = source?.persons?.length ? source.persons : [...new Set(persons)].filter(Boolean);
    if (!selectedPersons.length && snapshot.persons[0]) selectedPersons.push(snapshot.persons[0]);
    await writeEntity(this.repository, TYPES.trip, id, {
      id,
      name: cleanName,
      destination: String(destination || '').trim(),
      year: dateFrom ? Number(String(dateFrom).slice(0, 4)) || now.getFullYear() : now.getFullYear(),
      date_from: String(dateFrom || ''),
      nights: nights === '' || nights === null ? null : Math.max(0, Number(nights) || 0),
      season: String(season || '').trim(),
      activities: selectedTemplates,
      persons: selectedPersons,
      companions: String(companions || '').trim(),
      status: 'planering',
      source: 'app',
      notes: String(notes || '').trim(),
      international: selectedTemplates.includes('Utomlands'),
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
      const selected = snapshot.catalog.filter(item => selectedPersons.includes(item.person) && item.templates.some(template => selectedTemplates.includes(template)));
      for (const item of selected) await this.addRow(id, item.id, item.name, item.insight?.medianQuantity || 1, item.person);
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
    if (!['planning', 'packing'].includes(status)) this.assertActiveEditable();
    await this.repository.setField(TYPES.trip, this.activeTripId, 'status', STATUS_TO_V1[status]);
  }

  async updateTrip(fields = {}) {
    this.assertActiveEditable();
    const allowed = {
      name: 'name', destination: 'destination', dateFrom: 'date_from', nights: 'nights', season: 'season',
      companions: 'companions', persons: 'persons', templates: 'activities', notes: 'notes'
    };
    for (const [key, target] of Object.entries(allowed)) {
      if (!Object.hasOwn(fields, key)) continue;
      let value = fields[key];
      if (key === 'name') {
        value = String(value || '').trim();
        if (!value) throw new Error('Resan måste ha ett namn');
      } else if (key === 'nights') value = value === '' || value === null ? null : Math.max(0, Number(value) || 0);
      else if (['persons', 'templates'].includes(key)) value = [...new Set(Array.isArray(value) ? value.filter(Boolean) : [])];
      else value = String(value || '').trim();
      await this.repository.setField(TYPES.trip, this.activeTripId, target, value);
      if (key === 'dateFrom' && value) await this.repository.setField(TYPES.trip, this.activeTripId, 'year', Number(value.slice(0, 4)));
      if (key === 'templates') await this.repository.setField(TYPES.trip, this.activeTripId, 'international', value.includes('Utomlands'));
    }
  }

  async unlockTrip(tripId) {
    const trip = this.trips().find(entry => entry.id === tripId);
    if (!trip) throw new Error('Resan finns inte');
    if (trip.source !== 'app') throw new Error('Importerad historik kan aldrig låsas upp');
    if (!['complete', 'archived'].includes(trip.status)) throw new Error('Resan är redan redigerbar');
    await this.repository.setField(TYPES.trip, tripId, 'status', 'planering');
    this.activeTripId = tripId;
  }

  async archiveTrip(tripId) {
    const trip = this.trips().find(entry => entry.id === tripId);
    if (!trip || trip.source !== 'app' || trip.status !== 'complete') throw new Error('Bara en klar appskapad resa kan arkiveras');
    await this.repository.setField(TYPES.trip, tripId, 'status', 'arkiverad');
  }

  async finishAndArchiveActiveTrip() {
    const trip = this.assertActiveEditable();
    if (trip.source !== 'app') throw new Error('Bara en appskapad resa kan avslutas');
    await this.repository.setField(TYPES.trip, trip.id, 'status', 'arkiverad');
    await this.init({ preferredTripId: null });
    return trip.id;
  }

  async deleteActiveTrip() {
    const trip = this.assertActiveEditable();
    for (const row of this.tripItems(trip.id)) await this.repository.deleteEntity(TYPES.item, row.id);
    await this.repository.deleteEntity(TYPES.trip, trip.id);
    this.activeTripId = this.trips().find(entry => ['packing', 'planning'].includes(entry.status))?.id || null;
  }

  async setIncluded(catalogId, included) {
    this.assertActiveEditable();
    const rows = this.tripItems().filter(item => item.catalogId === catalogId);
    if (included && !rows.length) {
      const catalog = this.catalog().find(item => item.id === catalogId);
      if (!catalog) throw new Error('Artikeln finns inte');
      await this.addRow(this.activeTripId, catalog.id, catalog.name, 1, catalog.person);
    }
    if (!included) for (const row of rows) await this.repository.deleteEntity(TYPES.item, row.id);
  }

  async setIncludedMany(catalogIds, included) {
    this.assertActiveEditable();
    const unique = [...new Set(catalogIds)].filter(Boolean);
    for (const catalogId of unique) await this.setIncluded(catalogId, included);
    return unique.length;
  }

  async setQuantity(itemId, quantity) {
    this.assertActiveEditable();
    const next = Math.max(0, Number(quantity) || 0);
    if (next === 0) return this.repository.deleteEntity(TYPES.item, itemId);
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    await this.repository.setField(TYPES.item, itemId, 'planned', next);
    if (row.taken) await this.repository.setField(TYPES.item, itemId, 'brought', next);
    if (row.packed) await this.repository.setField(TYPES.item, itemId, 'packed', next);
  }

  async toggleTaken(itemId) {
    this.assertActiveEditable();
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    const next = !row.taken;
    await this.repository.setField(TYPES.item, itemId, 'brought', next ? row.quantity : null);
    if (!next && row.packed) await this.repository.setField(TYPES.item, itemId, 'packed', null);
  }

  async togglePacked(itemId) {
    this.assertActiveEditable();
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row) throw new Error('Resraden finns inte');
    const next = !row.packed;
    if (next && !row.taken) await this.repository.setField(TYPES.item, itemId, 'brought', row.quantity);
    await this.repository.setField(TYPES.item, itemId, 'packed', next ? row.quantity : null);
  }

  async setBag(itemId, bag) {
    this.assertActiveEditable();
    await this.repository.setField(TYPES.item, itemId, 'bag', bag ? String(bag) : null);
  }

  async setLocation(itemId, location) {
    this.assertActiveEditable();
    await this.repository.setField(TYPES.item, itemId, 'pouch', location ? String(location).trim() : null);
  }

  async setPerson(itemId, person) {
    this.assertActiveEditable();
    const value = String(person || '').trim();
    if (!value) throw new Error('Raden måste tillhöra en person');
    await this.repository.setField(TYPES.item, itemId, 'person', value);
  }

  async addCustomItem(name, person = '') {
    this.assertActiveEditable();
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Den egna raden måste ha ett namn');
    return this.addRow(this.activeTripId, null, cleanName, 1, String(person || '').trim() || this.snapshot().activeTrip?.persons?.[0] || '');
  }

  async splitItem(itemId, quantity = 1) {
    this.assertActiveEditable();
    const row = this.tripItems().find(item => item.id === itemId);
    if (!row || row.quantity < 2) throw new Error('Det behövs minst två exemplar för att dela raden');
    const splitQuantity = Math.max(1, Math.min(row.quantity - 1, Number(quantity) || 1));
    await this.setQuantity(itemId, row.quantity - splitQuantity);
    return this.addRow(this.activeTripId, row.catalogId, row.nameSnapshot, splitQuantity, row.person);
  }

  async mergeItems(mergeKey) {
    this.assertActiveEditable();
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

  async updateCatalogItem(itemId, fields = {}) {
    const item = this.allCatalog().find(entry => entry.id === itemId);
    if (!item) throw new Error('Artikeln finns inte');
    const map = {
      name: 'name', person: 'person', category: 'category', department: 'area', function: 'description', templates: 'activities',
      brand: 'brand', model: 'model', weight: 'weight_g', comment: 'comment', howToPack: 'how_to_pack', sort: 'sort_nr'
    };
    for (const [key, target] of Object.entries(map)) {
      if (!Object.hasOwn(fields, key)) continue;
      let value = fields[key];
      if (key === 'name') {
        value = String(value || '').trim();
        if (!value) throw new Error('Artikeln måste ha ett namn');
      } else if (key === 'templates') value = [...new Set(Array.isArray(value) ? value.filter(Boolean) : [])];
      else if (['weight', 'sort'].includes(key)) value = value === '' || value === null ? null : Number(value);
      else value = String(value || '').trim() || null;
      await this.repository.setField(TYPES.catalog, itemId, target, value);
    }
    await this.repository.setField(TYPES.catalog, itemId, 'modified', new Date().toISOString().slice(0, 10));
  }

  async createCatalogItem(fields = {}) {
    const name = String(fields.name || '').trim();
    const person = String(fields.person || '').trim();
    if (!name || !person) throw new Error('Ny artikel kräver namn och person');
    const id = randomId('item', this.crypto);
    await writeEntity(this.repository, TYPES.catalog, id, {
      id,
      name,
      person,
      category: String(fields.category || 'C. Att packa'),
      area: String(fields.department || '').trim() || null,
      description: String(fields.function || '').trim() || null,
      activities: [...new Set(Array.isArray(fields.templates) ? fields.templates.filter(Boolean) : [])],
      comment: String(fields.comment || '').trim() || null,
      brand: String(fields.brand || '').trim() || null,
      model: String(fields.model || '').trim() || null,
      weight_g: fields.weight === '' || fields.weight === null ? null : Number(fields.weight) || null,
      how_to_pack: String(fields.howToPack || '').trim() || null,
      sort_nr: this.allCatalog().length + 1,
      archived: false,
      modified: new Date().toISOString().slice(0, 10)
    });
    return id;
  }

  async setCatalogArchived(itemId, archived) {
    if (!this.allCatalog().some(entry => entry.id === itemId)) throw new Error('Artikeln finns inte');
    await this.repository.setField(TYPES.catalog, itemId, 'archived', Boolean(archived));
    await this.repository.setField(TYPES.catalog, itemId, 'modified', new Date().toISOString().slice(0, 10));
  }

  async toggleCatalogTemplate(itemId, template) {
    const item = this.allCatalog().find(entry => entry.id === itemId);
    if (!item) throw new Error('Artikeln finns inte');
    const next = new Set(item.templates || []);
    if (next.has(template)) next.delete(template);
    else next.add(template);
    await this.repository.setField(TYPES.catalog, itemId, 'activities', [...next].sort((a, b) => a.localeCompare(b, 'sv')));
    await this.repository.setField(TYPES.catalog, itemId, 'modified', new Date().toISOString().slice(0, 10));
  }

  async createTemplate(template) {
    const value = String(template || '').trim();
    if (!value) throw new Error('Mallen måste ha ett namn');
    const root = this.repository.getEntity(TYPES.root, 'root');
    const extra = new Set(Array.isArray(root?.fields.packa_templates) ? root.fields.packa_templates : []);
    extra.add(value);
    await this.repository.setField(TYPES.root, 'root', 'packa_templates', [...extra].sort((a, b) => a.localeCompare(b, 'sv')));
    return value;
  }

  async createBag({ name, compartments = [] }) {
    const value = String(name || '').trim();
    if (!value) throw new Error('Väskan måste ha ett namn');
    const id = randomId('bag', this.crypto);
    await writeEntity(this.repository, 'bag', id, { name: value, archived: false, fack: [...new Set(compartments.map(entry => String(entry).trim()).filter(Boolean))] });
    return id;
  }

  async updateBag(bagId, { name, compartments, archived } = {}) {
    const bag = this.repository.getEntity('bag', bagId);
    if (!bag) throw new Error('Väskan finns inte');
    if (name !== undefined) {
      const value = String(name || '').trim();
      if (!value) throw new Error('Väskan måste ha ett namn');
      await this.repository.setField('bag', bagId, 'name', value);
    }
    if (compartments !== undefined) await this.repository.setField('bag', bagId, 'fack', [...new Set(compartments.map(entry => String(entry).trim()).filter(Boolean))]);
    if (archived !== undefined) await this.repository.setField('bag', bagId, 'archived', Boolean(archived));
  }

  async createPouch(name) {
    const value = String(name || '').trim();
    if (!value) throw new Error('Påsen måste ha ett namn');
    const id = randomId('pouch', this.crypto);
    await writeEntity(this.repository, 'pouch', id, { name: value, archived: false });
    return id;
  }

  async updatePouch(pouchId, { name, archived } = {}) {
    if (!this.repository.getEntity('pouch', pouchId)) throw new Error('Påsen finns inte');
    if (name !== undefined) {
      const value = String(name || '').trim();
      if (!value) throw new Error('Påsen måste ha ett namn');
      await this.repository.setField('pouch', pouchId, 'name', value);
    }
    if (archived !== undefined) await this.repository.setField('pouch', pouchId, 'archived', Boolean(archived));
  }

  exportLegacy() {
    return materializedToLegacyV1(this.repository.state, { savedAt: new Date().toISOString() });
  }

  exportCatalogCsv() {
    return catalogToCsv(this.snapshot().allCatalog);
  }

  validateArchive(input) {
    const migration = legacyV1ToOperations(input, { deviceId: 'restore-preview', baseTime: Date.now() });
    return migration.report;
  }

  async restoreArchive(input) {
    const restoreDevice = randomId('restore', this.crypto);
    const migration = legacyV1ToOperations(input, { deviceId: restoreDevice, baseTime: Date.now() + 1000 });
    const current = [];
    for (const type of [TYPES.catalog, TYPES.trip, TYPES.item, 'bag', 'pouch']) {
      for (const entity of this.repository.listEntities(type)) current.push({ entityType: type, entityId: entity.entity_id });
    }
    await this.repository.deleteEntities(current);
    const fields = migration.operations.map(op => ({ entityType: op.entity_type, entityId: op.entity_id, field: op.field, value: op.value }));
    for (let index = 0; index < fields.length; index += 1000) await this.repository.setFields(fields.slice(index, index + 1000));
    const targets = new Map();
    for (const op of migration.operations) targets.set(`${op.entity_type}\u0000${op.entity_id}`, [op.entity_type, op.entity_id]);
    await this.repository.restoreEntities([...targets.values()].map(([entityType, entityId]) => ({ entityType, entityId })));
    await this.init();
    return migration.report;
  }
}

export async function createRealWorkspace({ store = null, device = null, indexedDB, preferredTripId = null } = {}) {
  const resolvedStore = store || await createDefaultStore(indexedDB);
  const repository = await new Repository({ store: resolvedStore, deviceId: device || deviceId() }).init();
  return new RealWorkspace({ repository, store: resolvedStore }).init({ preferredTripId });
}
