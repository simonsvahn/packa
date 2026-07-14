export const VIEW_ORDER = ['resor', 'planera', 'packa', 'matris', 'master'];

export const VIEW_META = Object.freeze({
  resor: { title: 'Resor', kicker: 'Översikt' },
  planera: { title: 'Planera', kicker: 'Resa · arbetsyta' },
  packa: { title: 'Packa', kicker: 'Resa · arbetsyta' },
  matris: { title: 'Matris', kicker: 'Mac · kurering' },
  master: { title: 'Master', kicker: 'Artiklar · kurering' }
});

export function normalizeView(value) {
  const view = String(value || '').replace(/^#/, '').toLowerCase();
  return VIEW_ORDER.includes(view) ? view : 'resor';
}

const shellCard = (title, text) => `
  <section class="placeholder" aria-labelledby="placeholder-title">
    <div>
      <strong id="placeholder-title">${title}</strong>
      <p>${text}</p>
    </div>
  </section>`;

export function renderView(view) {
  if (view === 'resor') return `
    <section class="hero">
      <div>
        <p class="eyebrow">Packa</p>
        <h2>HTTPS och Dropbox-synken fungerar. Din riktiga data är fortfarande orörd.</h2>
        <p>App Folder, säker inloggning och synk från två lokala webborigins samt den publicerade GitHub Pages-adressen är verifierade mot Dropbox-kontot. Nästa kontroll är den installerade appen på iPhone och Mac.</p>
      </div>
      <span class="hero-badge">Dropbox live · HTTPS</span>
    </section>
    <div class="grid">
      <section class="card span-4"><div class="metric">0</div><div class="metric-label">skarpa dataändringar</div></section>
      <section class="card span-4"><div class="metric">3</div><div class="metric-label">separata webborigins</div></section>
      <section class="card span-4"><div class="metric">124</div><div class="metric-label">automatiska prov</div></section>
      <section class="card span-8">
        <h3>Verifieringen hittills</h3>
        <ol class="steps">
          <li><b>Lokal först</b><br>Ändringar sparas före nätverk och kan alltid köras om säkert.</li>
          <li><b>Tre instanser</b><br>Två lokala och en publicerad HTTPS-origin synkar genom samma Dropbox-mapp med separata IndexedDB- och OAuth-miljöer.</li>
          <li><b>Dropbox</b><br>App Folder, PKCE, cursor, longpoll, 401 och rate-limit har kontraktstestats.</li>
          <li><b>Återhämtning</b><br>Snapshot, läsbart arkiv och manifest-sist ger säker ny enhet.</li>
        </ol>
      </section>
      <aside class="card span-4">
        <h3>Kvar innan skarp funktion</h3>
        <ul class="shell-list">
          <li>Skarp historikimport <span>övergången</span></li>
          <li>Installerad iPhone–Mac <span>återstår</span></li>
          <li>Skarpt gränssnitt <span>nästa byggsteg</span></li>
        </ul>
        <div class="sync-test">
          <button class="primary-button" type="button" data-action="connect-dropbox">Anslut Dropbox och kör test</button>
          <p class="sync-detail" data-sync-detail>Ingen skarp data är ansluten.</p>
        </div>
      </aside>
    </div>`;

  const copy = {
    planera: ['Planera är förberedd', 'Kategori och aktivitet med funktion som underrubrik kopplas in efter att datalagret och synken har verifierats.'],
    packa: ['Packa är förberedd', 'Framtaget, packat, antal, väskor och delrader byggs mot den nya ändringsloggen i nästa steg.'],
    matris: ['Matris är förberedd', 'Mac-ytan för kategori, aktivitet och funktion byggs i nästa steg och får aldrig slå ihop dubbletter automatiskt.'],
    master: ['Master är förberedd', 'Artikelkurering, arkivfilter och dubblettflaggor kopplas in efter verifierad migrering.']
  }[view];

  return `
    <section class="hero">
      <div>
        <p class="eyebrow">Informationsarkitektur</p>
        <h2>${copy[0]}</h2>
        <p>${copy[1]}</p>
      </div>
      <span class="hero-badge">Skalvy</span>
    </section>
    <div class="notice" role="note"><div aria-hidden="true">!</div><div><b>Ingen skarp funktion ännu</b>Den här vyn testar navigering och layout. Den läser inte masterdata.</div></div>
    <div style="height:16px"></div>
    ${shellCard(copy[0], copy[1])}`;
}
