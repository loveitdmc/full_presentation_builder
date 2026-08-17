# Changelog — Love IT DMC Presenta

App: https://full-presentation-builder.vercel.app
Airtable base: `app17rv8UlvfpaANc` (LoveIT Fornitori)

> Regola d'oro imparata sul campo: quando si richiedono campi Airtable per **field ID**,
> aggiungere sempre `returnFieldsByFieldId=true` all'URL, altrimenti la risposta usa i nomi.
> Regola 2: mai creare nuovi file in `api/` — Vercel a volte non li rileva (404).
> Estendere sempre gli endpoint esistenti con query param o campi nel body.

## v66 — 2026-08-17 — Restyle "Studio": archivio in homepage + tag a tinta chiara
- Stesso aggiornamento visivo fatto su Capybara e in corso su Vault/Preventivi
  (istruzioni ricevute via `ISTRUZIONI_ING_C_presenta_restyle.md` +
  `presenta-concept.html`): nuovi token condivisi `--good/--warn/--bad/--info`
  (+ `-wash`/`-deep`) e `--gold-tint` (riservato al futuro template "Elegante
  Cream/Gold"), font Manrope al posto di Montserrat per l'interfaccia dello
  strumento (i template delle presentazioni restano invariati, §4.3).
- L'archivio "Le mie presentazioni" non è più un modal dietro un pulsante:
  è ora la home stessa, come da concept — griglia di card con titolo,
  progetto, fornitori e un tag colorato per template, seguita da "Scegli un
  template" con le 4 card dei template realmente disponibili in Presenta
  oggi (Dark Journey, Venue Options, Hotel Proposal, Quotazione Venue).
  Il generatore (tab "Da Preventivo" / "Cerca nel Database") resta nella
  stessa pagina più sotto: "+ Genera nuova" e le card-template ci scorrono
  sopra, preselezionando il template scelto.
- Le istruzioni citavano 6 template reali (Standard Corporate ed Elegante
  Cream/Gold in più rispetto ai 4 già in Presenta): non essendo ancora
  implementati nel codice, non compaiono nella griglia "Scegli un template"
  — nessuna card finta/disabilitata, solo quelli davvero generabili oggi.
  I due tag colorati riservati (`good`/`bad`/`gold-tint` avanzati) restano
  liberi per quando arriveranno.
- Il filtro che esclude le presentazioni cestinate (`{Deleted At}=BLANK()`,
  v62/v64) non è cambiato: la nuova griglia usa lo stesso `?archive=list`.
- Testato con jsdom: caricamento griglia da `?archive=list` con 2 elementi
  finti, colori-tag corretti per template, cancellazione con rimozione della
  card dal DOM, click su card-template → scroll a `#generate-section` +
  preselezione del `.tpl-card` corrispondente nel tab "Da Preventivo".
- Aggiustamento subito dopo il primo giro (stesso v66): su indicazione di
  Marco, l'archivio è stato spostato SOTTO al generatore invece che sopra
  (il generatore resta la prima cosa che si vede, come prima del restyle),
  e la riga "Scegli un template" è stata tolta dall'archivio — è già nel
  generatore appena sopra, ridondante qui. "+ Genera nuova" ora scorre
  semplicemente su fino al generatore.

## v65 — 2026-08-16 — Sessione da 14 giorni, come Preventivi (non più solo ~1h)
- Marco ha segnalato che Preventivi regge il login 14 giorni con un cookie
  di sessione (`li_session`), mentre Presenta (v62) si appoggiava solo alla
  scadenza del token Google — circa un'ora, poi ripartiva silenziosamente
  ma comunque ogni ora. Stesso schema adottato qui, non uno diverso: dopo il
  primo accesso, il server emette un cookie `li_session` firmato che dura
  **14 giorni** (`HttpOnly`, `Secure`, `SameSite=Lax` — JavaScript nel
  browser non può leggerlo né manometterlo). Ad ogni richiesta successiva
  il server verifica quel cookie prima di chiedere qualunque cosa a Google:
  zero chiamate esterne, zero prompt, finché non scade davvero.
- Firma HMAC-SHA256 con una chiave propria (`SESSION_SECRET`, nuova
  variabile) — non riusa `GOOGLE_CLIENT_ID` né altri segreti esistenti.
  Verificata con confronto a tempo costante (`crypto.timingSafeEqual`)
  contro la manomissione del cookie lato client.
- **Spento finché `SESSION_SECRET` non è configurato**, stesso principio di
  `GOOGLE_CLIENT_ID`/`BLOB_READ_WRITE_TOKEN`/`CRON_SECRET`: senza quella
  variabile Presenta si comporta esattamente come in v62 (cache
  `localStorage` da ~1h) — nessuna regressione nel frattempo. Vedi
  `SETUP.md` per l'attivazione.
- Nuovi endpoint su `acts.js` (`{login:{idToken}}` scambia il token Google
  col cookie di sessione; `{logout:true}` lo cancella) e su `acts-list.js`
  (`?auth=session` — controllo istantaneo del cookie, usato ad ogni
  caricamento pagina prima di toccare Google). `handleSavePresentation` e
  `handleDeletePresentation` ora accettano sia il cookie di sessione sia il
  token Google della singola richiesta (compatibilità con la v62 durante il
  passaggio).

## v64 — 2026-08-16 — Svuotamento automatico del cestino dopo 30 giorni
- Le presentazioni cancellate (v62, "Deleted At" impostato) restavano su
  Airtable per sempre — nascoste, ma mai tolte davvero. Controllato prima di
  scrivere codice: le Automation di Airtable non hanno un'azione "cancella
  record" nativa (solo create/update/find/sort/email/AI), quindi non si
  poteva fare interamente dentro Airtable.
- Aggiunto un **cron di Vercel** (1 volta al giorno, alle 3:00 UTC — dentro
  al limite di una esecuzione/giorno del piano Hobby) che chiama un nuovo
  endpoint su `acts-list.js` (`?purge=presentations`): trova le presentazioni
  cancellate da più di 30 giorni e le cancella per davvero da Airtable,
  cancellando anche il file su Vercel Blob (migliore sforzo — se fallisce non
  blocca la cancellazione del record).
- **Spento finché non lo si attiva esplicitamente**, stesso principio di
  `GOOGLE_CLIENT_ID` e `BLOB_READ_WRITE_TOKEN`: senza la variabile
  `CRON_SECRET` l'endpoint risponde "nessuna cancellazione automatica attiva"
  e non tocca nulla. Protetto anche lato autenticazione: senza il token
  giusto nell'header (quello che Vercel manda da solo al proprio cron)
  risponde 401. Vedi `SETUP.md` per il passo di attivazione.

## v63 — 2026-08-16 — Titolo modificabile in archivio
- Prima di "Salva in archivio" c'è ora un campo di testo col titolo
  proposto (fornitore/cliente + destinazione, come prima) ma modificabile:
  chi salva può scrivere il titolo che preferisce per l'elenco.

## v62 — 2026-08-16 — Cancellazione, collegamento a un progetto, login che non chiede più ogni volta
- **Cancellare una presentazione salvata.** Nel modal "Le mie presentazioni"
  ogni voce ha ora un cestino. Cancellare non fa una DELETE vera su Airtable:
  imposta `Deleted At`/`Deleted By` (due campi nuovi su Presentations) ed
  esce dall'elenco — la stessa convenzione già in uso per Quotes, Projects e
  Quote Lines in questa base ("un record con questo campo impostato è nel
  cestino; svuotarlo lo ripristina esattamente com'era"). Non l'ho inventata:
  è coerente con quello che i colleghi si aspettano di trovare qui.
- **Collegare una presentazione a un progetto.** Presentations aveva già un
  campo `Project` (link verso Projects, mai usato finora). Prima di "Salva in
  archivio" compare ora un selettore facoltativo con l'elenco dei progetti
  non cancellati (nuovo endpoint `?archive=projects` su `acts-list.js`); nel
  modal, il nome del progetto compare accanto a data e fornitori. L'ID che
  viaggia resta dentro la stessa base — non attraversa applicazioni diverse,
  quindi non tocca la regola §0.1.
- **Login che non chiede più ad ogni ricarica.** Prima ogni caricamento
  pagina richiamava `google.accounts.id.prompt()` da zero, quindi il
  selettore account di Google si riproponeva in continuazione anche a
  sessione valida. Ora il token viene tenuto in `localStorage` con la sua
  scadenza reale (il campo `exp` del JWT — circa un'ora, non inventata): se
  è ancora valido, Presenta lo riusa direttamente e non richiama affatto
  Google, niente script GIS caricato, niente prompt. Il login torna a
  servire solo quando il token scade o dopo aver premuto il nuovo link
  "Cambia account" (cancella la cache e forza una nuova scelta di account).

## v61 — 2026-08-16 — Archivio davvero riapribile + template anche nella ricerca
- **"Le mie presentazioni":** nuovo pulsante nell'header apre un elenco delle
  presentazioni salvate in Love IT Projects › Presentations (titolo,
  template, data, chi l'ha salvata, fornitori inclusi), con un pulsante
  "Apri" per ciascuna. Endpoint di lettura aggiunto a `acts-list.js`
  (`?archive=list`), non un file nuovo (regola d'oro in cima a questo file).
- **Il file adesso viene davvero salvato, non solo referenziato.** Fino alla
  v60 il campo `File` era un link `/?file=…` che non è mai stato servito da
  nessuna parte — puntava a niente. Ora "Salva in archivio" carica l'HTML
  generato su **Vercel Blob** (`@vercel/blob`, nuova dipendenza) e usa l'URL
  reale del file come campo `File`. Aprire quel link apre la presentazione
  stessa, editabile — non una copia statica — perché l'editor è incorporato
  nell'HTML esportato fin dalla v11.
  **Serve un passo manuale su Vercel** (Storage → Create → Blob, poi
  collegare il progetto): finché `BLOB_READ_WRITE_TOKEN` non è configurato,
  il salvataggio prosegue comunque — titolo/template/fornitori restano
  utili — ma "Le mie presentazioni" mostra "Non disponibile" al posto del
  pulsante Apri. Vedi `SETUP.md`.
- **Template scelto anche in "Cerca nel Database".** Prima la ricerca
  unificata (Suppliers + Artists & Shows + Activities) generava sempre una
  "scheda" nel tema scuro, senza copertina/chiusura. Ora le stesse quattro
  card del tab "Da Preventivo" sono disponibili anche qui (stato
  sincronizzato fra le due copie): scegliendo Venue Options, Hotel Proposal
  o Quotazione Venue si ottiene un mini-deck con copertina, invece della sola
  scheda. Il default resta "Scheda semplice" (ex comportamento dark), che
  continua a nascondere copertina/overview/chiusura come sempre.
  `api/acts.js`, `api/supplier.js`: `deckTemplate`/`costLayout` propagati
  in `generateActFullPage`, `generateActivityFullPage`,
  `generateSupplierFullPage` e nella dispatch di `handleUnifiedSearch`.

## v60 — 2026-08-15 — Permessi Airtable per l'archivio
- **Diagnosi del 403 in produzione** ("INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND"
  al primo salvataggio reale): il token Airtable di Presenta ha accesso alla
  sola base Fornitori — fino alla v57 l'app non scriveva da nessuna parte, il
  permesso su Love IT Projects non era mai servito. Non è un bug del codice:
  la richiesta è corretta, manca l'autorizzazione.
- **Messaggio d'errore che dice cosa fare** invece del solo codice (§7): su
  403/404 la schermata ora spiega che il token non ha accesso alla base e dove
  aggiungerlo, ricordando che la presentazione resta scaricabile.
- **Token dedicato opzionale:** se esiste `AIRTABLE_PROJECTS_TOKEN` viene usato
  per la scrittura sull'archivio, altrimenti si ricade su `AIRTABLE_TOKEN`.
  Permette di lasciare il token principale in sola lettura sulla base Fornitori
  e concedere la scrittura solo dove serve.
- `SETUP.md`: procedura per entrambe le strade (estendere il token esistente —
  nessun redeploy necessario — oppure crearne uno separato).

## v59 — 2026-08-15 — Allineamento a Vault e configurazione accesso
- **Token "Studio" riallineati sui valori esatti del Vault** (`Styles.html`,
  blocco "Studio" riga 429, passato da Ing. A): `--radius:12px` per le card,
  `--radius-sm:8px` per bottoni e campi, `--radius-lg:18px` per i pannelli;
  ombre `0 1px 2px rgba(20,20,20,.04),0 1px 1px rgba(20,20,20,.03)` (card),
  `0 6px 20px rgba(20,20,20,.08)` (lift su hover, con `translateY(-2px)` come
  `.db-card`), `0 20px 60px rgba(20,20,20,.16)` (overlay). Aggiunti
  `--accent-deep:#C94E3F` per gli hover della primaria (prima era una mia
  stima) e i toni sidebar `--side-2/--side-ink/--side-muted`. Adottato anche
  il pattern pastiglia del Vault: tab, selettori modo e opzioni costi a
  `border-radius:99px` come `.status`/`.chip`. Nessun valore più stimato a
  occhio.
- **Client ID ricevuto e documentato** in `SETUP.md` con la procedura
  nell'ordine giusto (prima gli Authorized JavaScript origins su Google Cloud,
  poi la variabile su Vercel), il comando per verificare che il login sia
  acceso, e la nota sui deploy di anteprima: Google non accetta wildcard e
  Vercel cambia indirizzo a ogni push, quindi lì il login non si potrà fare e
  il salvataggio risponderà "Accesso richiesto".
- Confermato con Ing. A: i nomi template restano `dark`, `venues`, `hotel`,
  `quotation` — il carrello del Vault può contare su questi quattro valori
  (§6, contratto fra le due applicazioni).

## v57 — 2026-08-15 — Istruzioni di lavoro §4 (Ing. C)
Attuata la parte di Presenta del documento operativo del 15/08.

- **§4.2 Handoff dal Vault.** `public/index.html` legge i parametri
  dell'indirizzo: `?supplier=Nome&tpl=…` apre "Cerca nel Database" col nome già
  scritto; `?suppliers=A|B&tpl=…` apre "Scrivi programma" con i nomi in elenco
  e il template selezionato. Le due cose deliberate del documento sono
  rispettate: la generazione **non parte da sola** (il pulsante resta da
  premere) e i parametri si leggono **una volta sola** e vengono rimossi
  dall'indirizzo con `history.replaceState`, così un F5 non sovrascrive quanto
  scritto nel frattempo. Template accettati solo dall'elenco
  `dark|venues|hotel|quotation`: un valore fuori elenco viene ignorato senza
  errori. **Se questi nomi cambiano va avvisato Ing. A** (§6).
- **§4.3 Restyle "Studio".** Interfaccia dello strumento passata ai token
  condivisi (`--charcoal/--canvas/--ink/--muted/--border/--teal/--coral/--amber`):
  fondo chiaro, card bianche con raggio 14px e ombra morbida, tab e selettori a
  pastiglia, azione primaria in coral pieno, stati positivi in teal, avvisi in
  amber. **I template delle presentazioni non sono stati toccati**: Dark
  Journey, Venue Options, Hotel Proposal e Quotazione Venue restano documenti
  per il cliente col loro linguaggio. Raggio/ombra/spaziature sono la lettura
  più fedele dell'elenco nelle istruzioni: **da riallineare su `Styles.html`
  del Vault** quando Ing. A lo passa (§4.3).
- **§4.4 Archivio presentazioni.** Creata la tabella `Presentations` nella base
  Love IT Projects (`tblqE4NEkpj28xH8f`) con Title, Template, Suppliers,
  Project (link a Projects), Created By, Created At, File, Notes. Campo `File`
  come **URL** e non allegato: la tabella è un indice, il file resta dove
  Presenta lo genera (decisione presa con Marco). Nuovo pulsante "Salva in
  archivio" nella schermata di risultato: salva **solo su azione esplicita**,
  una volta per generazione (il secondo click non riscrive), mai in anteprima.
  I fornitori si salvano **per nome** (§0.1: gli ID non sopravvivono alla copia
  fra basi), deduplicati. Se l'archivio non risponde il messaggio lo dice e
  ricorda che la presentazione resta scaricabile. Endpoint dentro `acts.js`
  (regola: mai nuovi file in `api/`). **Presenta non scrive da nessun'altra
  parte**: né su Clients/Quotes/Quote Lines, né sulla base Fornitori.
- **§4.1 Accesso Google, pronto ma spento.** Verifica del token **lato server**
  in `acts.js` (`verifyGoogleIdToken`: audience, scadenza e dominio
  loveit-dmc.com) applicata al salvataggio, più barra di accesso nella home che
  compare solo quando `/api/acts-list?auth=config` risponde `enabled:true`.
  Finché `GOOGLE_CLIENT_ID` non è configurato su Vercel l'app funziona
  esattamente come oggi — **in attesa del Client ID da Ing. B (§1.1)**. In caso
  di dubbio sulla verifica non si concede: si chiede di rifare l'accesso.
- Verifiche fatte eseguendo davvero la pagina (§0.5, §7): handoff nelle due
  forme e con template non valido, URL ripulito, generazione non avviata;
  salvataggio con payload corretto, doppio click innocuo, errore archivio
  gestito; chiamata all'endpoint **direttamente** con login attivo e senza
  token → 401, con token di dominio estraneo → 401, con token valido → salvato
  con Created By. Schema della tabella verificato con una scrittura reale su
  Airtable, poi cancellata.

## v56 — 2026-08-13
- **Cost breakdown: ora si scelgono entrambe le modalità.** Selezionando
  "Quotazione Venue" nella home compare il selettore "Cost breakdown" con tre
  opzioni (`costLayout`, inviato a `/api/generate` e `/api/generate-text` e
  salvato nel TRIP):
  - **Per fornitore + riepilogo** (default) — dopo le slide di ogni fornitore
    la SUA tabella costi, e in fondo il riepilogo unico raggruppato con il
    totale generale. Con un solo fornitore il riepilogo viene saltato per non
    duplicare la stessa tabella.
  - **Solo per fornitore** — come piaceva nella v54: una cost breakdown in
    coda a ogni fornitore, nessun riepilogo finale.
  - **Solo riepilogo unico** — comportamento v55: una sola slide raggruppata.
  Il titolo della slide si adatta: "Nome fornitore · Evento · N Guests" per le
  tabelle singole, "Evento · N Guests" per il riepilogo.
- Formattazione importi resa deterministica (`_qFmt`): il separatore delle
  migliaia non dipende più dall'ICU del browser ("€ 2.600,00" ovunque).
- Verifica jsdom su tutte e tre le modalità con 2 fornitori + caso a fornitore
  singolo: sequenze slide, gruppi, righe e totali corretti
  (2.600,00 + 58,50 = € 2.658,50).

## v55 — 2026-08-13
- **Quotazione Venue allineato alla nuova versione del template pptx**
  (`loveit_single_venue_quotation_template.js`, rev. caricata dall'utente):
  - **Cost Breakdown ora è UNA sola slide raggruppata per fornitore** (non più
    una per fornitore come in v54): ogni gruppo ha una riga intestazione con
    nome del fornitore e sito web su fondo #EFEAE0, seguita dalle sue voci.
  - **Nuove colonne**: Description / Details / Qty / VAT / Unit / Amount
    (prima erano Item / Net / VAT / Total). Header della tabella ora testo
    scuro su crema — non più barra teal piena. Details e VAT in grigio,
    Amount in grassetto, bande alternate bianco/crema che ripartono a ogni
    gruppo.
  - **Testi in inglese** come richiesto dal template (deck client-facing):
    "≈ € X per person, VAT included" e footnote "Estimate based on available
    data. Final costs are subject to written confirmation from the supplier
    once event dates are set."
  - Export PPTX aggiornato di conseguenza: `colW [4.83,2.0,0.9,0.9,1.5,2.0]`,
    righe di gruppo con `colspan:6` e testo ricco (nome + sito), altezze
    riga adattive (0.55 gruppo, 0.5 se la descrizione supera 55 caratteri,
    0.36 standard) e posizione del blocco totale calcolata sommando le
    altezze reali — come nel nuovo template.
  - Backend: `costLines` ora estrae anche `unit` (prezzo unitario) dal
    preventivo; il fornitore porta con sé il campo **Website** di Airtable
    per l'intestazione di gruppo.
- Verifica jsdom: 2 fornitori → 6 slide con una sola cost breakdown, gruppi
  con sito, 3 voci, totale € 17.658,50 (15.600 + 2.000 + 58,50), footnote
  inglese, add/del riga, export PPTX con colW e colspan corretti.
  Non-regressione su fallback Airtable/vuoto e sui deck dark, venues, hotel.

## v54 — 2026-08-09
- **Quotazione Venue da PDF: voci di costo estratte dal preventivo, un blocco
  di slide per OGNI fornitore.** Caricando un preventivo Love IT (es.
  "8am — Rome — February 2027") e scegliendo il template Quotazione Venue:
  - l'AI estrae ora anche `costLines` per ogni fornitore
    (`label`/`detail`/`qty`/`vat`/`amount`), copiando alla lettera descrizioni,
    aliquote e importi del preventivo — nessun ricalcolo, nessuna riga
    inventata, righe di subtotale/totale escluse (`api/generate.js`, schema +
    regola 8; anche in `generate-text.js` per i programmi testuali);
  - il deck non è più limitato a un solo venue: **cover unica**, poi per ogni
    fornitore The Venue → (Floor Plan) → Gallery → **Cost Breakdown con le sue
    voci**, con titolo "Nome fornitore · Evento · N Guests";
  - la tabella mostra Item (descrizione + dettaglio), Net, VAT e Total presi
    dal PDF; il **totale è calcolato** sommando gli importi (parsing formato
    italiano "€ 14.274,00") e il costo/persona è diviso per i pax del
    preventivo. Verificato: 97,50 + 14.274,00 = € 14.371,50.
- Fallback invariati: se il preventivo non ha prezzi per quel fornitore si
  usano le voci Airtable con importi vuoti (v53); se non c'è nulla, 3 righe
  vuote da compilare. Non-regressione verificata su deck dark e venues.

## v53 — 2026-08-06
- **Nuovo template "Quotazione Venue"** (4ª card nella scelta iniziale), fedele
  al pptx `loveit_single_venue_quotation_template.js` caricato dall'utente:
  deck di 5 slide su UN solo venue, palette crema/teal/coral del template
  (CREAM #F7F4EF, DARK #2B323A, TEAL #346E74, CORAL #FF5149, GOLD #C9A96A),
  serif corsivo per i titoli.
  1. **Cover** — foto full-bleed + velo scuro 40%, logo, "EVENT PROPOSAL"
     oro, nome venue in corsivo, sottotitolo "Evento · N Guests · Città",
     firma "Love IT DMC · Your Italian DMC" a piè di pagina.
  2. **The Venue** — foto a sinistra (49%), a destra eyebrow coral, nome,
     filetto oro, descrizione e 4 fact (Location/Capacity/Spaces/Included)
     con label teal, popolati da Airtable: Address, Capacity, Features/Rooms.
  3. **Floor Plan** — cornice bianca con planimetria in `contain` + didascalia
     (slide presente solo se il venue ha planimetrie).
  4. **Gallery** — 4 foto in griglia 2×2.
  5. **Cost Breakdown** — tabella Item/Net/VAT/Total con intestazione teal e
     righe alternate, riga totale con filetto, "TOTAL (VAT INCLUDED)",
     costo/persona e footnote. Le voci sono popolate dai record Prices del
     venue (etichetta + aliquota IVA, deduplicate), **con importi vuoti**:
     i prezzi Airtable sono costi netti agenzia e non vanno mai mostrati al
     cliente senza ricarico — si compilano in edit mode. Pulsante
     "+ Aggiungi voce" e × per riga.
  - Quando si genera da PDF/testo il deck usa il **primo fornitore** del
    programma; da "Cerca nel Database" usa il fornitore cercato.
  - Tutte le slide sono editabili (testi, foto, righe) e incluse
    nell'**export PPTX** con le stesse coordinate del template originale
    (cover 46pt corsivo, venue x=7.0/w=5.7, plan frame 12.13×5.35, gallery
    2×2 5.9-ish, tabella colW [6.63,2.0,1.5,2.0]).
  - Backend: `findSuppliers` ora richiede anche Address/Capacity/Rooms/
    Features/Prices; nuova `fetchPriceLines()` (tabella Prices) che
    restituisce solo etichette + IVA. `deckTemplate:"quotation"` accettato da
    `/api/generate` e `/api/generate-text`.
  - Verifica jsdom: 5 slide corrette, facts popolati, planimetria, 4 foto,
    3 voci di costo con IVA, add/del riga, export PPTX (5 slide, tabella,
    testi cover/venue). Non-regressione backend su ricerca v48 e fallback
    Media v47.

## v52 — 2026-08-06
- **Fix didascalie che "saltavano in alto" in edit mode** (screenshot utente):
  la regola generica `body.edit-mode [contenteditable]{position:relative}` le
  toglieva dal posizionamento assoluto. Ora `position:absolute!important;
  bottom:0` sulla caption in edit mode — resta in basso ed è editabile.
- **Export PowerPoint: nuovo pulsante "↓ PPT"** accanto a PDF. Genera un vero
  .pptx (16:9) client-side con pptxgenjs (CDN, caricato al primo uso),
  mappando le slide HTML: cover/full-page/closing (foto full-bleed + overlay
  testo), tabelle (overview, hotel, venue — righe reali), spread split
  (foto metà + testo), gallerie (griglia foto con didascalie su barra scura),
  Confronto Opzioni (card con bordo, badge Consigliata, foto contain),
  Card Prezzi, Timeline, Flusso. Palette dark o crema/oro secondo il deck.
  Slide interattive (video, mappe, PDF, planimetrie) escluse dall'export.
- **Proxy immagini in `/api/acts-list?img=<url>`** (endpoint esistente, regola
  "no nuovi file in api/"): le foto Airtable/Unsplash non mandano CORS e il
  browser non potrebbe incorporarle nel .pptx; il proxy le rigira con CORS
  aperto (whitelist host: airtableusercontent, unsplash, googleusercontent,
  ytimg; solo https; cache 1h). L'export prova prima il fetch diretto, poi il
  proxy; le foto caricate a mano (data:) passano dirette.
- Verifica jsdom con stub PptxGenJS: 7 sezioni → 7 slide, testi
  cover/tabella/spread corretti, 3 righe tabella, nome file dal TRIP,
  pulsante ripristinato dopo l'export.

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
