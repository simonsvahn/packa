export const VIEW_ORDER = ['resor', 'planera', 'packa', 'matris', 'master'];

export const VIEW_META = Object.freeze({
  resor: { title: 'Resor', kicker: 'Översikt' },
  planera: { title: 'Planera', kicker: 'Resa · vad ska med?' },
  packa: { title: 'Packa', kicker: 'Resa · ta fram och packa' },
  matris: { title: 'Matris', kicker: 'Mac · kurering' },
  master: { title: 'Master', kicker: 'Artiklar · kurering' }
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

const dataBoundary = core => core?.real ? `
  <div class="demo-boundary real-boundary" role="status">
    <span aria-hidden="true">✓</span>
    <div><b>Privat data ansluten</b> Resorna ligger lokalt på enheten och synkas bara genom Packas privata Dropbox App Folder. Ingen personlig data ingår i den publika appkoden.</div>
  </div>` : `
  <div class="demo-boundary" role="note">
    <span aria-hidden="true">◇</span>
    <div><b>Säker testyta</b> Allt du gör här sparas som syntetiska demo-operationer i en separat lokal databas. Originalmastern och Dropbox-testets databas berörs inte.</div>
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
  const preview = core.catalog.filter(item => item.templates.some(template => selected.has(template)));
  return `
    <section class="card new-trip-card" aria-labelledby="new-trip-title">
      <div class="section-heading">
        <div><p class="eyebrow">${core.real ? 'Privat resa' : 'Syntetisk resa'}</p><h3 id="new-trip-title">Ny resa</h3></div>
        <button class="quiet-button" type="button" data-action="close-new-trip">Stäng</button>
      </div>
      <form class="new-trip-form" data-form="new-trip">
        <label>Resans namn <input name="name" required maxlength="80" placeholder="Till exempel Köpenhamn"></label>
        <label>Destination <input name="destination" maxlength="80" placeholder="Valfritt"></label>
        <fieldset>
          <legend>Mallar</legend>
          <div class="chip-row">
            ${core.templates.map(template => `<button type="button" class="filter-chip${selected.has(template) ? ' active' : ''}" aria-pressed="${selected.has(template)}" data-action="toggle-new-template" data-template="${escapeHtml(template)}">${escapeHtml(template)}</button>`).join('')}
          </div>
        </fieldset>
        <div class="preview-count"><b>${preview.length} artiklar förbockas</b><span>Unionen av valda mallar · antal börjar på 1</span></div>
        <button class="primary-button fit-button" type="submit">${core.real ? 'Skapa resa' : 'Skapa testresa'}</button>
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
  return `
    <section class="card history-detail" aria-labelledby="history-title">
      <div class="section-heading">
        <div><p class="eyebrow">Läsläge · ${escapeHtml(statusLabel(trip.status))}</p><h2 id="history-title">${escapeHtml(trip.name)}</h2><p>${escapeHtml(trip.destination || 'Ingen destination')} · ${escapeHtml(trip.startDate || trip.year || '')}</p></div>
        <button class="quiet-button" type="button" data-action="close-history">Stäng</button>
      </div>
      <div class="history-summary"><span><b>${trip.items.length}</b> rader</span><span><b>${progress.taken}</b> framtagna</span><span><b>${progress.packed}</b> packade</span></div>
      <div class="history-rows">
        ${trip.items.map(item => `<article class="history-row"><div><b>${escapeHtml(item.nameSnapshot)}</b><small>${escapeHtml(item.person || item.category || '')}</small></div><span>${escapeHtml(item.quantity)}</span><span class="history-state${item.taken ? ' done' : ''}">${item.taken ? '✓' : '–'} Framme</span><span class="history-state${item.packed ? ' done' : ''}">${item.packed ? '✓' : '–'} Packat</span>${item.bag || item.location ? `<small>${escapeHtml([item.bag, item.location].filter(Boolean).join(' · '))}</small>` : '<small></small>'}</article>`).join('')}
      </div>
      <div class="history-actions"><button class="secondary-button" type="button" data-action="copy-trip" data-trip-id="${escapeHtml(trip.id)}">Utgå från denna resa</button></div>
    </section>`;
}

function renderResor(core, ui, error) {
  const activeTrips = core.trips.filter(trip => !['complete', 'archived'].includes(trip.status));
  const archivedTrips = core.trips.filter(trip => trip.status === 'archived');
  const totalRows = core.trips.reduce((sum, trip) => sum + trip.items.length, 0);
  const real = core.real;
  return `
    <section class="hero compact-hero">
      <div>
        <p class="eyebrow">${real ? 'Din packhistorik' : 'Etapp 4 · första säkra delen'}</p>
        <h2>${real ? `${core.trips.length} resor finns nu i Packa.` : 'Nu går det att prova Resor → Planera → Packa.'}</h2>
        <p>${real ? 'Den pågående resan ligger överst. Arkiverade resor öppnas i skrivskyddat läsläge och kan användas som grund för en ny resa.' : 'Din riktiga data är fortfarande orörd. Testresorna använder samma lokala operationslager som den framtida appen, men ligger i en helt egen databas.'}</p>
      </div>
      <button class="primary-button fit-button hero-action" type="button" data-action="open-new-trip">+ ${real ? 'Ny resa' : 'Ny testresa'}</button>
    </section>
    ${dataBoundary(core)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderNewTrip(core, ui)}
    ${renderHistoryDetail(core, ui)}
    <div class="grid core-metrics">
      <section class="card span-4"><div class="metric">${core.trips.length}</div><div class="metric-label">${real ? 'befintliga resor' : 'testresor'}</div></section>
      <section class="card span-4"><div class="metric">${activeTrips.length}</div><div class="metric-label">${real ? 'pågående resor' : 'aktiva testresor'}</div></section>
      <section class="card span-4"><div class="metric">${real ? archivedTrips.length : totalRows}</div><div class="metric-label">${real ? 'arkiverade resor' : 'syntetiska resrader'}</div></section>
    </div>
    <div class="resor-layout">
      <section class="trip-list" aria-labelledby="active-trips-title">
        <div class="section-heading"><div><p class="eyebrow">Arbetsyta</p><h2 id="active-trips-title">${real ? 'Alla resor' : 'Testresor'}</h2></div></div>
        ${core.trips.map(trip => renderTripCard(trip, core)).join('') || '<p>Inga resor ännu.</p>'}
      </section>
      <aside class="card safety-card">
        <h3>${real ? 'Privat och återställbart' : 'Datagränsen är kvar'}</h3>
        <ul class="check-list">
          ${real ? `<li>${core.catalog.length} aktiva artiklar finns lokalt</li><li>${totalRows} historiska resrader är inlästa</li><li>Arkiverade resor är skrivskyddade</li><li>V1 och v2 finns kvar som fallback</li>` : '<li>Testkatalog med nio påhittade artiklar</li><li>Egen lokal databas för kärnflödet</li><li>Ingen import av packlista-data.json</li><li>Ingen uppladdning av testresor till Dropbox</li>'}
        </ul>
        <div class="sync-test">
          <button class="secondary-button full-button" type="button" data-action="connect-dropbox">Anslut Dropbox</button>
          <p class="sync-detail" data-sync-detail>Anslut Dropbox för att hämta eller synka resor.</p>
        </div>
      </aside>
    </div>`;
}

function currentFilter(ui) {
  return ui.filters || { search: '', activities: new Set(), functions: new Set() };
}

function renderFilterRow(core, ui) {
  const filter = currentFilter(ui);
  const activities = [...new Set(core.catalog.map(item => item.activity))].sort((a, b) => a.localeCompare(b, 'sv'));
  const functions = [...new Set(core.catalog.map(item => item.function))].sort((a, b) => a.localeCompare(b, 'sv'));
  const chip = (kind, value, active) => `<button type="button" class="filter-chip${active ? ' active' : ''}" aria-pressed="${active}" data-action="toggle-filter" data-filter-kind="${kind}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
  return `
    <section class="filter-panel" aria-label="Visningsfilter">
      <form class="search-form" data-form="filter-search">
        <label><span>Sök</span><input type="search" name="search" value="${escapeHtml(filter.search)}" placeholder="Sök artikel"></label>
        <button class="secondary-button" type="submit">Visa</button>
      </form>
      <div class="filter-group"><b>Aktivitet <small>ELLER</small></b><div class="chip-row">${activities.map(value => chip('activity', value, filter.activities.has(value))).join('')}</div></div>
      <div class="filter-group"><b>Funktion <small>ELLER</small></b><div class="chip-row">${functions.map(value => chip('function', value, filter.functions.has(value))).join('')}</div></div>
      <button class="text-button" type="button" data-action="clear-filters">Rensa filter</button>
    </section>`;
}

function matchesFilter(item, filter) {
  const search = filter.search.trim().toLocaleLowerCase('sv');
  const haystack = `${item.name || item.nameSnapshot || ''} ${item.brand || ''} ${item.model || ''}`.toLocaleLowerCase('sv');
  if (search && !haystack.includes(search)) return false;
  if (filter.activities.size && !filter.activities.has(item.activity)) return false;
  if (filter.functions.size && !filter.functions.has(item.function)) return false;
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

function renderPlanGroup(title, items, rowsByCatalog, trip) {
  const selectedCount = items.filter(item => rowsByCatalog.has(item.id)).length;
  return `
    <details class="item-group" open>
      <summary><span>${escapeHtml(title)}</span><small>${selectedCount}/${items.length} med</small></summary>
      <div class="group-rows">${items.map(item => renderPlanCatalogRow(item, rowsByCatalog.get(item.id) || [], trip)).join('')}</div>
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
  return `
    <section class="hero workspace-hero">
      <div><p class="eyebrow">${core.real ? 'Privat resa' : 'Syntetisk resa'} · ${escapeHtml(statusLabel(trip.status))}</p><h2>${escapeHtml(trip.name)}</h2><p>Bestäm vad som ska med. Funktion visas som underrubrik; mallchipsen är bara etiketter.</p></div>
      <div class="hero-actions"><span class="hero-badge">${trip.items.length} rader · ${totalSelected} st</span><button class="primary-button fit-button" type="button" data-action="start-packing">Börja packa</button></div>
    </section>
    ${dataBoundary(core)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderFilterRow(core, ui)}
    <div class="list-toolbar"><div><b>Resans lins</b><span>${visibleMatching.length} synliga av ${matching.length}</span></div><button class="secondary-button" type="button" data-action="open-custom-row">+ Egen rad</button></div>
    ${renderCustomForm(ui)}
    <section class="plan-list" aria-label="Artiklar i resans lins">
      ${groupBy(visibleMatching, 'category').map(([title, items]) => renderPlanGroup(title, items, rowsByCatalog, trip)).join('')}
      ${customRows.length ? `<details class="item-group" open><summary><span>Eget</span><small>${customRows.length}/${customRows.length} med</small></summary><div class="group-rows">${customRows.map(renderCustomPlanRow).join('')}</div></details>` : ''}
      ${!visibleMatching.length && !customRows.length ? '<div class="empty-state">Inga artiklar matchar filtren.</div>' : ''}
    </section>
    <details class="other-master">
      <summary>Allt annat i ${core.real ? 'mastern' : 'testmastern'} (${visibleRest.length})</summary>
      <div class="plan-list">${groupBy(visibleRest, 'category').map(([title, items]) => renderPlanGroup(title, items, rowsByCatalog, trip)).join('') || '<div class="empty-state">Inget mer matchar filtren.</div>'}</div>
    </details>`;
}

function renderPackRow(item, tripItems, bags, showBags) {
  const siblings = tripItems.filter(row => row.mergeKey === item.mergeKey);
  return `
    <article class="pack-row${item.packed ? ' is-packed' : ''}">
      <div class="pack-item-copy">
        <h3>${escapeHtml(item.nameSnapshot)}</h3>
        <p>${escapeHtml(item.function)}${item.custom ? ' · egen rad' : ''}</p>
        <div class="row-tools">
          ${item.quantity > 1 ? `<button class="chip-button" type="button" data-action="split-item" data-item-id="${escapeHtml(item.id)}">Dela 1</button>` : ''}
          ${siblings.length > 1 ? `<button class="chip-button" type="button" data-action="merge-items" data-merge-key="${escapeHtml(item.mergeKey)}">Slå ihop</button>` : ''}
        </div>
      </div>
      <div class="pack-quantity"><span>Antal</span>${renderStepper(item.id, item.quantity, 'packa')}</div>
      <button class="state-button${item.taken ? ' active' : ''}" type="button" aria-pressed="${item.taken}" data-action="toggle-taken" data-item-id="${escapeHtml(item.id)}"><span aria-hidden="true">${item.taken ? '✓' : '○'}</span>Framme</button>
      <button class="state-button${item.packed ? ' active' : ''}" type="button" aria-pressed="${item.packed}" data-action="toggle-packed" data-item-id="${escapeHtml(item.id)}"><span aria-hidden="true">${item.packed ? '✓' : '○'}</span>Packat</button>
      ${showBags ? `<div class="bag-fields">
        <label>Väska<select data-action="set-bag" data-item-id="${escapeHtml(item.id)}"><option value="">Utan väska</option>${bags.map(bag => `<option value="${escapeHtml(bag)}"${item.bag === bag ? ' selected' : ''}>${escapeHtml(bag)}</option>`).join('')}</select></label>
        <label>I väskan<input value="${escapeHtml(item.location)}" data-action="set-location" data-item-id="${escapeHtml(item.id)}" list="bag-locations" placeholder="Fack eller påse"></label>
      </div>` : ''}
    </article>`;
}

function renderPacka(core, ui, error) {
  const trip = core.activeTrip;
  if (!trip) return `${dataBoundary(core)}${shellCard('Ingen pågående resa vald', 'Skapa eller öppna en pågående resa från Resor först.')}`;
  const filter = currentFilter(ui);
  const total = trip.items.length;
  const taken = trip.items.filter(item => item.taken).length;
  const packed = trip.items.filter(item => item.packed).length;
  const percent = total ? Math.round((packed / total) * 100) : 0;
  const visible = trip.items.filter(item => matchesFilter(item, filter))
    .filter(item => !ui.hidePacked || !item.packed)
    .filter(item => !ui.hideTaken || !item.taken);
  return `
    <section class="pack-progress" aria-label="Packprogress">
      <div><p class="eyebrow">${escapeHtml(trip.name)} · ${escapeHtml((trip.persons || []).join(' + ') || 'Resa')}</p><h2>${packed} av ${total} rader packade</h2><p>${taken} framtagna · progress räknar alltid alla rader</p></div>
      <div class="progress-ring" style="--progress:${percent * 3.6}deg"><b>${percent}%</b></div>
    </section>
    ${dataBoundary(core)}
    ${error ? `<div class="error-notice" role="alert">${escapeHtml(error)}</div>` : ''}
    ${renderFilterRow(core, ui)}
    <section class="pack-toolbar" aria-label="Visningsinställningar">
      <button class="filter-chip${ui.showBags ? ' active' : ''}" type="button" aria-pressed="${ui.showBags}" data-action="toggle-pack-view" data-pack-key="showBags">Väskor</button>
      <button class="filter-chip${ui.hidePacked ? ' active' : ''}" type="button" aria-pressed="${ui.hidePacked}" data-action="toggle-pack-view" data-pack-key="hidePacked">Dölj packade <span>${packed}</span></button>
      <button class="filter-chip${ui.hideTaken ? ' active' : ''}" type="button" aria-pressed="${ui.hideTaken}" data-action="toggle-pack-view" data-pack-key="hideTaken">Dölj framtagna <span>${taken}</span></button>
      <span class="toolbar-count">${visible.length} visas · ${total} räknas</span>
      <button class="secondary-button" type="button" data-action="open-custom-row">+ Egen rad</button>
    </section>
    ${renderCustomForm(ui)}
    <datalist id="bag-locations">${[...(core.pouches || []), 'Topplock', 'Innerfack', 'Klädpåse', 'Teknikpåse'].map(value => `<option value="${escapeHtml(value)}">`).join('')}</datalist>
    <section class="pack-list" aria-label="Packrader">
      ${groupBy(visible, 'category').map(([title, items]) => `<section class="pack-group"><div class="pack-group-heading"><h2>${escapeHtml(title)}</h2><span>${items.filter(item => item.packed).length}/${items.length}</span></div>${items.map(item => renderPackRow(item, trip.items, core.bags, ui.showBags)).join('')}</section>`).join('') || '<div class="empty-state">Inga rader matchar visningen. Progressen ovan räknar fortfarande hela resan.</div>'}
    </section>
    <div class="finish-bar"><span><b>${packed}/${total} packade</b><small>${core.real ? 'Ändringar sparas lokalt först.' : 'Detta är fortfarande en testresa.'}</small></span><button class="primary-button fit-button" type="button" data-action="finish-trip"${packed < total ? ' disabled' : ''}>Avsluta ${core.real ? 'resa' : 'testresa'}</button></div>`;
}

export function renderView(view, { core = null, ui = {}, error = '' } = {}) {
  if (!core) return `${dataBoundary(core)}${shellCard('Packa startar', 'Det lokala operationslagret förbereds.')}`;
  if (view === 'resor') return renderResor(core, ui, error);
  if (view === 'planera') return renderPlanera(core, ui, error);
  if (view === 'packa') return renderPacka(core, ui, error);

  const copy = {
    matris: ['Matris kommer i nästa del', 'Kärnflödena Resor, Planera och Packa byggs och verifieras först. Matrisen kommer därefter som en egen Mac-yta.'],
    master: ['Masterytan kommer i nästa del', core.real ? `${core.catalog.length} aktiva artiklar är redan säkert inlästa, men redigeringsytan byggs och verifieras separat.` : 'Testkatalogen är medvetet liten och syntetisk. Den riktiga artikelmastern aktiveras först efter en separat migreringsgrind.']
  }[view];
  return `
    <section class="hero"><div><p class="eyebrow">Nästa etapp</p><h2>${copy[0]}</h2><p>${copy[1]}</p></div><span class="hero-badge">${core.real ? 'Privat data ansluten' : 'Skarp data avstängd'}</span></section>
    ${dataBoundary(core)}
    <div style="height:16px"></div>
    ${shellCard(copy[0], copy[1])}`;
}
