import { IndexedDBStore, MemoryStore, Repository, openPackaDB } from './data-layer.js';

const DB_NAME = 'packa-core-demo-v1';
const DEVICE_KEY = 'packa:core-demo-device';
const SEED_KEY = 'core-demo-seed-v1';

const TYPES = Object.freeze({
  catalog: 'demo_catalog_item',
  trip: 'demo_trip',
  item: 'demo_trip_item'
});

export const DEMO_TEMPLATES = Object.freeze(['Basresa', 'Stad', 'Utomlands', 'Vandring']);
export const DEMO_BAGS = Object.freeze(['Ryggsäck', 'Kabinväska', 'Incheckad väska']);

const CATALOG_SEED = Object.freeze([
  { id: 'demo-pass', name: 'Pass', category: 'Dokument', department: 'Viktigt', activity: 'Resa', function: 'Identifiering', templates: ['Basresa', 'Utomlands'], brand: '', model: '', weight: 35 },
  { id: 'demo-mobil', name: 'Mobiltelefon', category: 'Teknik', department: 'Telefon', activity: 'Resa', function: 'Kommunikation', templates: ['Basresa', 'Stad', 'Vandring'], brand: '', model: '', weight: 210 },
  { id: 'demo-laddare', name: 'Mobilladdare', category: 'Teknik', department: 'Laddning', activity: 'Resa', function: 'Ström', templates: ['Basresa', 'Stad', 'Vandring'], brand: 'Anker', model: 'USB-C', weight: 95 },
  { id: 'demo-tshirt', name: 'T-shirt', category: 'Kläder', department: 'Överkropp', activity: 'Vardag', function: 'Kläder', templates: ['Basresa', 'Stad'], brand: '', model: '', weight: 170 },
  { id: 'demo-underklader', name: 'Underkläder', category: 'Kläder', department: 'Närmast kroppen', activity: 'Vardag', function: 'Kläder', templates: ['Basresa', 'Stad', 'Vandring'], brand: '', model: '', weight: 80 },
  { id: 'demo-regnjacka', name: 'Regnjacka', category: 'Kläder', department: 'Ytterplagg', activity: 'Vandring', function: 'Regnskydd', templates: ['Vandring'], brand: 'Haglöfs', model: '', weight: 420 },
  { id: 'demo-kangor', name: 'Vandringskängor', category: 'Skor', department: 'Utomhus', activity: 'Vandring', function: 'Fotbeklädnad', templates: ['Vandring'], brand: '', model: '', weight: 1100 },
  { id: 'demo-vattenflaska', name: 'Vattenflaska', category: 'Utrustning', department: 'Dryck', activity: 'Vandring', function: 'Vätska', templates: ['Vandring'], brand: 'Nalgene', model: '1 liter', weight: 180 },
  { id: 'demo-bok', name: 'Bok', category: 'Fritid', department: 'Läsning', activity: 'Vila', function: 'Underhållning', templates: ['Stad'], brand: '', model: '', weight: 320 }
]);

const TRIP_SEED = Object.freeze({
  id: 'demo-trip-goteborg',
  name: 'Helg i Göteborg',
  destination: 'Göteborg',
  startDate: '2026-08-21',
  endDate: '2026-08-23',
  nights: 2,
  season: 'Sommar',
  company: 'Själv',
  persons: ['Simon'],
  templates: ['Basresa', 'Stad'],
  status: 'planning',
  createdAt: '2026-07-15T08:00:00.000Z',
  demo: true
});

const SEEDED_TRIP_ITEMS = Object.freeze([
  ['demo-pass', 1],
  ['demo-mobil', 1],
  ['demo-laddare', 1],
  ['demo-tshirt', 2],
  ['demo-underklader', 3],
  ['demo-bok', 1]
]);

const fieldEntries = object => Object.entries(object).filter(([, value]) => value !== undefined);
const valueOf = entity => entity ? { ...entity.fields, id: entity.entity_id } : null;

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
  const created = randomId('demo-web', crypto);
  storage?.setItem(DEVICE_KEY, created);
  return created;
}

async function createDefaultStore(indexedDB = globalThis.indexedDB || globalThis.window?.indexedDB) {
  if (!indexedDB?.open) return new MemoryStore();
  const db = await openPackaDB({ indexedDB, name: DB_NAME });
  return new IndexedDBStore(db);
}

async function writeEntity(repository, type, id, fields) {
  for (const [field, value] of fieldEntries(fields)) await repository.setField(type, id, field, value);
}

function itemFields(catalog, tripId, quantity = 1, overrides = {}) {
  return {
    tripId,
    catalogId: catalog?.id || null,
    nameSnapshot: catalog?.name || overrides.nameSnapshot || 'Egen rad',
    category: catalog?.category || overrides.category || 'Eget',
    department: catalog?.department || overrides.department || 'Eget',
    activity: catalog?.activity || overrides.activity || 'Övrigt',
    function: catalog?.function || overrides.function || 'Övrigt',
    templates: catalog?.templates || [],
    person: overrides.person || 'Simon',
    quantity: Math.max(1, Number(quantity) || 1),
    taken: Boolean(overrides.taken),
    packed: Boolean(overrides.packed),
    bag: overrides.bag || '',
    location: overrides.location || '',
    custom: Boolean(overrides.custom),
    mergeKey: overrides.mergeKey || catalog?.id || randomId('custom-group'),
    createdAt: overrides.createdAt || new Date().toISOString()
  };
}

function templateOverlap(itemTemplates = [], tripTemplates = []) {
  return itemTemplates.some(template => tripTemplates.includes(template));
}

export class DemoWorkspace {
  constructor({ repository, store, crypto = environmentCrypto() }) {
    this.repository = repository;
    this.store = store;
    this.crypto = crypto;
    this.activeTripId = null;
  }

  async init() {
    const seeded = await this.store.getMeta(SEED_KEY);
    if (!seeded) await this.seed();
    const trips = this.trips();
    this.activeTripId = trips.find(trip => trip.status === 'packing')?.id
      || trips.find(trip => trip.status === 'planning')?.id
      || trips[0]?.id
      || null;
    return this;
  }

  async seed() {
    for (const catalog of CATALOG_SEED) await writeEntity(this.repository, TYPES.catalog, catalog.id, catalog);
    await writeEntity(this.repository, TYPES.trip, TRIP_SEED.id, TRIP_SEED);
    for (const [catalogId, quantity] of SEEDED_TRIP_ITEMS) {
      const catalog = CATALOG_SEED.find(item => item.id === catalogId);
      const id = `${TRIP_SEED.id}:item:${catalogId}`;
      await writeEntity(this.repository, TYPES.item, id, itemFields(catalog, TRIP_SEED.id, quantity));
    }
    await this.store.putMeta(SEED_KEY, { seededAt: new Date().toISOString(), syntheticOnly: true });
  }

  catalog() {
    return this.repository.listEntities(TYPES.catalog).map(valueOf).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }

  trips() {
    const statusOrder = { packing: 0, planning: 1, complete: 2, archived: 3 };
    return this.repository.listEntities(TYPES.trip).map(valueOf).sort((a, b) => {
      const status = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      return status || String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  tripItems(tripId = this.activeTripId) {
    return this.repository.listEntities(TYPES.item)
      .map(valueOf)
      .filter(item => item.tripId === tripId)
      .sort((a, b) => `${a.category}\u0000${a.nameSnapshot}\u0000${a.id}`.localeCompare(`${b.category}\u0000${b.nameSnapshot}\u0000${b.id}`, 'sv'));
  }

  selectTrip(tripId) {
    if (!this.repository.getEntity(TYPES.trip, tripId)) throw new Error('Testresan finns inte');
    this.activeTripId = tripId;
  }

  snapshot() {
    const trips = this.trips().map(trip => ({ ...trip, items: this.tripItems(trip.id) }));
    return {
      syntheticOnly: true,
      catalog: this.catalog(),
      trips,
      activeTripId: this.activeTripId,
      activeTrip: trips.find(trip => trip.id === this.activeTripId) || trips[0] || null,
      templates: [...DEMO_TEMPLATES],
      bags: [...DEMO_BAGS]
    };
  }

  async createTrip({ name, destination = '', templates = ['Basresa'], sourceTripId = null }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Resan måste ha ett namn');
    const id = randomId('demo-trip', this.crypto);
    const createdAt = new Date().toISOString();
    const source = sourceTripId ? this.trips().find(trip => trip.id === sourceTripId) : null;
    const tripTemplates = source ? source.templates : [...new Set(templates)];
    await writeEntity(this.repository, TYPES.trip, id, {
      name: cleanName,
      destination: String(destination || '').trim(),
      startDate: '',
      endDate: '',
      nights: null,
      season: '',
      company: '',
      persons: source?.persons || ['Simon'],
      templates: tripTemplates,
      status: 'planning',
      createdAt,
      demo: true,
      basedOn: source?.id || null
    });

    if (source) {
      const grouped = new Map();
      for (const item of source.items || this.tripItems(source.id)) {
        const key = item.mergeKey || item.catalogId || item.id;
        const current = grouped.get(key);
        if (current) current.quantity += item.quantity;
        else grouped.set(key, { ...item });
      }
      for (const item of grouped.values()) {
        const catalog = this.catalog().find(entry => entry.id === item.catalogId);
        const rowId = randomId(`${id}:item`, this.crypto);
        await writeEntity(this.repository, TYPES.item, rowId, itemFields(catalog, id, item.quantity, {
          ...item,
          nameSnapshot: item.nameSnapshot,
          taken: false,
          packed: false,
          bag: '',
          location: '',
          createdAt
        }));
      }
    } else {
      for (const catalog of this.catalog().filter(item => templateOverlap(item.templates, tripTemplates))) {
        const rowId = `${id}:item:${catalog.id}`;
        await writeEntity(this.repository, TYPES.item, rowId, itemFields(catalog, id, 1, { createdAt }));
      }
    }
    this.activeTripId = id;
    return id;
  }

  async setTripStatus(status) {
    const allowed = ['planning', 'packing', 'complete', 'archived'];
    if (!allowed.includes(status)) throw new Error('Ogiltig resestatus');
    await this.repository.setField(TYPES.trip, this.activeTripId, 'status', status);
  }

  async setIncluded(catalogId, included) {
    const rows = this.tripItems().filter(item => item.catalogId === catalogId);
    if (included && !rows.length) {
      const catalog = this.catalog().find(item => item.id === catalogId);
      if (!catalog) throw new Error('Testartikeln finns inte');
      await writeEntity(this.repository, TYPES.item, randomId(`${this.activeTripId}:item`, this.crypto), itemFields(catalog, this.activeTripId, 1));
    }
    if (!included) for (const row of rows) await this.repository.deleteEntity(TYPES.item, row.id);
  }

  async setQuantity(itemId, quantity) {
    const next = Math.max(0, Number(quantity) || 0);
    if (next === 0) return this.repository.deleteEntity(TYPES.item, itemId);
    return this.repository.setField(TYPES.item, itemId, 'quantity', next);
  }

  async toggleTaken(itemId) {
    const item = this.tripItems().find(row => row.id === itemId);
    if (!item) throw new Error('Testraden finns inte');
    const next = !item.taken;
    await this.repository.setField(TYPES.item, itemId, 'taken', next);
    if (!next && item.packed) await this.repository.setField(TYPES.item, itemId, 'packed', false);
  }

  async togglePacked(itemId) {
    const item = this.tripItems().find(row => row.id === itemId);
    if (!item) throw new Error('Testraden finns inte');
    const next = !item.packed;
    if (next && !item.taken) await this.repository.setField(TYPES.item, itemId, 'taken', true);
    await this.repository.setField(TYPES.item, itemId, 'packed', next);
  }

  async setBag(itemId, bag) {
    await this.repository.setField(TYPES.item, itemId, 'bag', String(bag || ''));
  }

  async setLocation(itemId, location) {
    await this.repository.setField(TYPES.item, itemId, 'location', String(location || '').trim());
  }

  async addCustomItem(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Den egna raden måste ha ett namn');
    const id = randomId(`${this.activeTripId}:custom`, this.crypto);
    await writeEntity(this.repository, TYPES.item, id, itemFields(null, this.activeTripId, 1, {
      nameSnapshot: cleanName,
      custom: true,
      mergeKey: randomId('custom-group', this.crypto)
    }));
    return id;
  }

  async splitItem(itemId) {
    const item = this.tripItems().find(row => row.id === itemId);
    if (!item || item.quantity < 2) throw new Error('Det behövs minst två exemplar för att dela raden');
    await this.repository.setField(TYPES.item, itemId, 'quantity', item.quantity - 1);
    const id = randomId(`${this.activeTripId}:split`, this.crypto);
    const { id: _sourceId, ...fields } = item;
    await writeEntity(this.repository, TYPES.item, id, {
      ...fields,
      tripId: this.activeTripId,
      quantity: 1,
      bag: '',
      location: '',
      createdAt: new Date().toISOString()
    });
    return id;
  }

  async mergeItems(mergeKey) {
    const rows = this.tripItems().filter(item => item.mergeKey === mergeKey);
    if (rows.length < 2) return null;
    const [target, ...rest] = rows;
    const quantity = rows.reduce((sum, item) => sum + item.quantity, 0);
    const taken = rows.every(item => item.taken);
    const packed = rows.every(item => item.packed);
    const bag = rows.every(item => item.bag === target.bag) ? target.bag : '';
    const location = rows.every(item => item.location === target.location) ? target.location : '';
    await this.repository.setField(TYPES.item, target.id, 'quantity', quantity);
    await this.repository.setField(TYPES.item, target.id, 'taken', taken);
    await this.repository.setField(TYPES.item, target.id, 'packed', packed);
    await this.repository.setField(TYPES.item, target.id, 'bag', bag);
    await this.repository.setField(TYPES.item, target.id, 'location', location);
    for (const row of rest) await this.repository.deleteEntity(TYPES.item, row.id);
    return target.id;
  }
}

export async function createDemoWorkspace({ store = null, device = null, indexedDB } = {}) {
  const resolvedStore = store || await createDefaultStore(indexedDB);
  const repository = await new Repository({ store: resolvedStore, deviceId: device || deviceId() }).init();
  return new DemoWorkspace({ repository, store: resolvedStore }).init();
}
