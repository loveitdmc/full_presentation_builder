# Changelog — Love IT DMC Presenta

App: https://full-presentation-builder.vercel.app
Airtable base: `app17rv8UlvfpaANc` (LoveIT Fornitori)

> Regola d'oro imparata sul campo: quando si richiedono campi Airtable per **field ID**,
> aggiungere sempre `returnFieldsByFieldId=true` all'URL, altrimenti la risposta usa i nomi.
> Regola 2: mai creare nuovi file in `api/` — Vercel a volte non li rileva (404).
> Estendere sempre gli endpoint esistenti con query param o campi nel body.

## v51 — 2026-08-06
- **Didascalie galleria editabili e cancellabili in edit mode.**
  - Le didascalie erano già in `TEXT_SEL` ma NON cliccabili: l'edit-zone della
    cella (z-index 50) le copriva. Fix CSS: in edit mode la caption sale a
    z-index 55 con `pointer-events:auto` → click sulla didascalia = modifichi
    il testo, click sul resto della foto = picker foto.
  - Nuovo pulsante **×** su ogni didascalia (la rimuove) e pulsante
    **"× Didascalie"** in alto a destra sulle slide galleria (le rimuove
    tutte). Aggiunti dinamicamente all'ingresso in edit mode — funzionano
    anche su presentazioni salvate — e rimossi da snapshot Undo, salvataggio
    HTML, stampa PDF e all'uscita dall'edit mode. Rimozione tracciata da
    Undo (`.gallery-cell-caption` nei nodi tracciati).
  - Verifica jsdom: editabilità, del singola, clear slide, cleanup
    uscita/rientro edit mode.
- Nota: le didascalie AI (v49/v50) restano attive lato backend; se in
  produzione non compaiono, il log Vercel ora mostra `aiCaptionPhotos
  failed: …` con il motivo.

## v50 — 2026-08-06
- **Fix didascalie AI (v49 non funzionava in produzione).** La chiamata vision
  usava una fetch manuale con header `anthropic-version: 2023-06-01`, che non
  supporta le immagini via URL → l'API rifiutava e il catch silenzioso
  lasciava i filename. Riscritta `aiCaptionPhotos` con l'SDK `@anthropic-ai/sdk`
  (stesso metodo di `generateWithAI`, che già funziona) + `console.warn`
  sull'errore invece del silenzio. Verificato con SDK reale e fetch mockata:
  3 foto tecniche → didascalie AI nelle posizioni giuste, nome descrittivo
  intatto.
- **Rete di sicurezza lato template:** `_cleanPhotoName`/`_photoCaption` ora
  riconoscono anche "nome venue (N)" come nome tecnico (usando il fornitore
  della slide come contesto): se il backend non produce la didascalia AI, la
  galleria mostra "Foto N" invece del filename. Verificato in jsdom.

## v49 — 2026-08-06
- **Didascalie AI descrittive nelle gallerie.** Quando il nome di una foto è
  "tecnico" — filename tipo "Palazzo Caracciolo (10)", IMG_1234, vuoto, o il
  solo nome del fornitore ± numeri — il backend chiede a Claude Haiku
  (vision, `claude-haiku-4-5`) una didascalia breve in italiano guardando la
  foto ("Cortile interno illuminato", "Camera doppia superior"…). I nomi già
  descrittivi (Asset Name curati nei Media, filename parlanti) NON vengono
  toccati; max 10 foto per chiamata, timeout 25s, in caso di errore restano i
  nomi originali.
  - Nuova `aiCaptionPhotos()` esportata da `supplier.js`, agganciata in:
    scheda fornitore (`generateSupplierFullPage`), picker/insert fornitore
    (`handleSupplierSlide`), scheda artista (`generateActFullPage`) e
    attività (`handleActivity`).
  - Verificato con test mockato: solo le 3 foto tecniche su 4 vengono mandate
    all'AI, le didascalie tornano nelle posizioni giuste, il filename
    descrittivo resta intatto. Non-regressione su ricerca v48 e fallback
    Media v47.

## v48 — 2026-08-06
- **Fix vero per "grand hotel oriente senza foto": era la RICERCA, non le
  foto.** Verificato via Airtable MCP: il record "Grand Hotel Oriente Napoli"
  ha 22 foto nel campo `Photos` e il codice le legge correttamente (riprodotto
  in locale con i dati reali del record). Il problema: le ricerche keyword
  usavano `OR(SEARCH(parola…))` con `maxRecords=8` — con parole comuni come
  "hotel" e "grand" i primi 8 record IN ORDINE DI TABELLA saturavano il
  limite e il record giusto (riga ~56) restava fuori → si finiva sul fallback
  AI, che genera la scheda senza foto Airtable.
- Fix in tutte le ricerche keyword: prima una query **AND** (tutte le parole
  devono comparire nel nome — "grand hotel oriente" matcha solo il GHO), e
  solo se vuota fallback all'OR con `maxRecords=50` + ranking per numero di
  parole matchate (slice 8). Toccate: `acts.js` (findActCandidates,
  findSupplierCandidates, findActivityCandidates), `supplier.js`
  (findSupplierForSpaces, findSuppliers), `generate-text.js` (findSuppliers,
  findByNameField).
- Test con simulazione realistica (60 fornitori, decine contenenti
  "hotel"/"grand", GHO in posizione 56): la ricerca "grand hotel oriente" ora
  genera direttamente la scheda giusta con le foto reali. Non-regressione su
  picker JSON e fallback Media (v47) verificata.

## v47 — 2026-08-06
- **Fix: fornitori senza foto (es. "Grand Hotel Oriente").** Le foto dei
  fornitori venivano lette SOLO dal campo `Photos` (allegati diretti); molti
  record — tipicamente gli hotel — hanno invece le foto come record collegati
  nella tabella **Media**, che veniva usata solo per le planimetrie. Aggiunto
  il fallback in TUTTI i percorsi: se `Photos` è vuoto, le foto si prendono
  dai Media collegati (escludendo planimetrie, video e pdf), con i nomi
  (Asset Name/Description/filename) per le didascalie automatiche.
  - `acts.js` (ricerca database + picker foto), `supplier.js` (scheda
    fornitore full-page), `generate.js` (enrichment da PDF),
    `generate-text.js` (enrichment da testo).
  - Verificato con test end-to-end a fetch mockata: supplier con Photos vuoto
    e 3 Media (foto, planimetria, foto+video) → 2 foto in galleria con nomi
    corretti, planimetria solo tra i floorplans, video escluso.

## v46 — 2026-08-06
- **Scelta del template a inizio presentazione.** Nella home (tab preventivo,
  sia PDF che testo) c'è ora il selettore "Template della presentazione" con 3
  card: **Dark Journey** (attuale, default), **Venue Options** e **Hotel
  Proposal** (crema/oro, fedeli ai pptx). La scelta viaggia come `deckTemplate`
  nel body verso `/api/generate` e `/api/generate-text` (whitelist
  dark/venues/hotel) e viene iniettata nel TRIP; l'app poi POPOLA i fornitori
  seguendo la struttura del template scelto:
  - **Venue Options** (da 05): cover → tabella "Venues — At a Glance"
    auto-popolata (una riga per fornitore, badge stato TBC cliccabile per
    ciclare Confirmed/TBC/New) → per ogni venue: spread foto+info → hero
    full-page → galleria con didascalie.
  - **Hotel Proposal** (da 04): cover → tabella tariffe auto-popolata (hotel,
    categoria, camera, "da € — / notte" editabile) → per ogni hotel: spread
    scheda → galleria (che include anche la seconda foto, niente hero).
  - Le righe tabella riusano le classi v45 (`.data-table`, `.dt-cell`, badge):
    editabili, aggiungibili e rimovibili in edit mode.
- **Tema crema/oro** (`body.deck-venues`/`.deck-hotel`): le slide "di carta"
  (tabelle, spread, gallerie a card) passano a fondo #F7F4EF con testo #2B323A
  e oro scurito #a8854f per gli eyebrow, come nei template originali; le slide
  con foto full-bleed restano scure con testo bianco (come nei pptx). Il tema
  è una classe sul body, persiste nel salvataggio; le presentazioni salvate
  senza `deckTemplate` restano dark.
- Slide video/planimetrie invariate in tutti i deck. Verifica jsdom su
  entrambi i deck: classe body, sequenza sezioni, righe tabella auto-popolate,
  badge, spread con foto, hero solo per venues, didascalie galleria.
- L'inserimento manuale dal database e i layout del pannello "+ Aggiungi
  slide" restano disponibili in tutti i template.

## v45 — 2026-08-06
- **5 nuovi layout slide adattati dai template pptx LoveIT** (zip caricato
  dall'utente: corporate, elegant editorial, hotel proposal, venue options),
  nuovo gruppo "Template LoveIT" nel pannello "+ Aggiungi slide". Tutti in
  tema scuro/oro coerente con l'editor, con coral #FF5149 come accento badge:
  - **Tabella Hotel** (da 04): "Hotels — At a Glance" con colonne
    Hotel/Categoria/Camera/Tariffa/Note; righe editabili, + Aggiungi riga e ×
    per riga (minimo 1).
  - **Tabella Venue** (da 05): colonne Venue/Zona/Capacità/Note/Status con
    badge colorato Confirmed (verde) / TBC (oro) / New (coral) — in edit mode
    un click sul badge cicla lo stato (tracciato da Undo via `data-status`).
  - **Card Prezzi** (da 01 "Investment"): 3 card "da € — / a persona + IVA"
    con badge Consigliata (stessa meccanica ★ esclusiva delle opt-card),
    aggiungi fino a 4, rimuovi con riassegnazione della consigliata.
  - **Timeline** (da 01 "Route"): step numerati in cerchi oro con titolo e
    testo; +/× con rinumerazione automatica.
  - **Menu** (da 02): spread foto-sinistra (placeholder + picker foto come le
    slide split) / menu-destra con portata, piatti +/- e riga prezzo.
  - Note tecniche: estesi `TEXT_SEL` (`.dt-cell`, `.pc-*`, `.tl-title/.tl-text`,
    `.menu-*`), `_isTrackedNode` (`.price-card`, `.tl-item`, `.menu-item`) e
    l'`attributeFilter` (`data-status`) per Undo/dirty-check. Verifica jsdom
    completa: pannello, add/del righe-card-step, ciclo badge, riassegnazione
    consigliata, rinumerazione timeline, picker foto del menu.
- Prossimo passo concordato: **export PPTX reale** ("Scarica PPTX") usando i
  generatori pptxgenjs dei template come motore — non ancora implementato.

## v44 — 2026-07-26
- **Confronto Opzioni: foto adattate allo spazio.** `.opt-card-photo` ora usa
  `background-size:contain` (con sfondo scuro) invece di `cover`: la foto è
  sempre interamente visibile nel riquadro, senza tagli.
- **Auto-compilazione card dal database.** Scegliendo un fornitore dal
  "Scegli dal database" su una card del Confronto Opzioni, oltre alla foto
  vengono compilati automaticamente "Nome venue" (nome del fornitore) e
  "Perché questa opzione" (descrizione Airtable accorciata a ~220 caratteri,
  troncata a fine frase). I campi già modificati a mano NON vengono
  sovrascritti (si riempiono solo se contengono ancora il testo placeholder).
  Verificato in jsdom (flusso completo picker → foto+testi; nome custom
  preservato).

## v43 — 2026-07-26
- **Galleria in stile "Villa Miani"** (screenshot fornito dall'utente): la slide
  galleria è ora una griglia a card con margini su sfondo scuro, header in alto
  (eyebrow = fornitore, headline = titolo, entrambi editabili) e didascalia su
  barra scura in basso a ogni foto. Nuova classe `.gallery-cards` + `gc-cols-1/2/3`
  (colonne in base al numero di foto); le vecchie gallerie full-bleed nei file
  salvati restano com'erano.
- **Didascalie automatiche dai nomi foto in Airtable.** Il backend ora restituisce
  nome per ogni foto (`photosMeta`/`allPhotosMeta`: Asset Name/Description del
  record Media, o filename dell'allegato) in acts.js, supplier.js, generate.js e
  generate-text.js. Il template pulisce il nome (via estensione/underscore,
  maiuscola iniziale) e lo usa come didascalia; i nomi "tecnici" (IMG_1234,
  DSC…) ricadono su "Foto N". Quando si sostituisce una foto dal picker, la
  didascalia della cella si aggiorna da sola.
- **Fix "Scegli una foto" nel Confronto Opzioni** — i click non arrivavano al
  placeholder perché dentro `.content-dark` (pointer-events:none in edit mode);
  aggiunta l'eccezione CSS per `.opt-card-photo`.
- **Nuovo "Scegli dal database" nel photo picker** (ovunque, non solo opt-card):
  in fondo al picker foto c'è ora un pulsante che apre la navigazione del
  database per categoria (Venue / Ristoranti / Hotel / Artisti / Attività, via
  `/api/acts-list`), con filtro per nome; scelto il fornitore ne mostra le foto
  (via `/api/acts` `format:'json'`) e un click applica la foto al riquadro.
- **Focal point sulle foto full-page** («foto troppo croppate»): in edit mode
  ogni slide full-bleed ha il pulsante "✥ Inquadra" in alto a destra; si apre
  un overlay e si trascina la foto per riposizionare l'inquadratura
  (`background-position` in %, clampato 0-100). Il valore è salvato inline,
  quindi persiste nel salvataggio; il tracking Undo/dirty era già attivo per le
  mutazioni `style` su `.bg`. Pulsanti/overlay rimossi da snapshot undo,
  salvataggio HTML, stampa PDF e all'uscita dall'edit mode.
- Verifica jsdom end-to-end: galleria generata con didascalie corrette (mock a
  8 foto con nomi misti), inserimento fornitore, picker database completo
  (tab → fornitore → foto → applicazione su opt-card), focal drag e cleanup.

## v42 — 2026-07-26
- **Fix: il nuovo layout "2 slide full-page + galleria con didascalie" ora si
  applica anche alle presentazioni GENERATE (da PDF/testo/Airtable)**, non solo
  all'inserimento manuale dal database. La v41 aveva riscritto solo
  `_insertArtistSlides` (flusso manuale); le presentazioni generate passano
  invece da `buildActivity`/`buildGallery`, rimaste al vecchio layout
  (1 slide + galleria 3 foto senza didascalie) — scoperto dal file esportato
  caricato dall'utente. Ora, per ogni attività:
  - nuova `_actPhotoSets(act)`: risolve foto principale, seconda foto e foto
    galleria da `act.allPhotos` (fallback `[photo, ...photos]`);
  - nuova `buildActivitySecond()`: seconda slide full-page (solo nome +
    "Vista d'insieme") quando esiste una seconda foto distinta;
  - `buildGallery()` riscritta: foto rimanenti (fino a 6) con didascalie
    "Foto N" e layout `grid-1`…`grid-4`/`grid-6` in base al numero, invece
    delle 3 foto fisse senza didascalie.
  Verificato in jsdom con un TRIP mock (attività a 8 foto → 3 slide corrette;
  attività a 1 foto → solo la slide principale, nessuna slide vuota).

## v41 — 2026-07-26
- **Inserimento fornitore/artista/attività ora produce 2 slide full-page +
  1 slide galleria "come allegato"**, al posto della vecchia 1 slide
  divisa foto/testo + 1 galleria da 3 foto senza didascalie
  (`_insertArtistSlides` in `loveit_template.html`). La prima slide porta
  titolo, meta e descrizione sopra la foto principale; la seconda è una
  seconda inquadratura più "leggera" (solo nome, per dare respiro visivo)
  sopra una foto diversa. Tutte le foto restanti (fino a 6) finiscono nella
  slide galleria, ciascuna con didascalia "Foto N" (`.gallery-cell-caption`,
  gradiente scuro in basso) — ispirata allo screenshot Villa Miani mostrato
  dall'utente. La galleria usa il layout a griglia più adatto al numero di
  foto rimaste (`grid-1`…`grid-4`, o `grid-6` per 5-6 foto: 3 colonne × 2
  righe invece delle vecchie 3 foto fisse).
- **Slide "Confronto Opzioni": ora si possono inserire foto nei riquadri.**
  Ogni card (`.opt-card-photo`) mostra un placeholder sempre visibile
  ("Scegli una foto", stesso stile a bordo tratteggiato già usato per le
  slide foto/testo) cliccabile per aprire il picker Airtable o trascinabile
  per il drag&drop, tramite la nuova `_wireOptCardPhoto()` — collegata sia
  alle 2 card iniziali che a ogni nuova card aggiunta con "+ Aggiungi
  opzione". Verificato in jsdom: placeholder presente e wired su card
  iniziali e su card aggiunte dinamicamente.
- Verificato l'intero flusso con test jsdom end-to-end (fetch mockata a 8
  foto → 2 sezioni full-page corrette + galleria `grid-6` con 6 didascalie;
  opt-card con placeholder su card originali e aggiunte).
- Foto full-page troppo "croppate": proposta discussa con l'utente (vedi
  chat) — possibile prossimo passo un controllo di riposizionamento del
  punto focale della foto in edit mode, non ancora implementato.

## v40 — 2026-07-23
- **Due nuove slide ispirate allo stile grafico di un template pptx dark
  (fornito dall'utente)**, aggiunte come layout selezionabili dal pannello
  "+ Aggiungi slide" in `loveit_template.html`. Le foto restano sempre scelte
  a mano nell'editor HTML (drag&drop o picker Airtable) — nessuna generazione
  automatica, coerente col resto del sistema.
  - **Confronto Opzioni** (`data-layout="optcompare"`): 2-3 card affiancate
    (foto + tag + nome + direzione creativa + nota), bordo oro e badge
    "Consigliata" sulla card scelta. Pulsante ★ per spostare la scelta su
    un'altra card (esclusivo — se ne stacca automaticamente dalle altre),
    "+ Aggiungi opzione" (si nasconde al limite di 3 card) e × per rimuovere
    (minimo 1 card; se si cancella quella consigliata, la prima rimasta
    diventa automaticamente la nuova consigliata).
  - **Flusso/Concept** (`data-layout="flow"`): titolo + lista puntata a due
    colonne dei "momenti" della serata/attività, con +/× per riga (minimo 1)
    e una nota finale in corsivo per menzionare le alternative scartate.
  - Note tecniche: estesi `TEXT_SEL` (`.optcompare-sub`, `.opt-card-direction`;
    il resto riusa classi esistenti come `.headline`/`.eyebrow`/`.body-text`),
    `_isRealEdit` (ora traccia anche l'aggiunta/rimozione di `.opt-card`/
    `.flow-item`, non solo `<section>`/`<tr>`) e l'`attributeFilter` del
    MutationObserver (aggiunto `data-recommended`) così anche il tag di
    "consigliata" è tracciato da dirty-check/Undo-Redo. Stesso accorgimento
    `pointer-events:auto` già imparato con la v38 per i pulsanti dentro
    `.content-dark`. Verificato l'intero flusso (inserimento, cap a 3 card,
    toggle consigliata, cancellazione con riassegnazione, minimi, ciclo
    edit-mode on/off) con un test end-to-end in jsdom simulando i click reali.

## v39 — 2026-07-23
- **Unificati i tab "Scheda Fornitore" e "Artists & Shows"** in un unico tab
  "🔍 Cerca nel Database" (`public/index.html`) con un solo campo di ricerca.
  - Backend: nuovo branch `search` in `api/acts.js` (`handleUnifiedSearch`) che
    cerca in parallelo su Suppliers, Artists & Shows e Activities (keyword OR-search,
    come i picker esistenti). Match esatto o unico → genera subito; più match →
    picker fuzzy con etichetta di provenienza (Fornitore/Artista-Show/Attività).
  - Refactor `api/supplier.js`: la pipeline di generazione (ricerca → fallback AI →
    TRIP → template) è ora `export async function generateSupplierFullPage(...)`,
    riusata sia dal suo handler POST sia dalla ricerca unificata in `acts.js`
    (import diretto tra file esistenti — non è un nuovo file in `api/`, quindi
    non viola la Regola 2).
  - Nuova capability in `api/acts.js`: `generateActivityFullPage(...)` — prima
    d'ora la tabella Activities produceva solo JSON per il picker interno
    (`handleActivity`, invariato), non una pagina scheda completa.
  - Frontend: `showFuzzyConfirm` ora porta anche il `kind` di ciascun candidato,
    così al click su un candidato la generazione salta la ri-ricerca e va dritta
    alla tabella giusta (evita ambiguità se lo stesso nome esiste altrove).
- **La ricerca "Da Preventivo" ora considera anche Artists & Shows e Activities**,
  non solo Suppliers (`api/generate.js` e `api/generate-text.js`). Per ogni
  attività estratta dal PDF/testo: se il nome non trova un fornitore/venue,
  si prova come artista/show, poi come attività prenotabile — foto risolte
  tramite la tabella Media (che Artists & Shows/Activities usano al posto di
  un campo Photos diretto). Verificato con test mirati (fetch mockato) per
  entrambi i livelli di fallback, oltre alla suite sulla ricerca unificata.

## v38 — 2026-07-22
- **Nuovo: colonna miniature slide con riordino drag & drop** (`loveit_template.html`).
  Visibile solo in Edit Mode (come gli altri strumenti di editing), si apre a
  sinistra e sposta il contenuto della presentazione (`#scroll`, logo, barra
  controlli) per non sovrapporsi.
  - Ogni miniatura mostra la foto principale della slide (estratta dal primo
    `background-image` trovato tra `.bg`/`.split-photo`/`.gallery-cell`/
    `.video-card-thumb`) + un'etichetta breve (titolo/eyebrow, o un nome
    generico per tipo: Copertina, Mappa, Planimetrie, Video, Gallery, Chiusura)
    + il numero di slide. Si evidenzia in oro quella attualmente visibile
    (IntersectionObserver dedicato) e si aggiorna da sola dopo ogni modifica
    reale (stesso motore del dirty-tracking/undo), con un debounce leggero di
    300ms.
  - Trascinare una miniatura sopra un'altra sposta la `<section>` vera nel
    deck (non solo l'anteprima): rilascio nella metà superiore = inserisci
    prima, metà inferiore = inserisci dopo (indicatore visivo con riga dorata).
    Dopo lo spostamento vengono ricostruiti sia i `#dots` di navigazione sia
    la colonna miniature.
  - Il riordino è un normale spostamento di nodo nel DOM (`insertBefore`), quindi
    viene intercettato automaticamente dal MutationObserver esistente: risulta
    "annullabile" con Undo/Redo (v37) senza bisogno di codice dedicato.
- **Nuovi campi editabili**: i badge in copertina (date/pax/paese, `.meta-pill`)
  e i valori di capienza sala nelle slide "Spazi" (`.room-cap-label`/`.room-cap-value`,
  es. "Theatre 30") sono ora testo modificabile in Edit Mode, come titoli e paragrafi.
- **Righe "Day" gestibili nella tabella Programme** (slide "Your journey at a glance").
  Ogni riga (`Day N · data` + descrizione) ha ora una × per rimuoverla (lascia
  sempre almeno una riga), e un pulsante "+ Aggiungi giorno" in fondo alla tabella
  crea una nuova riga precompilata e già pronta per la digitazione (focus automatico).
  Righe aggiunte/rimosse sono tracciate dal dirty-tracking e da Undo/Redo come le
  altre modifiche (esteso `_isRealEdit` per riconoscere l'aggiunta/rimozione di `<tr>`).
  Nota tecnica: i pulsanti stanno dentro `.content-dark`, che in edit-mode ha
  `pointer-events:none` per lasciare cliccabili le zone-foto sottostanti — è stato
  necessario un `pointer-events:auto` dedicato, altrimenti risultavano invisibili al click.

## v37 — 2026-07-22
- **Fix bug critico**: cliccando "Chiudi anteprima" e poi "Annulla" sul dialog,
  l'anteprima si chiudeva comunque perdendo le modifiche. Causa: `index.html`
  nascondeva l'overlay (`display:none`) e resettava `previewFrame.src` in un
  colpo solo, PRIMA che il browser mostrasse il suo dialog nativo "Leave site?"
  (scatenato dal `beforeunload` interno del template quando cambia `src`
  dell'iframe) — quindi l'anteprima spariva visivamente indipendentemente dalla
  scelta dell'utente nel dialog. Fix: l'overlay ora si nasconde SOLO dopo
  l'evento `load` dell'iframe, che scatta esclusivamente se la navigazione verso
  `about:blank` è realmente avvenuta. Se l'utente preme "Annulla" sul dialog
  nativo, la navigazione viene bloccata dal browser, `load` non scatta mai, e
  l'anteprima resta visibile con le modifiche intatte.
- **Nuovo: Undo / Redo** nell'editor in-presentazione (`loveit_template.html`):
  - Cronologia a snapshot del contenuto di `#scroll` (fino a 50 passi), pulita
    da elementi di editing (zone-foto, pulsanti +/−, `contenteditable`) prima
    di essere salvata, così ogni passo rappresenta solo il contenuto reale.
  - Riusa lo stesso MutationObserver del dirty-tracking (v36): ogni modifica
    vera (slide aggiunta/rimossa, foto cambiata, testo modificato) pianifica un
    "commit" nella cronologia dopo 700ms di quiete, così una sequenza di
    mutazioni correlate (es. le 3-4 slide inserite in un colpo solo scegliendo
    un artista/attività, o i tasti premuti scrivendo) diventa un solo passo di
    undo — non uno per ogni singola mutazione.
  - Ripristino di uno snapshot: se l'Edit Mode è attivo, viene spento e
    riacceso per ricostruire correttamente zone-foto/testo editabile/pulsanti
    sul DOM nuovo (altrimenti resterebbero agganciati a nodi rimossi); i dots
    di navigazione e l'IntersectionObserver vengono ricreati per ogni sezione.
  - Due nuovi pulsanti "Undo"/"Redo" nella barra di controllo (visibili solo in
    Edit Mode, disabilitati quando non c'è nulla da annullare/ripetere) +
    scorciatoie da tastiera Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z (o Ctrl+Y), disattivate
    quando il focus è dentro un campo di testo per lasciare l'undo nativo del
    browser sul singolo carattere.

## v36 — 2026-07-22
- **Protezione modifiche non salvate**, per non perdere il lavoro cliccando per
  sbaglio "Chiudi anteprima", refresh, tasto indietro o chiusura scheda:
  - `loveit_template.html`: rilevamento modifiche "vere" tramite MutationObserver
    mirato su `#scroll` — riconosce aggiunta/rimozione slide (`<section>`), modifica
    foto (style su `.split-photo`/`.gallery-cell`/`.bg`), edit di testo
    (characterData/text node), ignorando invece il rumore delle sole attivazioni di
    Photo/Text Mode (che aggiungono solo overlay UI, non contenuto). Autosave
    debounced (2s) su `localStorage` mentre ci sono modifiche non salvate;
    `window._loveitIsDirty()`/`window._loveitMarkClean()` esposte per la pagina
    esterna; "Save HTML" marca tutto come pulito e rimuove l'autosave.
    Aggiunto anche `beforeunload` diretto (utile se il file viene salvato e
    riaperto standalone in un'altra scheda).
  - `index.html`: il pulsante "Chiudi anteprima" ora chiede conferma se l'iframe
    risulta "dirty"; `beforeunload` sulla pagina principale avvisa anche su
    refresh/tasto indietro/chiusura scheda mentre l'anteprima è aperta con
    modifiche pendenti; all'apertura dell'anteprima, se esiste una bozza
    autosalvata (stesso `localStorage`, condiviso perché l'iframe usa un blob:
    URL dello stesso dominio) viene offerto il recupero prima di ripartire da zero.

## v35 — 2026-07-22
- Debug "planimetria non si vede" per Villa Miani: verificato su Airtable — i Media
  con Asset Type "Floor Plan" esistono (nome + descrizione) ma **non hanno un file
  allegato**. `getFloorPlans()` li scarta correttamente (nessun file → nessuna slide),
  quindi non è un bug: sono record segnaposto senza planimetria caricata ancora.
- Pulsante **Planimetria** ora apre un picker (come Spazi) che mostra le planimetrie
  già presenti in Airtable per il fornitore della slide, con anteprima, nome e
  descrizione: "Aggiungi tutte" per inserirle in un'unica slide, o click su una
  singola per aggiungerla da sola. Se il fornitore non ne ha (come Villa Miani ora),
  o in caso di errore di rete, ricade automaticamente sull'upload PDF manuale
  esistente — sempre raggiungibile anche via link "Carica un PDF" nel picker.
- Refactor: la costruzione della slide planimetrie è stata estratta in
  `_insertFloorplanSlide()`, riusata sia dall'auto-inserimento (picker Venue/Hotel)
  sia dal nuovo picker manuale — nessuna duplicazione di markup.

## v34 — 2026-07-22
- **Slide "Planimetrie"** dopo le foto, per qualsiasi venue/hotel con planimetrie in Airtable
  (Media con Asset Type "Floor Plan"/"Floorplan"). Stesso template della slide Video:
  eyebrow "Planimetrie" + nome centrale + griglia miniature (max 6, thumbnail Airtable
  anche per PDF), sotto ogni miniatura nome + descrizione, link "↓ Scarica" separato
  (icona download al posto del play).
- Implementata in entrambi i percorsi che generano schede fornitore:
  - `acts.js` `handleSupplierSlide` (picker Ristoranti/Hotel/Venue in-presentazione)
  - `supplier.js` POST (tab "Scheda Fornitore" standalone) — `findSuppliers` ora
    richiede anche il campo `Media`, nuova `getFloorPlans()`, `floorplans` aggiunto
    all'attività nel TRIP JSON.
  - `loveit_template.html`: nuova `buildFloorplansGrid()` nella pipeline statica
    (dopo la gallery, prima dei video) + blocco equivalente in `_insertArtistSlides`
    per il picker in-presentazione. Nuove classi CSS `.slide-floorplans`,
    `.video-card-download`, `.video-card-sub`, `.fp-download-link`.
- Compare automaticamente solo se il fornitore ha planimetrie collegate — nessuna
  azione manuale richiesta ("sempre" quando i dati ci sono).

## v33 — 2026-07-21
- **Trovata la vera causa del bug "iOS"**: non era mai iOS. `btnGenerateSup` e
  `btnGenerateAct` erano collegati direttamente a `generateSupplier`/`generateAct`
  (`addEventListener('click', generateSupplier)`) — il click passa il MouseEvent come
  primo argomento, che essendo un oggetto "vero" sovrascriveva il testo digitato
  nell'input. Su desktop probabilmente si premeva Invio (nessun argomento, funziona);
  al tocco su mobile si usa il pulsante (bug). Fix: `addEventListener('click', () =>
  generateSupplier())`. Il `String(supplier)` aggiunto in v31 mascherava il sintomo
  trasformando l'oggetto in "[object Object]" invece di un errore chiaro — ora sia
  `index.html` sia `supplier.js`/`acts.js` rifiutano gli oggetti (invece di stringificarli)
  e mostrano/lasciano l'errore visibile.

## v32 — 2026-07-21
- Fix "AI generation failed: Unexpected non-whitespace character after JSON":
  il modello a volte aggiunge testo dopo il JSON (errore intermittente, non legato a iOS).
  Nuovo `extractJsonObject()` (estrae il primo blocco {...} bilanciato, string-aware)
  usato in `supplier.js` (generateWithAI), `generate-text.js` (extractProgramme),
  `generate.js` (parse TRIP dal PDF).

## v31 — 2026-07-21
- **Fix iOS**: "supplier?.trim is not a function" — da iPhone/iPad il body POST arriva
  come stringa/Buffer non parsato (su Mac Vercel lo parsa in oggetto). Parsing tollerante
  del body in tutti gli endpoint (`supplier.js`, `acts.js`, `generate-text.js`,
  `generate.js`): Buffer→JSON.parse, string→JSON.parse, coercizione array/non-string.

## v30 — 2026-07-21
- Debug: HTTP 500 "nudo" (non-JSON) su Genera Scheda Fornitore da iOS. Aggiunto guard
  globale try/catch in `supplier.js` (`handler` → `mainHandler`) che restituisce
  `{error: "Errore interno: …"}` con il messaggio reale del crash. In attesa di
  riprodurre con il messaggio visibile.

## v29 — 2026-07-20
- **Chat database**: pulsante 💬 flottante su index.html apre una chat per interrogare
  Airtable in linguaggio naturale ("ristoranti a Roma con menù sotto i 70€").
- `generate-text.js`: modalità `{dbchat:{question,history}}` — scarica snapshot compatto
  di Suppliers/Prices/Meeting Rooms/Activities/Artists (formato pipe), lo passa a
  claude-sonnet-4-6 come contesto, risponde con lista puntata. History ultimi 4 turni
  per follow-up.

## v28 — 2026-07-20
- Pannello: "Spazi" spostato in riga Documents. Riga Activity ora:
  Artista · Attività · Ristoranti (arancio) · Hotel (teal) · Venue (rosa).
- Picker fornitori per categoria: `acts-list.js` `?kind=restaurants|hotels|venues`
  (filtro su "Supplier Categories", thumbnail dai Photos attachments);
  `acts.js` body `{supplier: nome}` → JSON slide (descrizione, meta City·Type·pax·rooms, foto).
- `_insertArtistSlides` ora accetta mode 'act'|'activity'|'supplier'; le slide fornitore
  ricevono `data-supplier` così il pulsante Spazi funziona anche da lì.

## v27 — 2026-07-20
- Pannello aggiungi-slide riorganizzato in 3 righe con titoli:
  **Template** (Singola, Grande sx/dx, Foto sx/dx — oro) ·
  **Documents** (Mappa blu, PDF rosso, Video verde, Planimetria viola) ·
  **Activity** (Artista, Attività, Spazi se presente).
- Nuovo pulsante Planimetria: stesso flusso PDF ma la slide è etichettata "Planimetria";
  il pulsante PDF ora etichetta "Documento" (`_showPdfInput`/`_insertPdfSlide` con kindLabel).
- Layout a griglia 5 colonne per righe allineate; i picker nascondono tutte le righe
  (`querySelectorAll('.asp-options,.asp-group-title')`).

## v26 — 2026-07-20
- Fix photo picker sulle slide artista/attività aggiunte dai picker: le foto vengono
  salvate sulla sezione in `data-all-photos` (JSON) e `makeZone` le legge come fallback
  quando mancano `data-day`/`data-act`.
- Photo picker: nuovo campo "Incolla il link di una foto" (Enter o →, validazione URL).
  Il picker si apre sempre (anche senza foto disponibili: dropzone + link).

## v25 — 2026-07-20
- Barra AI: aggiunto campo di istruzione libera sotto i pulsanti rapidi
  (es. "più formale", "cita il tramonto") — Invio o → per applicare.

## v24 — 2026-07-20
- **AI rewrite dei testi**: in modalità testo, cliccando su un testo editabile appare
  una barra AI (✨ Migliora · − Accorcia · + Espandi · EN · IT · ↩ Ripristina).
  Chiama Claude Haiku via `/api/generate-text` con body `{rewrite:{text,instruction,context}}`
  e sostituisce il testo in-place; il precedente resta in `data-ai-prev` per l'undo.
- `generate-text.js`: nuova `handleRewrite()` (copywriter Love IT, mantiene lingua e
  lunghezza salvo istruzione diversa, restituisce solo il testo).

## v23 — 2026-07-20
- Fix: titolo slide Video illeggibile (nero su nero) — `.videos-inner` ora imposta
  `color:var(--warm-white)`; `.headline` non ha colore proprio, lo eredita.

## v22 — 2026-07-20
- Slide Video ridisegnata: eyebrow "Video" + titolo artista centrale, sotto griglia
  di max 6 miniature con caption centrata. Vale per rendering statico
  (`buildVideosGrid`) e picker in-presentazione.
- `acts.js`: `enrichYouTubeTitles()` — titoli reali dei video via YouTube oEmbed
  (no API key); video limitati a 6 sia per artisti che attività.

## v21 — 2026-07-20
- `index.html`: tab rinominata "🎤 Artists & Shows" (era "Artist"), label/placeholder/hint
  aggiornati — l'hint citava la vecchia tabella "Spaces & Services" che non esiste più.

## v20 — 2026-07-20
- `template`: rimossa `buildVideo` (una slide full-page per video) anche dal rendering
  statico delle schede artista. Sostituita da `buildVideosGrid`: una sola slide "Video"
  per attività con griglia di miniature 16:9 + descrizioni sotto, click → nuova scheda.

## v19 — 2026-07-20
- `template`: stessa slide griglia video nel percorso picker in-presentazione
  (`_insertArtistSlides`). CSS nuovo: `.slide-videos`, `.videos-grid`, `.video-card-*`.
- `acts.js`: `parseVideoLinks()` legge le etichette riga per riga dal campo "Video Links"
  (es. "Gala Performance – https://…") → titoli reali sotto le miniature. Aggiunto
  `sourceUrl` ai video per il click-through.

## v18 — 2026-07-20
- `acts.js` (attività): i Media collegati a 2+ attività sono asset generici del fornitore
  (es. i 5 "HR Tours" condivisi tra tutti i Vintage Car Tour) → usati solo come fallback;
  le slide usano solo i media specifici dell'attività. Campo chiave: `Activities` nella
  tabella Media (conteggio link).
- `acts-list.js`: thumbnail = primo media **con file allegato** (fino a 8 per record),
  non più semplicemente il primo della lista (spesso senza allegato).

## v17 — 2026-07-20
- Nuova sezione **Attività** (tabella Activities `tblPIbMu1UDjOLYIK`), stessa logica di
  Artists & Shows:
  - `acts-list.js`: `?kind=activities` → lista con thumbnail (config per-kind `KINDS`)
  - `acts.js`: body `{activity: nome}` → `handleActivity()` con meta
    (tipo · setting · max pax · durata)
  - `template`: pulsante "Attività" (icona blu) nel pannello aggiungi-slide,
    `_showActivityPicker`, slide foto-sx/testo-dx con riga meta eyebrow

## v16 — 2026-07-20
- `supplier.js` (GET spazi): **fix decisivo** — aggiunto `returnFieldsByFieldId=true`
  alle 3 chiamate Airtable (supplier, sale, foto). Senza, la risposta era per nome
  e le letture per ID risultavano sempre vuote → "Nessuno spazio trovato".

## v15 — 2026-07-20
- `supplier.js` (GET spazi): letture per field ID (`fldf1guJqLASjc0sP` Name,
  `fldSovyZuFZCp9N6Q` Meeting Rooms, `fldnvvLqifmGnGn5n` Media). Non bastava senza v16.

## v14 — 2026-07-20
- Rinomina colonne Airtable nella tabella Artists & Shows:
  `"Artist or Act Name"` → **"Artist or Show Name"**, `"Artist Tags"` → **"Artist & Show Tags"**.
  Aggiornati `acts.js` e `acts-list.js`. Gli ID tabella non cambiano mai con le rinomine.

## v13 — 2026-07-20
- `supplier.js`: `technicalNotesOnly()` — le note delle sale meeting mostrano solo info
  tecniche; regex elimina frasi con prezzi/fee/VAT/commenti commerciali.

## v10–v12 (sessione precedente)
- Feature "Spazi & Sale": dal pannello aggiungi-slide di una slide fornitore si scelgono
  le sale meeting del fornitore (foto-sx / info-dx con capacità).
- `supplier-spaces.js` standalone → 404 persistente su Vercel → logica spostata in
  `supplier.js` come handler GET (`/api/supplier?supplier=…`). Il file standalone resta
  nel repo ma NON è usato.
- `vercel.json`: rimossi tutti i rewrite espliciti `/api/*` (prefix-match rompeva le route);
  Vercel gestisce `api/*.js` da solo. Resta solo il catch-all → `public/index.html`.
- Fuzzy match fornitori (`generate-text.js`): stop words italiane (articoli/preposizioni)
  + `matchScore()` con soglia ≥50% keyword. Fix "la" che matchava fornitori sbagliati.
- Modalità "Scrivi programma" (testo libero → `/api/generate-text`).

## Architettura (promemoria rapido)
- `api/generate.js` — PDF preventivo → AI → presentazione
- `api/generate-text.js` — programma testuale → AI → presentazione
- `api/supplier.js` — POST: scheda fornitore · GET: sale meeting (`?supplier=`)
- `api/acts.js` — POST `{act}`: scheda artista · `{activity}`: dati attività (JSON)
- `api/acts-list.js` — GET lista artisti · `?kind=activities` lista attività
- `template/loveit_template.html` — template presentazione con editor in-page
  (photo picker Airtable, drag&drop, pannello aggiungi-slide: layout, mappa, PDF,
  video, artista, attività, spazi)
- Tabelle: Suppliers `tbl3rEBd03iC29uNb` · Meeting Rooms `tbl4JXVw0K9Sz0dHC` ·
  Artists & Shows `tblbCAthb1HXfc13i` · Activities `tblPIbMu1UDjOLYIK` ·
  Media `tblpKKKum1aFwPjgY`
