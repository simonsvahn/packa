import { calculateCatalogInsights } from './insights.js';

export const VIEW_ORDER = ['resor', 'planera', 'packa', 'matris', 'master', 'vanor', 'bibliotek', 'data', 'status'];

export const VIEW_META = Object.freeze({
  resor: { title: 'Resor', kicker: 'Översikt' },
  planera: { title: 'Planera', kicker: 'Resa · vad ska med?' },
  packa: { title: 'Packa', kicker: 'Resa · ta fram och packa' },
  matris: { title: 'Matris', kicker: 'Mac · kurering' },
  master: { title: 'Master', kicker: 'Artiklar · kurering' },
  vanor: { title: 'Vanor', kicker: 'Historik · beslutsstöd' },
  bibliotek: { title: 'Bibliotek', kicker: 'Väskor · påsar' },
  data: { title: 'Data', kicker: 'Export · återhämtning' },
  status: { title: 'Status och version', kicker: 'Mer · synk och app' }
});

export function normalizeView(value) {
  const view = String(value || '').replace(/^#/, '').toLowerCase();
  return VIEW_ORDER.includes(view) ? view : 'resor';
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const statusLabel = status => ({
  planning: 'Planering',
  packing: 'Packning',
  complete: 'Klar',
  archived: 'Arkiverad'
}[status] || status);

const dataBoundary = (core, compact = false) => core?.real ? '' : `
  <div class="demo-boundary${compact ? ' compact-boundary' : ''}" role="note">
    <span aria-hidden="true">◇</span>
    <div><b>Säker testyta</b><span class="boundary-copy"> Allt du gör här sparas som syntetiska demo-operationer i en separat lokal databas. Originalmastern och Dropbox-testets databas berörs inte.</span></div>
  </div>`;

const shellCard = (title, text) => `
  <section class="placeholder" aria-labelledby="placeholder-title">
    <div>
      <strong id="placeholder-title">${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
    </div>
  </section>`;

function tripProgress(trip) {
  const total = trip.items.length;
  const taken = trip.items.filter(item => item.taken).length;
  const packed = trip.items.filter(item => item.packed).length;
  return { total, taken, packed, percent: total ? Math.round((packed / total) * 100) : 0 };
}

function renderNewTrip(core, ui) {
  if (!ui.newTripOpen) return '';
  const selected = ui.newTripTemplates || new Set(['Basresa']);
  const persons = core.persons?.length ? core.persons : [...new Set(core.catalog.map(item => item.person).filter(Boolean))];
  const selectedPersons = ui.newTripPersons || new Set(persons.slice(0, 1));
  const preview = core.catalog.filter(item => selectedPersons.has(item.person) && item.templates.some(template => selected.has(template)));
  const byPerson = persons.map(person => `${person} ${preview.filter(item => item.person === person).length}`).join(' · ');
  const source = core.trips.find(trip => trip.id === ui.copySourceTripId);
  return `
    <section class="card new-trip-card" aria-labelledby="new-trip-title">
      <div class="section-heading">
        <div><p class="eyebrow">${core.real ? 'Privat resa' : 'Syntetisk resa'}</p><h3 id="new-trip-title">${source ? 'Utgå från en resa' : 'Ny resa'}</h3>${source ? `<p>Rader och antal kopieras från ${escapeHtml(source.name)}. Packstatus och väskplacering nollställs.</p>` : ''}</div>
        <button class="quiet-button" type="button" data-action="close-new-trip">Stäng</button>
      </div>
      <form class="new-trip-form" data-form="new-trip">
        <input type="hidden" name="sourceTripId" value="${escapeHtml(source?.id || '')}">
        <label>Resans namn <input name="name" required maxlength="80" value="${escapeHtml(source ? `${source.name} – ny resa` : '')}" placeholder="Till exempel Köpenhamn"></label>
        <label>Destination <input name="destination" maxlength="80" value="${escapeHtml(source?.destination || '')}" placeholder="Valfritt"></label>
        <label>Startdatum <input type="date" name="dateFrom"></label>
        <label>Antal nätter <input type="number" name="nights" min="0" max="999" inputmode="numeric"></label>
        <label>Säsong <select name="season"><option value="">Välj säsong</option>${['vinter','vår','sommar','höst'].map(value => `<option value="${value}">${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>
        <label>Sällskap <input name="companions" maxlength="120" placeholder="Till exempel familjen"></label>
        ${persons.length ? `<fieldset>
          <legend>Personer</legend>
          <div class="chip-row">${persons.map(person => `<button type="button" class="filter-chip${selectedPersons.has(person) ? ' active' : ''}" aria-pressed="${selectedPersons.has(person)}" data-action="toggle-new-person" data-person="${escapeHtml(person)}">${escapeHtml(person)}</button>`).join('')}</div>
        </fieldset>` : ''}
        <fieldset>
          <legend>Mallar <button class="inline-add" type="button" data-action="create-template">+ ny</button></legend>
          <div class="chip-row">
            ${core.templates.map(template => `<button type="button" class="filter-chip${selected.has(template) ? ' active' : ''}" aria-pressed="${selected.has(template)}" data-action="toggle-new-template" data-template="${escapeHtml(template)}">${escapeHtml(template)}</button>`).join('')}
          </div>
        </fieldset>
        <label class="wide-field">Anteckningar <textarea name="notes" rows="2" maxlength="500"></textarea></label>
        <div class="preview-count"><b>${source ? source.items.length : preview.length} artiklar förbockas</b><span>${source ? 'Uppdelade rader slås ihop' : `Mallunion · ${escapeHtml(byPerson || 'ingen person vald')} · historisk median föreslår antal`}</span></div>
        <button class="primary-button fit-button" type="submit">${core.real ? 'Skapa resa' : 'Skapa testresa'}</button>
      </form>
    </section>`;
}

function renderTripEditor(core, ui) {
  const trip = core.activeTrip;
  if (!ui.tripEditOpen || !trip || ['complete', 'archived'].includes(trip.status)) return '';
  return `<section class="card trip-editor" aria-labelledby="edit-trip-title">
    <div class="section-heading"><div><p class="eyebrow">Reseuppgifter</p><h3 id="edit-trip-title">Redigera ${escapeHtml(trip.name)}</h3></div><button class="quiet-button" type="button" data-action="close-trip-edit">Stäng</button></div>
    <form class="new-trip-form" data-form="edit-trip">
      <label>Namn <input name="name" required maxlength="80" value="${escapeHtml(trip.name)}"></label>
      <label>Destination <input name="destination" maxlength="80" value="${escapeHtml(trip.destination)}"></label>
      <label>Startdatum <input type="date" name="dateFrom" value="${escapeHtml(trip.startDate)}"></label>
      <label>Antal nätter <input type="number" name="nights" min="0" max="999" value="${escapeHtml(trip.nights ?? '')}"></label>
      <label>Säsong <input name="season" maxlength="40" value="${escapeHtml(trip.season)}"></label>
      <label>Sällskap <input name="companions" maxlength="120" value="${escapeHtml(trip.companions)}"></label>
      <fieldset><legend>Personer</legend><div class="chip-row">${(core.persons || []).map(person => `<label class="check-chip"><input type="checkbox" name="persons" value="${escapeHtml(person)}"${trip.persons.includes(person) ? ' checked' : ''}>${escapeHtml(person)}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Malletiketter — ändrar inte resans rader</legend><div class="chip-row">${core.templates.map(template => `<label class="check-chip"><input type="checkbox" name="templates" value="${escapeHtml(template)}"${trip.templates.includes(template) ? ' checked' : ''}>${escapeHtml(template)}</label>`).join('')}</div></fieldset>
      <label class="wide-field">Anteckningar <textarea name="notes" rows="2" maxlength="500">${escapeHtml(trip.notes || '')}</textarea></label>
      <div class="form-actions wide-field"><button class="primary-button fit-button" type="submit">Spara reseuppgifter</button><button class="danger-outline-button" type="button" data-action="delete-trip">Flytta till Nyligen raderade</button></div>
    </form>
  </section>`;
}

function renderTripCard(trip, core) {
  const progress = tripProgress(trip);
  const readOnly = core.real && ['complete', 'archived'].includes(trip.status);
  const target = trip.status === 'packing' ? 'packa' : 'planera';
  const action = readOnly ? 'Visa innehåll' : (trip.status === 'packing' ? 'Fortsätt packa' : 'Öppna planering');
  return `
    <article class="trip-card${trip.id === core.activeTripId ? ' active-trip' : ''}">
      <div class="trip-card-main">
        <div class="trip-card-topline">
          <span class="status-pill status-${escapeHtml(trip.status)}">${escapeHtml(statusLabel(trip.status))}</span>
          ${core.syntheticOnly ? '<span class="demo-pill">DEMO</span>' : ''}
        </div>
        <h3>${escapeHtml(trip.name)}</h3>
        <p>${escapeHtml(trip.destination || 'Ingen destination')} · ${escapeHtml((trip.templates || []).join(' + ') || 'Ingen mall')}</p>
        <div class="mini-progress" aria-label="${progress.packed} av ${progress.total} rader packade"><span style="width:${progress.percent}%"></span></div>
        <small>${progress.taken} framtagna · ${progress.packed} packade · ${progress.total} rader</small>
      </div>
      <div class="trip-actions">
        <button class="primary-button fit-button" type="button" data-action="${readOnly ? 'open-history' : 'open-trip'}" data-trip-id="${escapeHtml(trip.id)}" data-target-view="${target}">${action}</button>
        <button class="secondary-button" type="button" data-action="copy-trip" data-trip-id="${escapeHtml(trip.id)}">Utgå från</button>
      </div>
    </article>`;
}

function renderHistoryDetail(core, ui) {
  const trip = core.trips.find(entry => entry.id === ui.historyTripId);
  if (!trip) return '';
  const progress = tripProgress(trip);
  const hasPlacement = trip.items.some(item => item.bag || item.location);
  return `
    <section class="card history-detail" aria-labelledby="history-title">
      <div class="section-heading">
        <div><p class="eyebrow">Läsläge · ${escapeHtml(statusLabel(trip.status))}</p><h2 id="history-title">${escapeHtml(trip.name)}</h2><p>${escapeHtml(trip.destination || 'Ingen destination')} · ${escapeHtml(trip.startDate || trip.year || '')}</p></div>
        <button class="quiet-button" type="button" data-action="close-history">Stäng</button>
      </div>
      <div class="history-summary"><span><b>${trip.items.length}</b> rader</span><span><b>${progress.taken}</b> framtagna</span><span><b>${progress.packed}</b> packade</span></div>
      <div class="history-columns" aria-hidden="true"><span>Artikel</span><span>Planerat</span><span>Framme</span><span>Packat</span>${hasPlacement ? '<span>Väska / i väskan</span>' : ''}</div>
      <div class="history-rows${hasPlacement ? ' has-placement' : ''}">
        ${trip.items.map(item => `<article class="history-row"><div><b>${escapeHtml(item.nameSnapshot)}</b><small>${escapeHtml(item.person || item.category || '')}</small></div><span>${escapeHtml(item.quantity)}</span><span class="history-state${item.taken ? ' done' : ''}">${item.taken ? '✓' : '–'} Framme</span><span class="history-state${item.packed ? ' done' : ''}">${item.packed ? '✓' : '–'} Packat</span>${hasPlacement ? `<small>${escapeHtml([item.bag, item.location].filter(Boolean).join(' · ') || '–')}</small>` : ''}</article>`).join('')}
      </div>
      <div class="history-actions"><button class="secondary-button" type="button" data-action="copy-trip" data-trip-id="${escapeHtml(trip.id)}">Utgå från denna resa</button>${trip.unlockable ? `<button class="danger-outline-button" type="button" data-action="unlock-trip" data-trip-id="${escapeHtml(trip.id)}">Lås upp för redigering</button>` : ''}${trip.status === 'complete' && trip.source === 'app' ? `<button class="secondary-button" type="button" data-action="archive-trip" data-trip-id="${escapeHtml(trip.id)}">Arkivera</button>` : ''}</div>
    </section>`;
}

function renderResor(core, ui, error) {
  const activeTrips = core.trips.filter(trip => !['complete', 'archived'].includes(trip.status));
  const archivedTrips = core.trips.filter(trip => trip.status === 'archived');
  const totalRows = core.trips.reduce((sum, trip) => sum + trip.items.length, 0);
  const real = core.real;
  const tripFilter = ui.tripFilters || { search: '', person: '', season: '' };
  const visibleTrips = core.trips.filter(trip => {
    const search = String(tripFilter.search || '').trim().toLocaleLowerCase('sv');
    if (search && !`${trip.name} ${trip.destination}`.toLocaleLowerCase('sv').includes(search)) return false;
    if (tripFilter.person && !(trip.persons || []).includes(tripFilter.person)) return false;
    if (tripFilter.season && trip.season !== tripFilter.season) return false;
    return true;
  });
  const seasons = [...new Set(core.trips.map(trip => trip.season).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  const activeTripFilters = Number(Boolean(tripFilter.search)) + Number(Boolean(tripFilter.person)) + Number(Boolean(tripFilter.season));
  return `
    <section class="hero compact-hero resor-hero">
      <div>
        <p class="eyebrow">${real ? 'Din packhistorik' : 'Etapp 4 · första säkra delen'}</p>
        <h2>${real ? `${core.trips.length} resor finns nu i Packa.` : 'Nu går det att prova Resor → Planera → Packa.'}</h2>
        <p>${real ? 'Den pågående resan ligger överst. Arkiverade resor öppnas i skrivskyddat läsläge och kan användas som grund för en ny resa.' : 'Din riktiga data är fortfarande orörd. Testresorna använder samma lokala operationslager som den framtida appen, men ligger i en helt egen databas.'}</p>
      </div>
      <button class="primary-button fit-button hero-action" type="button" data-action="open-new-trip">+ ${real ? 'Ny resa' : 'Ny testresa'}</button>
    </section>
    ${dataBoundary(core, true)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderNewTrip(core, ui)}
    ${renderHistoryDetail(core, ui)}
    <details class="trip-filter-panel"${ui.tripFiltersOpen === false ? '' : ' open'}>
      <summary><span>Sök och filtrera</span><small>${activeTripFilters ? `${activeTripFilters} aktiva` : `${visibleTrips.length} resor`}</small></summary>
      <form class="trip-filter-bar" data-form="trip-filter" aria-label="Filtrera resor"><label>Sök <input type="search" name="search" value="${escapeHtml(tripFilter.search)}" placeholder="Namn eller destination"></label><label>Person <select name="person"><option value="">Alla</option>${(core.persons || []).map(person => `<option value="${escapeHtml(person)}"${tripFilter.person === person ? ' selected' : ''}>${escapeHtml(person)}</option>`).join('')}</select></label><label>Säsong <select name="season"><option value="">Alla</option>${seasons.map(season => `<option value="${escapeHtml(season)}"${tripFilter.season === season ? ' selected' : ''}>${escapeHtml(season)}</option>`).join('')}</select></label><button class="secondary-button" type="submit">Filtrera</button><button class="text-button" type="button" data-action="clear-trip-filters">Rensa</button></form>
    </details>
    <div class="grid core-metrics">
      <section class="card span-4"><div class="metric">${core.trips.length}</div><div class="metric-label">${real ? 'befintliga resor' : 'testresor'}</div></section>
      <section class="card span-4"><div class="metric">${activeTrips.length}</div><div class="metric-label">${real ? 'pågående resor' : 'aktiva testresor'}</div></section>
      <section class="card span-4"><div class="metric">${real ? archivedTrips.length : totalRows}</div><div class="metric-label">${real ? 'arkiverade resor' : 'syntetiska resrader'}</div></section>
    </div>
    <div class="resor-layout">
      <section class="trip-list" aria-labelledby="active-trips-title">
        <div class="section-heading"><div><p class="eyebrow">Arbetsyta</p><h2 id="active-trips-title">${real ? 'Alla resor' : 'Testresor'}</h2></div></div>
        ${visibleTrips.map(trip => renderTripCard(trip, core)).join('') || '<p>Inga resor matchar filtren.</p>'}
      </section>
      <aside class="card safety-card">
        <h3>${real ? 'Privat och återställbart' : 'Datagränsen är kvar'}</h3>
        <ul class="check-list">
          ${real ? `<li>${core.catalog.length} aktiva artiklar finns lokalt</li><li>${totalRows} historiska resrader är inlästa</li><li>Arkiverade resor är skrivskyddade</li><li>V1 och v2 finns kvar som fallback</li>` : '<li>Testkatalog med nio påhittade artiklar</li><li>Egen lokal databas för kärnflödet</li><li>Ingen import av packlista-data.json</li><li>Ingen uppladdning av testresor till Dropbox</li>'}
        </ul>
      </aside>
    </div>`;
}

function currentFilter(ui) {
  return ui.filters || { search: '', activities: new Set(), functions: new Set(), persons: new Set() };
}

function renderFilterRow(core, ui) {
  const filter = currentFilter(ui);
  const activities = [...new Set(core.catalog.flatMap(item => item.activities || item.templates || [item.activity]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  const functions = [...new Set(core.catalog.map(item => item.function))].sort((a, b) => a.localeCompare(b, 'sv'));
  const chip = (kind, value, active) => `<button type="button" class="filter-chip${active ? ' active' : ''}" aria-pressed="${active}" data-action="toggle-filter" data-filter-kind="${kind}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
  const activeCount = (filter.activities?.size || 0) + (filter.functions?.size || 0) + (filter.persons?.size || 0) + (filter.search ? 1 : 0);
  return `
    <details class="filter-panel" aria-label="Visningsfilter"${ui.filtersOpen === false ? '' : ' open'}>
      <summary><span>Filter</span><small>${activeCount ? `${activeCount} aktiva` : 'Sök · aktivitet · funktion'}</small></summary>
      <form class="search-form" data-form="filter-search">
        <label><span>Sök</span><input type="search" name="search" value="${escapeHtml(filter.search)}" placeholder="Sök artikel"></label>
        <button class="secondary-button" type="submit">Visa</button>
      </form>
      <div class="filter-group"><b>Aktivitet <small>ELLER</small></b><div class="chip-row">${activities.map(value => chip('activity', value, filter.activities.has(value))).join('')}</div></div>
      <div class="filter-group"><b>Funktion <small>ELLER</small></b><div class="chip-row">${functions.map(value => chip('function', value, filter.functions.has(value))).join('')}</div></div>
      ${(core.persons || []).length > 1 ? `<div class="filter-group person-filter"><b>Person <small>ELLER</small></b><div class="chip-row">${core.persons.map(value => chip('person', value, filter.persons?.has(value))).join('')}</div></div>` : ''}
      <button class="text-button" type="button" data-action="clear-filters">Rensa filter</button>
    </details>`;
}

function matchesFilter(item, filter) {
  const search = filter.search.trim().toLocaleLowerCase('sv');
  const haystack = `${item.name || item.nameSnapshot || ''} ${item.brand || ''} ${item.model || ''}`.toLocaleLowerCase('sv');
  if (search && !haystack.includes(search)) return false;
  if (filter.activities.size && !(item.activities || item.templates || [item.activity]).some(activity => filter.activities.has(activity))) return false;
  if (filter.functions.size && !filter.functions.has(item.function)) return false;
  if (filter.persons?.size && !filter.persons.has(item.person)) return false;
  return true;
}

function renderPills(item, tripTemplates) {
  const templatePills = (item.templates || []).map(template => `<span class="item-pill${tripTemplates.includes(template) ? ' matching' : ''}">${escapeHtml(template)}</span>`).join('');
  return `<div class="item-pills">${templatePills}<span class="item-pill function-pill">${escapeHtml(item.function)}</span></div>`;
}

function renderStepper(itemId, quantity, context) {
  return `
    <div class="stepper" aria-label="Antal ${quantity}">
      <button type="button" aria-label="Minska antal" data-action="quantity" data-item-id="${escapeHtml(itemId)}" data-next="${quantity - 1}" data-context="${context}">−</button>
      <output>${quantity}</output>
      <button type="button" aria-label="Öka antal" data-action="quantity" data-item-id="${escapeHtml(itemId)}" data-next="${quantity + 1}" data-context="${context}">+</button>
    </div>`;
}

function renderPlanCatalogRow(item, rows, trip) {
  const selected = rows.length > 0;
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const split = rows.length > 1;
  return `
    <article class="plan-row${selected ? ' selected' : ''}" data-catalog-id="${escapeHtml(item.id)}">
      <button class="include-button" type="button" aria-pressed="${selected}" data-action="set-included" data-catalog-id="${escapeHtml(item.id)}" data-included="${!selected}"><span aria-hidden="true">${selected ? '✓' : '+'}</span><span class="sr-only">${selected ? 'Ta bort från resan' : 'Lägg till på resan'}</span></button>
      <div class="item-copy">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml([item.brand, item.model].filter(Boolean).join(' · ') || item.department)} · <b>${escapeHtml(item.function)}</b></p>
        ${renderPills(item, trip.templates || [])}
      </div>
      <div class="plan-quantity">
        ${selected && !split ? renderStepper(rows[0].id, quantity, 'planera') : ''}
        ${split ? `<b>${quantity}</b><small>uppdelad på ${rows.length} rader</small>` : ''}
        ${!selected ? `<small>${item.weight ? `${item.weight} g` : ''}</small>` : ''}
      </div>
    </article>`;
}

function renderCustomPlanRow(item) {
  return `
    <article class="plan-row selected custom-row">
      <span class="include-button static-check" aria-hidden="true">✓</span>
      <div class="item-copy"><h3>${escapeHtml(item.nameSnapshot)}</h3><p>Engångsartikel · rör inte mastern</p><div class="item-pills"><span class="item-pill function-pill">Egen rad</span></div></div>
      <div class="plan-quantity">${renderStepper(item.id, item.quantity, 'planera')}</div>
    </article>`;
}

function renderPlanGroup(title, items, rowsByCatalog, trip, ui) {
  const selectedCount = items.filter(item => rowsByCatalog.has(item.id)).length;
  const byDepartment = groupBy(items, 'department');
  return `
    <details class="item-group"${ui.groupsOpen === false ? '' : ' open'}>
      <summary><span>${escapeHtml(title)}</span><small>${selectedCount}/${items.length} med</small></summary>
      <div class="group-rows">${(ui.planGroup === 'activity' ? items.map(item => renderPlanCatalogRow(item, rowsByCatalog.get(item.id) || [], trip)).join('') : byDepartment.map(([department, departmentItems]) => `<section class="department-group"><h3>${escapeHtml(department)}</h3>${departmentItems.map(item => renderPlanCatalogRow(item, rowsByCatalog.get(item.id) || [], trip)).join('')}</section>`).join(''))}</div>
    </details>`;
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = item[key] || 'Övrigt';
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'sv'));
}

function renderCustomForm(ui) {
  if (!ui.customRowOpen) return '';
  return `
    <form class="custom-item-form" data-form="custom-item">
      <label>Namnet på den egna raden <input name="name" required maxlength="80" autofocus placeholder="Till exempel Födelsedagspresent"></label>
      ${(ui.customPersons || []).length > 1 ? `<label>Person <select name="person">${ui.customPersons.map(person => `<option value="${escapeHtml(person)}">${escapeHtml(person)}</option>`).join('')}</select></label>` : ''}
      <button class="primary-button fit-button" type="submit">Lägg till</button>
      <button class="quiet-button" type="button" data-action="close-custom-row">Avbryt</button>
    </form>`;
}

function renderPlanera(core, ui, error) {
  const trip = core.activeTrip;
  if (!trip) return `${dataBoundary(core)}${shellCard('Ingen pågående resa vald', 'Skapa eller öppna en pågående resa från Resor först.')}`;
  const filter = currentFilter(ui);
  const rowsByCatalog = new Map();
  for (const row of trip.items.filter(item => item.catalogId)) {
    if (!rowsByCatalog.has(row.catalogId)) rowsByCatalog.set(row.catalogId, []);
    rowsByCatalog.get(row.catalogId).push(row);
  }
  const matching = core.catalog.filter(item => item.templates.some(template => (trip.templates || []).includes(template)) || rowsByCatalog.has(item.id));
  const rest = core.catalog.filter(item => !matching.includes(item));
  const visibleMatching = matching.filter(item => matchesFilter(item, filter));
  const visibleRest = rest.filter(item => matchesFilter(item, filter));
  const customRows = trip.items.filter(item => item.custom && matchesFilter(item, filter));
  const totalSelected = trip.items.reduce((sum, item) => sum + item.quantity, 0);
  const groupKey = ui.planGroup === 'activity' ? 'activity' : 'category';
  const visibleIds = visibleMatching.map(item => item.id);
  const visibleSelected = visibleMatching.filter(item => rowsByCatalog.has(item.id)).length;
  return `
    <section class="hero workspace-hero">
      <div><p class="eyebrow">${core.real ? 'Privat resa' : 'Syntetisk resa'} · ${escapeHtml(statusLabel(trip.status))}</p><h2>${escapeHtml(trip.name)}</h2><p>Bestäm vad som ska med. Funktion visas som underrubrik; mallchipsen är bara etiketter.</p></div>
      <div class="hero-actions"><span class="hero-badge">${trip.items.length} rader · ${totalSelected} st</span><button class="secondary-button" type="button" data-action="open-trip-edit">Reseuppgifter</button><button class="primary-button fit-button" type="button" data-action="start-packing">Börja packa</button></div>
    </section>
    ${dataBoundary(core)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderTripEditor(core, ui)}
    ${renderFilterRow(core, ui)}
    <div class="list-toolbar"><div><b>Resans lins</b><span>${visibleMatching.length} synliga av ${matching.length}</span></div><div class="toolbar-actions"><button class="filter-chip${groupKey === 'category' ? ' active' : ''}" type="button" data-action="set-plan-group" data-group="category">Kategori</button><button class="filter-chip${groupKey === 'activity' ? ' active' : ''}" type="button" data-action="set-plan-group" data-group="activity">Aktivitet</button><button class="secondary-button" type="button" data-action="set-groups-open" data-open="true">Veckla ut alla</button><button class="secondary-button" type="button" data-action="set-groups-open" data-open="false">Fäll ihop alla</button><button class="secondary-button" type="button" data-action="open-custom-row">+ Egen rad</button></div></div>
    <div class="bulk-bar"><span>${visibleSelected}/${visibleMatching.length} synliga artiklar är med</span><button type="button" class="secondary-button" data-action="bulk-included" data-included="true" data-catalog-ids="${escapeHtml(visibleIds.join(','))}">Lägg till alla synliga</button><button type="button" class="danger-outline-button" data-action="bulk-included" data-included="false" data-catalog-ids="${escapeHtml(visibleIds.join(','))}">Ta bort alla synliga</button></div>
    ${renderCustomForm({ ...ui, customPersons: trip.persons })}
    <section class="plan-list" aria-label="Artiklar i resans lins">
      ${groupBy(visibleMatching, groupKey).map(([title, items]) => renderPlanGroup(title, items, rowsByCatalog, trip, ui)).join('')}
      ${customRows.length ? `<details class="item-group" open><summary><span>Eget</span><small>${customRows.length}/${customRows.length} med</small></summary><div class="group-rows">${customRows.map(renderCustomPlanRow).join('')}</div></details>` : ''}
      ${!visibleMatching.length && !customRows.length ? '<div class="empty-state">Inga artiklar matchar filtren.</div>' : ''}
    </section>
    <details class="other-master">
      <summary>Allt annat i ${core.real ? 'mastern' : 'testmastern'} (${visibleRest.length})</summary>
      <div class="plan-list">${groupBy(visibleRest, groupKey).map(([title, items]) => renderPlanGroup(title, items, rowsByCatalog, trip, ui)).join('') || '<div class="empty-state">Inget mer matchar filtren.</div>'}</div>
    </details>`;
}

function renderSplitForm(item, ui) {
  if (ui.splitItemId !== item.id) return '';
  return `<form class="split-form" data-form="split-item"><input type="hidden" name="itemId" value="${escapeHtml(item.id)}"><label>Bryt ut antal <input type="number" name="quantity" min="1" max="${Math.max(1, item.quantity - 1)}" value="1"></label><button class="primary-button fit-button" type="submit">Dela raden</button><button class="quiet-button" type="button" data-action="close-split">Avbryt</button></form>`;
}

function renderPackRow(item, tripItems, core, ui) {
  const siblings = tripItems.filter(row => row.mergeKey === item.mergeKey);
  const bagRecord = (core.bagLibrary || []).find(bag => bag.name === item.bag);
  const suggestions = [...new Set([...(bagRecord?.compartments || []), ...(core.pouches || [])])];
  const bagNames = [...core.bags];
  if (item.bag && !bagNames.includes(item.bag)) bagNames.push(item.bag);
  return `
    <article class="pack-row${item.packed ? ' is-packed' : ''}">
      <div class="pack-item-copy">
        <h3>${escapeHtml(item.nameSnapshot)}</h3>
        <p>${escapeHtml(item.function)}${item.custom ? ' · egen rad' : ''}</p>
        <div class="row-tools">
          ${item.quantity > 1 ? `<button class="chip-button" type="button" data-action="open-split" data-item-id="${escapeHtml(item.id)}">Dela</button>` : ''}
          ${siblings.length > 1 ? `<button class="chip-button" type="button" data-action="merge-items" data-merge-key="${escapeHtml(item.mergeKey)}">Slå ihop</button>` : ''}
        </div>
        ${renderSplitForm(item, ui)}
      </div>
      <div class="pack-quantity"><span>Antal</span>${renderStepper(item.id, item.quantity, 'packa')}</div>
      <button class="state-button${item.taken ? ' active' : ''}" type="button" aria-pressed="${item.taken}" data-action="toggle-taken" data-item-id="${escapeHtml(item.id)}"><span aria-hidden="true">${item.taken ? '✓' : '○'}</span>Framme</button>
      <button class="state-button${item.packed ? ' active' : ''}" type="button" aria-pressed="${item.packed}" data-action="toggle-packed" data-item-id="${escapeHtml(item.id)}"><span aria-hidden="true">${item.packed ? '✓' : '○'}</span>Packat</button>
      ${ui.showBags ? `<div class="bag-fields">
        <label>Väska<select data-action="set-bag" data-item-id="${escapeHtml(item.id)}"><option value="">Utan väska</option>${bagNames.map(bag => `<option value="${escapeHtml(bag)}"${item.bag === bag ? ' selected' : ''}>${escapeHtml(bag)}</option>`).join('')}</select></label>
        <label>I väskan<input value="${escapeHtml(item.location)}" data-action="set-location" data-item-id="${escapeHtml(item.id)}" list="locations-${escapeHtml(item.id)}" placeholder="Fack eller påse"><datalist id="locations-${escapeHtml(item.id)}">${suggestions.map(value => `<option value="${escapeHtml(value)}">`).join('')}</datalist></label>
        ${(tripItems.some(row => row.person) && (core.persons || []).length > 1) ? `<label>Person<select data-action="set-person" data-item-id="${escapeHtml(item.id)}">${core.persons.map(person => `<option value="${escapeHtml(person)}"${item.person === person ? ' selected' : ''}>${escapeHtml(person)}</option>`).join('')}</select></label>` : ''}
      </div>` : ''}
    </article>`;
}

function sortedBagGroups(items) {
  return groupBy(items, 'bag').sort(([a], [b]) => {
    if (a === 'Övrigt') return 1;
    if (b === 'Övrigt') return -1;
    return a.localeCompare(b, 'sv');
  }).map(([bag, rows]) => [bag === 'Övrigt' ? 'Utan väska' : bag, rows]);
}

function renderPackGroups(visible, trip, core, ui) {
  if (ui.packGroup === 'bag') {
    return sortedBagGroups(visible).map(([bag, bagItems]) => {
      const packed = bagItems.filter(item => item.packed).length;
      const subgroups = groupBy(bagItems, 'location').map(([location, rows]) => `<section class="pouch-subgroup"><h3>${escapeHtml(location === 'Övrigt' ? 'Löst i väskan' : location)}</h3>${rows.map(item => renderPackRow(item, trip.items, core, ui)).join('')}</section>`).join('');
      return `<section class="pack-group"><div class="pack-group-heading"><h2>${escapeHtml(bag)}</h2><span>${packed}/${bagItems.length} packade</span></div>${subgroups}</section>`;
    }).join('');
  }
  const key = ui.packGroup === 'activity' ? 'activity' : 'category';
  return groupBy(visible, key).map(([title, items]) => `<section class="pack-group"><div class="pack-group-heading"><h2>${escapeHtml(title)}</h2><span>${items.filter(item => item.packed).length}/${items.length}</span></div>${items.map(item => renderPackRow(item, trip.items, core, ui)).join('')}</section>`).join('');
}

function renderPacka(core, ui, error) {
  const trip = core.activeTrip;
  if (!trip) return `${dataBoundary(core)}${shellCard('Ingen pågående resa vald', 'Skapa eller öppna en pågående resa från Resor först.')}`;
  const filter = currentFilter(ui);
  const total = trip.items.length;
  const taken = trip.items.filter(item => item.taken).length;
  const packed = trip.items.filter(item => item.packed).length;
  const remaining = total - packed;
  const percent = total ? Math.round((packed / total) * 100) : 0;
  const visible = trip.items.filter(item => matchesFilter(item, filter))
    .filter(item => !ui.hidePacked || !item.packed)
    .filter(item => !ui.hideTaken || !item.taken);
  const personProgress = (trip.persons || []).map(person => {
    const rows = trip.items.filter(item => item.person === person);
    return `<span><b>${escapeHtml(person)}</b> ${rows.filter(item => item.packed).length}/${rows.length}</span>`;
  }).join('');
  return `
    <section class="pack-progress" aria-label="Packprogress">
      <div><p class="eyebrow">${escapeHtml(trip.name)} · ${escapeHtml((trip.persons || []).join(' + ') || 'Resa')}</p><h2>${packed} av ${total} rader packade</h2><p>${taken} framtagna · progress räknar alltid alla rader</p><div class="person-progress">${personProgress}</div></div>
      <div class="pack-progress-actions"><div class="progress-ring" style="--progress:${percent * 3.6}deg"><b>${percent}%</b></div><button class="finish-compact" type="button" data-action="finish-trip">Avsluta</button></div>
    </section>
    ${dataBoundary(core, true)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderTripEditor(core, ui)}
    ${renderFilterRow(core, ui)}
    <section class="pack-toolbar" aria-label="Visningsinställningar">
      <div class="pack-group-picker" aria-label="Gruppera packlistan">
        <button class="filter-chip${(ui.packGroup || 'category') === 'category' ? ' active' : ''}" type="button" data-action="set-pack-group" data-group="category">Kategori</button>
        <button class="filter-chip${ui.packGroup === 'activity' ? ' active' : ''}" type="button" data-action="set-pack-group" data-group="activity">Aktivitet</button>
        <button class="filter-chip${ui.packGroup === 'bag' ? ' active' : ''}" type="button" data-action="set-pack-group" data-group="bag">Väska</button>
      </div>
      <button class="filter-chip${ui.hidePacked ? ' active' : ''}" type="button" aria-pressed="${ui.hidePacked}" data-action="toggle-pack-view" data-pack-key="hidePacked">Dölj packade <span>${packed}</span></button>
      <span class="toolbar-count">${visible.length} visas · ${total} räknas</span>
      <details class="pack-more">
        <summary>Fler val</summary>
        <div class="pack-more-actions">
          <button class="filter-chip${ui.showBags ? ' active' : ''}" type="button" aria-pressed="${ui.showBags}" data-action="toggle-pack-view" data-pack-key="showBags">${ui.showBags ? 'Dölj' : 'Visa'} väskfält</button>
          <button class="filter-chip${ui.hideTaken ? ' active' : ''}" type="button" aria-pressed="${ui.hideTaken}" data-action="toggle-pack-view" data-pack-key="hideTaken">Dölj framtagna <span>${taken}</span></button>
          <button class="secondary-button" type="button" data-action="open-custom-row">+ Egen rad</button>
          <button class="secondary-button" type="button" data-action="open-trip-edit">Reseuppgifter</button>
          <button class="secondary-button print-button" type="button" data-action="print-trip">Skriv ut</button>
        </div>
      </details>
    </section>
    ${renderCustomForm({ ...ui, customPersons: trip.persons })}
    <section class="pack-list" aria-label="Packrader">
      ${renderPackGroups(visible, trip, core, ui) || '<div class="empty-state">Inga rader matchar visningen. Progressen ovan räknar fortfarande hela resan.</div>'}
    </section>
    <div class="finish-bar"><span><b>${packed}/${total} packade</b><small>${remaining ? `${remaining} omarkerade rader bevaras oförändrade.` : 'Alla rader är markerade som packade.'}</small></span><button class="primary-button fit-button" type="button" data-action="finish-trip">Avsluta och arkivera</button></div>`;
}

function renderCatalogForm(core, ui) {
  const item = (core.allCatalog || core.catalog).find(entry => entry.id === ui.masterEditId);
  if (!item && !ui.masterNewOpen) return '';
  const editing = Boolean(item);
  const selectedTemplates = new Set(item?.templates || []);
  return `<section class="card catalog-editor" aria-labelledby="catalog-editor-title">
    <div class="section-heading"><div><p class="eyebrow">${editing ? 'Redigera artikel' : 'Ny artikel'}</p><h2 id="catalog-editor-title">${escapeHtml(item?.name || 'Lägg till i mastern')}</h2></div><button class="quiet-button" type="button" data-action="close-catalog-editor">Stäng</button></div>
    <form class="catalog-form" data-form="${editing ? 'edit-catalog' : 'new-catalog'}">
      ${editing ? `<input type="hidden" name="itemId" value="${escapeHtml(item.id)}">` : ''}
      <label>Namn <input name="name" required maxlength="120" value="${escapeHtml(item?.name || '')}"></label>
      <label>Person <select name="person">${(core.persons || []).map(person => `<option value="${escapeHtml(person)}"${item?.person === person ? ' selected' : ''}>${escapeHtml(person)}</option>`).join('')}</select></label>
      <label>Åtgärd <select name="category">${['A. Att göra','B. Att köpa','C. Att packa','D. Ej aktuellt'].map(value => `<option value="${value}"${item?.category === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Avdelning <input name="department" maxlength="80" value="${escapeHtml(item?.department === 'Övrigt' ? '' : item?.department || '')}"></label>
      <label>Funktion <input name="function" maxlength="80" value="${escapeHtml(item?.function === 'Övrigt' ? '' : item?.function || '')}"></label>
      <label>Märke <input name="brand" maxlength="80" value="${escapeHtml(item?.brand || '')}"></label>
      <label>Modell <input name="model" maxlength="80" value="${escapeHtml(item?.model || '')}"></label>
      <label>Vikt (g) <input type="number" name="weight" min="0" value="${escapeHtml(item?.weight || '')}"></label>
      <fieldset class="wide-field"><legend>Mallar</legend><div class="chip-row">${core.templates.map(template => `<label class="check-chip"><input type="checkbox" name="templates" value="${escapeHtml(template)}"${selectedTemplates.has(template) ? ' checked' : ''}>${escapeHtml(template)}</label>`).join('')}</div></fieldset>
      <label class="wide-field">Kommentar <textarea name="comment" rows="2">${escapeHtml(item?.comment || '')}</textarea></label>
      <label class="wide-field">Så packas den <textarea name="howToPack" rows="2">${escapeHtml(item?.how_to_pack || '')}</textarea></label>
      <div class="form-actions wide-field"><button class="primary-button fit-button" type="submit">${editing ? 'Spara artikel' : 'Skapa artikel'}</button></div>
    </form>
  </section>`;
}

function archiveModeAllows(item, mode) {
  if (mode === 'archived') return item.archived;
  if (mode === 'all') return true;
  return !item.archived;
}

function renderMaster(core, ui, error) {
  const all = core.allCatalog || core.catalog;
  const filter = currentFilter(ui);
  const mode = ui.masterArchiveMode || 'active';
  const person = ui.masterPerson || core.persons?.[0] || '';
  const duplicateIds = new Set((core.duplicateGroups || []).flat().map(item => item.id));
  const visible = all.filter(item => (!person || item.person === person) && archiveModeAllows(item, mode) && matchesFilter(item, filter));
  return `<section class="hero compact-hero"><div><p class="eyebrow">Artikelregister per person</p><h2>${all.length} artiklar, historiken skyddad.</h2><p>Artiklar arkiveras i stället för att raderas. Statistik och dubbletter är förslag; ingenting slås ihop automatiskt.</p></div><button class="primary-button fit-button hero-action" type="button" data-action="open-new-catalog">+ Ny artikel</button></section>
    ${dataBoundary(core)}${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}${renderCatalogForm(core, ui)}
    <div class="master-controls">${(core.persons || []).length ? `<label>Person <select data-action="set-master-person">${core.persons.map(value => `<option value="${escapeHtml(value)}"${person === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>` : ''}<div class="segmented">${[['active','Aktiva'],['all','Visa med arkiverade'],['archived','Enbart arkiverade']].map(([value,label]) => `<button class="filter-chip${mode === value ? ' active' : ''}" type="button" data-action="set-master-archive" data-mode="${value}">${label}</button>`).join('')}</div><span>${visible.length} visas</span></div>
    ${renderFilterRow(core, ui)}
    ${(core.duplicateGroups || []).length ? `<section class="duplicate-notice" role="status"><b>${core.duplicateGroups.length} möjliga namndubbletter</b>${core.duplicateGroups.slice(0, 5).map(group => `<span>${group.length} rader heter ${escapeHtml(group[0].name)} för ${escapeHtml(group[0].person)}</span>`).join('')}</section>` : ''}
    <section class="master-table" aria-label="Artikelmaster"><div class="master-head"><span>Artikel</span><span>Avdelning / funktion</span><span>Mallar</span><span>Andel</span><span>Åtgärd</span></div>${visible.map(item => {
      const insight = item.insight || {};
      const trend = insight.trend === 'up' ? '↑' : insight.trend === 'down' ? '↓' : '→';
      return `<article class="master-row${item.archived ? ' is-archived' : ''}"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml([item.brand,item.model].filter(Boolean).join(' · ') || item.person)}</small>${duplicateIds.has(item.id) ? '<span class="warning-pill">Dubblett?</span>' : ''}${insight.archiveHint ? '<span class="hint-pill">Arkivera?</span>' : ''}</div><div><span>${escapeHtml(item.department)}</span><small>${escapeHtml(item.function)}</small></div><div class="mini-pills">${(item.templates || []).map(template => `<span>${escapeHtml(template)}</span>`).join('') || '<small>Ingen mall</small>'}</div><div><b>${escapeHtml(insight.weightedPercent ?? 0)} % ${trend}</b><small>${escapeHtml(insight.packedTrips ?? 0)}/${escapeHtml(insight.eligibleTrips ?? 0)} resor</small></div><div class="row-actions"><button class="secondary-button" type="button" data-action="edit-catalog" data-item-id="${escapeHtml(item.id)}">Redigera</button><button class="${item.archived ? 'secondary-button' : 'danger-outline-button'}" type="button" data-action="set-catalog-archived" data-item-id="${escapeHtml(item.id)}" data-archived="${!item.archived}">${item.archived ? 'Återställ' : 'Arkivera'}</button></div></article>`;
    }).join('') || '<div class="empty-state">Inga artiklar matchar.</div>'}</section>`;
}

function renderMatrix(core, ui, error) {
  const filter = currentFilter(ui);
  const selected = ui.matrixTemplates?.size ? ui.matrixTemplates : new Set(core.templates);
  const shownTemplates = core.templates.filter(template => selected.has(template));
  const person = ui.matrixPerson || core.persons?.[0] || '';
  const all = core.allCatalog || core.catalog;
  const visible = all.filter(item => (!person || item.person === person) && (ui.matrixShowArchived || !item.archived) && matchesFilter(item, filter));
  const groupKey = ['category', 'activity', 'function'].includes(ui.matrixGroup) ? ui.matrixGroup : 'category';
  const matrixRows = groupBy(visible, groupKey).map(([group, items]) => `<tr class="matrix-group-row"><th colspan="${shownTemplates.length + 2}">${escapeHtml(group)}</th></tr>${items.map(item => `<tr><th><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.department)}</small></th><td>${escapeHtml(item.insight?.weightedPercent ?? 0)} %</td>${shownTemplates.map(template => `<td><button type="button" aria-label="${escapeHtml(item.name)} i ${escapeHtml(template)}" aria-pressed="${item.templates.includes(template)}" class="matrix-cell${item.templates.includes(template) ? ' active' : ''}" data-action="toggle-catalog-template" data-item-id="${escapeHtml(item.id)}" data-template="${escapeHtml(template)}">${item.templates.includes(template) ? '✓' : '·'}</button></td>`).join('')}</tr>`).join('')}`).join('');
  return `<section class="hero compact-hero"><div><p class="eyebrow">Kurerad kunskap</p><h2>Mallmatris för ${escapeHtml(person || 'alla')}.</h2><p>Klick i en cell ändrar bara framtida resors mallurval. Befintliga resor påverkas aldrig.</p></div><button class="secondary-button hero-action" type="button" data-action="create-template">+ Ny mall</button></section>${dataBoundary(core)}${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="matrix-controls">${(core.persons || []).length ? `<label>Person <select data-action="set-matrix-person">${core.persons.map(value => `<option value="${escapeHtml(value)}"${person === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>` : ''}<label class="check-chip"><input type="checkbox" data-action="toggle-matrix-archived"${ui.matrixShowArchived ? ' checked' : ''}>Visa arkiverade</label><div class="matrix-grouping"><b>Gruppera rader</b>${[['category','Kategori'],['activity','Aktivitet'],['function','Funktion']].map(([value,label]) => `<button type="button" class="filter-chip${groupKey === value ? ' active' : ''}" data-action="set-matrix-group" data-group="${value}">${label}</button>`).join('')}</div><div class="chip-row matrix-columns">${core.templates.map(template => `<button type="button" class="filter-chip${selected.has(template) ? ' active' : ''}" data-action="toggle-matrix-template" data-template="${escapeHtml(template)}">${escapeHtml(template)}</button>`).join('')}</div></div>
    ${renderFilterRow(core, ui)}
    <div class="matrix-scroll"><table class="matrix-table"><thead><tr><th>Artikel</th><th>Andel</th>${shownTemplates.map(template => `<th>${escapeHtml(template)}<small>${visible.filter(item => item.templates.includes(template)).length}</small></th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table></div>`;
}

function renderVanor(core, ui) {
  const habits = ui.habitFilters || { person: core.persons?.[0] || '', template: '', season: '', function: '', search: '', never: false };
  const trips = core.trips.filter(trip => (!habits.template || trip.templates.includes(habits.template)) && (!habits.season || trip.season === habits.season));
  const all = (core.allCatalog || core.catalog).filter(item => !item.archived);
  const insights = calculateCatalogInsights(all, trips);
  const visible = all.filter(item => (!habits.person || item.person === habits.person) && (!habits.function || item.function === habits.function) && (!habits.search || `${item.name} ${item.brand || ''} ${item.model || ''}`.toLocaleLowerCase('sv').includes(habits.search.toLocaleLowerCase('sv')))).map(item => ({ ...item, insight: insights.get(item.id) })).filter(item => !habits.never || item.insight.neverPacked).sort((a, b) => b.insight.weightedPercent - a.insight.weightedPercent || a.name.localeCompare(b.name, 'sv'));
  const seasons = [...new Set(core.trips.map(trip => trip.season).filter(Boolean))].sort((a,b) => a.localeCompare(b,'sv'));
  const functions = [...new Set(all.map(item => item.function).filter(Boolean))].sort((a,b) => a.localeCompare(b,'sv'));
  return `<section class="hero"><div><p class="eyebrow">Beslutsstöd, aldrig autopilot</p><h2>Så har saker faktiskt packats.</h2><p>Tidsviktningen har tre års halveringstid. Underlaget är alltid personspecifikt och uppdelade rader summeras per resa.</p></div></section>${dataBoundary(core)}
    <form class="habit-filter" data-form="habit-filter"><label>Person <select name="person">${(core.persons || []).map(value => `<option value="${escapeHtml(value)}"${habits.person === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Restyp <select name="template"><option value="">Alla</option>${core.templates.map(value => `<option value="${escapeHtml(value)}"${habits.template === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Säsong <select name="season"><option value="">Alla</option>${seasons.map(value => `<option value="${escapeHtml(value)}"${habits.season === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Funktion <select name="function"><option value="">Alla</option>${functions.map(value => `<option value="${escapeHtml(value)}"${habits.function === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Sök <input name="search" value="${escapeHtml(habits.search)}"></label><label class="check-chip"><input type="checkbox" name="never"${habits.never ? ' checked' : ''}>Aldrig packade</label><button class="secondary-button" type="submit">Visa</button></form>
    <p class="underlag">Underlag: ${trips.filter(trip => ['complete','archived'].includes(trip.status) && trip.persons.includes(habits.person)).length} avslutade resor där ${escapeHtml(habits.person)} var med · viktat mot de senaste åren.</p>
    <section class="habit-list">${visible.map(item => { const i = item.insight; const trend = i.trend === 'up' ? '↑' : i.trend === 'down' ? '↓' : '→'; return `<article><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.function)} · median ${i.medianQuantity} st</small></div><strong>${i.weightedPercent} % ${trend}</strong><span>${i.packedTrips} av ${i.eligibleTrips} resor</span></article>`; }).join('') || '<div class="empty-state">Inga artiklar matchar.</div>'}</section>`;
}

function renderBibliotek(core, ui, error) {
  const editBag = (core.bagLibrary || []).find(bag => bag.id === ui.editBagId);
  const editPouch = (core.pouchLibrary || []).find(pouch => pouch.id === ui.editPouchId);
  return `<section class="hero"><div><p class="eyebrow">Väljarlistor</p><h2>Väskor, fack och globala påsar.</h2><p>Namn sparas som ögonblicksbilder på resrader. Biblioteksändringar kan därför aldrig ändra historiken.</p></div></section>${dataBoundary(core)}${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="library-grid"><section class="card"><div class="section-heading"><h2>Väskor</h2><button class="secondary-button" type="button" data-action="open-new-bag">+ Ny väska</button></div>${ui.newBagOpen || editBag ? `<form class="library-form" data-form="${editBag ? 'edit-bag' : 'new-bag'}">${editBag ? `<input type="hidden" name="bagId" value="${escapeHtml(editBag.id)}">` : ''}<label>Namn <input name="name" required value="${escapeHtml(editBag?.name || '')}"></label><label>Fack, separerade med komma <input name="compartments" value="${escapeHtml(editBag?.compartments.join(', ') || '')}"></label><button class="primary-button fit-button" type="submit">${editBag ? 'Spara' : 'Skapa'}</button></form>` : ''}<div class="library-list">${(core.bagLibrary || []).map(bag => `<article><div><b>${escapeHtml(bag.name)}</b><small>${escapeHtml(bag.compartments.join(' · ') || 'Inga fack')}</small></div><div class="row-actions"><button class="secondary-button" type="button" data-action="edit-bag" data-bag-id="${escapeHtml(bag.id)}">Redigera</button><button class="${bag.archived ? 'secondary-button' : 'danger-outline-button'}" type="button" data-action="set-bag-archived" data-bag-id="${escapeHtml(bag.id)}" data-archived="${!bag.archived}">${bag.archived ? 'Återställ' : 'Arkivera'}</button></div></article>`).join('')}</div></section>
    <section class="card"><div class="section-heading"><h2>Globala påsar</h2><button class="secondary-button" type="button" data-action="open-new-pouch">+ Ny påse</button></div>${ui.newPouchOpen || editPouch ? `<form class="library-form" data-form="${editPouch ? 'edit-pouch' : 'new-pouch'}">${editPouch ? `<input type="hidden" name="pouchId" value="${escapeHtml(editPouch.id)}">` : ''}<label>Namn <input name="name" required value="${escapeHtml(editPouch?.name || '')}"></label><button class="primary-button fit-button" type="submit">${editPouch ? 'Spara' : 'Skapa'}</button></form>` : ''}<div class="library-list">${(core.pouchLibrary || []).map(pouch => `<article><div><b>${escapeHtml(pouch.name)}</b><small>Kan föreslås i alla väskor</small></div><div class="row-actions"><button class="secondary-button" type="button" data-action="edit-pouch" data-pouch-id="${escapeHtml(pouch.id)}">Redigera</button><button class="${pouch.archived ? 'secondary-button' : 'danger-outline-button'}" type="button" data-action="set-pouch-archived" data-pouch-id="${escapeHtml(pouch.id)}" data-archived="${!pouch.archived}">${pouch.archived ? 'Återställ' : 'Arkivera'}</button></div></article>`).join('')}</div></section></div>`;
}

function renderData(core, ui, error) {
  const storage = ui.storageStatus || {};
  const megabytes = value => value === null || value === undefined ? 'okänt' : `${Math.round(value / 1024 / 1024)} MB`;
  return `<section class="hero"><div><p class="eyebrow">Äg din data</p><h2>Export och kontrollerad återställning.</h2><p>Exporterna skapas lokalt i webbläsaren. Ingen personlig data läggs i appskalet eller GitHub.</p></div></section>${dataBoundary(core)}${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="grid data-grid"><section class="card span-6"><h2>Export</h2><p>Läsbar schema-v1-JSON innehåller hela mastern och historiken. CSV innehåller artikelregistret.</p><div class="stack-actions"><button class="primary-button" type="button" data-action="export-json">Exportera komplett JSON</button><button class="secondary-button" type="button" data-action="export-csv">Exportera artikelmaster som CSV</button><button class="secondary-button" type="button" data-action="print-trip">Skriv ut vald resa</button></div></section><section class="card span-6"><h2>Återställ från arkiv</h2><p>Filen valideras först. Inget skrivs innan du därefter bekräftar den redovisade omfattningen.</p><label class="file-picker">Välj JSON-arkiv <input type="file" accept="application/json,.json" data-action="select-restore-file"></label>${ui.restoreReport ? `<div class="restore-report" role="status"><b>Filen är giltig</b><span>${ui.restoreReport.items} artiklar · ${ui.restoreReport.trips} resor · ${ui.restoreReport.trip_rows} rader</span><button class="danger-button" type="button" data-action="restore-archive">Återställ denna fil</button></div>` : ''}</section></div>
    <section class="card storage-card"><h2>Lokal lagring</h2><p>${storage.supported ? (storage.persisted ? 'Webbläsaren har beviljat beständig lagring för Packas lokala databas.' : 'Beständig lagring kunde inte garanteras. Dropbox och JSON-export är därför extra viktiga.') : 'Webbläsaren rapporterar inte lagringsstatus.'}</p><small>Använt ${megabytes(storage.usage)} av ${megabytes(storage.quota)} tillgängligt.</small></section>
    <section class="card recovery-card"><h2>Återhämtningsordning</h2><ol><li>Synka först om Dropbox-sessionen är tillgänglig.</li><li>Exportera en aktuell JSON innan en restore.</li><li>Välj arkivfil och kontrollera antalen.</li><li>Bekräfta restore; en automatisk backup laddas ner och, om Dropbox är ansluten, sparas även privat i <code>/archive/</code>.</li></ol></section>`;
}

function renderStatus(core, status = {}, error = '') {
  const tripWord = core.real ? (core.trips.length === 1 ? 'resa' : 'resor') : (core.trips.length === 1 ? 'testresa' : 'testresor');
  const itemWord = core.real ? (core.catalog.length === 1 ? 'aktiv artikel' : 'aktiva artiklar') : (core.catalog.length === 1 ? 'testartikel' : 'testartiklar');
  const localData = `${core.trips.length} ${tripWord} · ${core.catalog.length} ${itemWord}`;
  const lastSync = status.lastSync || 'Ingen lyckad synk registrerad på den här enheten';
  const syncButton = status.dropboxAuthorized ? 'Synka nu' : (status.dropboxCredentialStored ? 'Anslut Dropbox igen' : (core.real ? 'Anslut Dropbox och synka' : 'Anslut Dropbox och hämta privata resor'));
  const dropboxSession = status.dropboxAuthorized
    ? 'Aktiv – automatisk synk är igång'
    : (status.dropboxCredentialStored ? 'Sparad behörighet finns men kunde inte aktiveras' : 'Inte ansluten på den här enheten');
  const pendingOps = status.pendingOps === null || status.pendingOps === undefined ? 'Läser…' : (status.pendingOps ? `${status.pendingOps} ändringar väntar på uppladdning` : 'Inga ändringar väntar');
  const lastResult = status.lastUploadedOps === null || status.lastUploadedOps === undefined || status.lastDownloadedOps === null || status.lastDownloadedOps === undefined
    ? 'Inget resultat i den här sessionen'
    : `${status.lastUploadedOps} skickade · ${status.lastDownloadedOps} hämtade`;
  const device = `${status.deviceId ? String(status.deviceId).slice(-8) : 'okänd'}${status.knownAppDevices === null || status.knownAppDevices === undefined ? '' : ` · ${status.knownAppDevices} kända appenheter`}`;
  const deletedTrips = core.deletedTrips || [];
  return `<section class="hero compact-hero status-hero"><div><p class="eyebrow">Två separata lager</p><h2>Data och appversion.</h2><p>Här ser du om dina privata resor har synkats och om den senaste Packa-versionen körs.</p></div></section>
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="status-grid">
      <section class="card status-card" aria-labelledby="data-status-title">
        <div class="status-card-heading"><div><p class="eyebrow">Privat innehåll</p><h2 id="data-status-title">Data</h2></div><span class="status-badge" data-status-sync-state>${escapeHtml(status.syncLabel || 'Läser status…')}</span></div>
        <dl class="status-facts">
          <div><dt>På enheten</dt><dd>${escapeHtml(localData)}</dd></div>
          <div><dt>Senast lyckad synk</dt><dd data-status-last-sync>${escapeHtml(lastSync)}</dd></div>
          <div><dt>Senaste synkresultat</dt><dd data-status-last-result>${escapeHtml(lastResult)}</dd></div>
          <div><dt>Väntar lokalt</dt><dd data-status-pending-ops>${escapeHtml(pendingOps)}</dd></div>
          <div><dt>Den här enheten</dt><dd data-status-device>${escapeHtml(device)}</dd></div>
          <div><dt>Dropbox-anslutning</dt><dd data-status-dropbox-session>${escapeHtml(dropboxSession)}</dd></div>
        </dl>
        <div class="status-actions"><button class="primary-button full-button" type="button" data-action="connect-dropbox" data-sync-label="status">${escapeHtml(syncButton)}</button>${status.dropboxCredentialStored || status.dropboxAuthorized ? '<button class="text-button" type="button" data-action="disconnect-dropbox">Koppla från Dropbox på denna enhet</button>' : ''}</div>
        <p class="status-detail" data-sync-detail>${escapeHtml(status.syncDetail || 'Dropbox-status läses in…')}</p>
      </section>
      <section class="card status-card" aria-labelledby="app-status-title">
        <div class="status-card-heading"><div><p class="eyebrow">Funktionalitet</p><h2 id="app-status-title">Appversion</h2></div><span class="status-badge" data-app-update-summary>${escapeHtml(status.appUpdateLabel || 'Kontrollerar…')}</span></div>
        <dl class="status-facts">
          <div><dt>Aktiv version</dt><dd><code data-app-version>${escapeHtml(status.appVersion || 'okänd')}</code></dd></div>
          <div><dt>Uppdatering</dt><dd data-app-update-detail>${escapeHtml(status.appUpdateDetail || 'Söker efter en ny version…')}</dd></div>
        </dl>
        <button class="secondary-button full-button" type="button" data-action="check-app-update">Sök efter uppdatering</button>
        <p class="status-detail">När en ny version hittas hämtas den och appen laddas om. Dina privata data ligger kvar i det separata lokala datalagret.</p>
      </section>
    </div>
    ${deletedTrips.length ? `<section class="card status-explainer deleted-trips"><div><p class="eyebrow">Återställbart</p><h2>Nyligen raderade resor</h2><p>De här resorna är synkade som raderade och visas därför inte i Resor. Återställning lägger tillbaka resan och de rader som fanns när den togs bort.</p></div><div class="library-list">${deletedTrips.map(trip => `<article><div><b>${escapeHtml(trip.name)}</b><small>${escapeHtml(trip.createdAt || '')}</small></div><button class="secondary-button" type="button" data-action="restore-deleted-trip" data-trip-id="${escapeHtml(trip.id)}">Återställ</button></article>`).join('')}</div></section>` : ''}
    <section class="card status-explainer"><h2>Vad är vad?</h2><div><p><b>Datasynk</b> jämför resor, artiklar och ändringar med din privata Dropbox App Folder.</p><p><b>Appuppdatering</b> hämtar ny funktionalitet från Packas publika appskal och innehåller aldrig dina packlistor.</p></div></section>`;
}

export function renderView(view, { core = null, ui = {}, error = '', status = {} } = {}) {
  if (!core) return `${dataBoundary(core)}${shellCard('Packa startar', 'Det lokala operationslagret förbereds.')}`;
  if (view === 'resor') return renderResor(core, ui, error);
  if (view === 'planera') return renderPlanera(core, ui, error);
  if (view === 'packa') return renderPacka(core, ui, error);
  if (view === 'matris') return renderMatrix(core, ui, error);
  if (view === 'master') return renderMaster(core, ui, error);
  if (view === 'vanor') return renderVanor(core, ui);
  if (view === 'bibliotek') return renderBibliotek(core, ui, error);
  if (view === 'data') return renderData(core, ui, error);
  if (view === 'status') return renderStatus(core, status, error);
  return shellCard('Vyn saknas', 'Gå tillbaka till Resor.');
}
