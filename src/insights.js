const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365.2425 * DAY;
const HALF_LIFE_YEARS = 3;

const clean = value => String(value || '').trim();
const fold = value => clean(value).toLocaleLowerCase('sv');
const round = value => Math.round((Number(value) || 0) * 10) / 10;

function tripTime(trip) {
  const direct = Date.parse(trip.startDate || trip.date_from || trip.createdAt || trip.created || '');
  if (Number.isFinite(direct)) return direct;
  const year = Number(trip.year);
  return Number.isFinite(year) ? Date.UTC(year, 6, 1) : 0;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.max(1, Math.round(value));
}

function rowsForItem(trip, itemId) {
  return (trip.items || []).filter(row => row.catalogId === itemId);
}

function aggregateQuantity(rows) {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
}

function tripIncludesPerson(trip, person) {
  if ((trip.persons || []).includes(person)) return true;
  return (trip.items || []).some(row => row.person === person);
}

export function calculateCatalogInsights(catalog, trips, { now = Date.now() } = {}) {
  const completed = trips.filter(trip => ['complete', 'archived'].includes(trip.status));
  const result = new Map();

  for (const item of catalog) {
    const eligible = completed.filter(trip => tripIncludesPerson(trip, item.person));
    let weightedTotal = 0;
    let weightedPacked = 0;
    let packedTrips = 0;
    let lastPackedAt = 0;
    let lastUsedAt = 0;
    const quantities = [];

    for (const trip of eligible) {
      const rows = rowsForItem(trip, item.id);
      const time = tripTime(trip);
      const ageYears = time ? Math.max(0, (now - time) / YEAR) : 0;
      const weight = 2 ** (-ageYears / HALF_LIFE_YEARS);
      const packed = rows.some(row => row.packed);
      weightedTotal += weight;
      if (rows.length) {
        lastUsedAt = Math.max(lastUsedAt, time);
        quantities.push(aggregateQuantity(rows));
      }
      if (packed) {
        packedTrips += 1;
        weightedPacked += weight;
        lastPackedAt = Math.max(lastPackedAt, time);
      }
    }

    const rawPercent = eligible.length ? (packedTrips / eligible.length) * 100 : 0;
    const weightedPercent = weightedTotal ? (weightedPacked / weightedTotal) * 100 : 0;
    const delta = weightedPercent - rawPercent;
    const neverPacked = packedTrips === 0;
    const olderThanThreeYears = !lastPackedAt || (now - lastPackedAt) >= 3 * YEAR;
    result.set(item.id, {
      person: item.person || '',
      eligibleTrips: eligible.length,
      packedTrips,
      rawPercent: round(rawPercent),
      weightedPercent: round(weightedPercent),
      trend: Math.abs(delta) < 10 ? 'flat' : (delta > 0 ? 'up' : 'down'),
      medianQuantity: median(quantities),
      lastPackedAt: lastPackedAt ? new Date(lastPackedAt).toISOString() : null,
      lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : null,
      archiveHint: !item.archived && weightedPercent < 5 && olderThanThreeYears,
      neverPacked
    });
  }
  return result;
}

export function duplicateCatalogGroups(catalog) {
  const groups = new Map();
  for (const item of catalog.filter(entry => !entry.archived)) {
    const key = `${fold(item.person)}\u0000${fold(item.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()]
    .filter(items => items.length > 1)
    .sort((a, b) => a[0].name.localeCompare(b[0].name, 'sv'));
}

export function catalogPreview(catalog, { templates = [], persons = [] } = {}) {
  const templateSet = new Set(templates);
  const personSet = new Set(persons);
  const selected = catalog.filter(item =>
    (!personSet.size || personSet.has(item.person))
    && (item.templates || []).some(template => templateSet.has(template))
  );
  const byPerson = {};
  const byTemplate = {};
  for (const item of selected) {
    const person = item.person || 'Ingen person';
    byPerson[person] = (byPerson[person] || 0) + 1;
    for (const template of item.templates || []) {
      if (templateSet.has(template)) byTemplate[template] = (byTemplate[template] || 0) + 1;
    }
  }
  return { total: selected.length, byPerson, byTemplate, items: selected };
}

export function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function catalogToCsv(catalog) {
  const columns = ['id', 'name', 'person', 'category', 'department', 'function', 'templates', 'brand', 'model', 'weight', 'comment', 'archived'];
  const lines = [columns.join(';')];
  for (const item of catalog) lines.push(columns.map(key => csvEscape(item[key])).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

