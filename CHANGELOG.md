# Changelog — Love IT DMC Presenta

App: https://full-presentation-builder.vercel.app
Airtable base: `app17rv8UlvfpaANc` (LoveIT Fornitori)

> Regola d'oro imparata sul campo: quando si richiedono campi Airtable per **field ID**,
> aggiungere sempre `returnFieldsByFieldId=true` all'URL, altrimenti la risposta usa i nomi.
> Regola 2: mai creare nuovi file in `api/` — Vercel a volte non li rileva (404).
> Estendere sempre gli endpoint esistenti con query param o campi nel body.

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
