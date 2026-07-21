# Changelog — Love IT DMC Presenta

App: https://full-presentation-builder.vercel.app
Airtable base: `app17rv8UlvfpaANc` (LoveIT Fornitori)

> Regola d'oro imparata sul campo: quando si richiedono campi Airtable per **field ID**,
> aggiungere sempre `returnFieldsByFieldId=true` all'URL, altrimenti la risposta usa i nomi.
> Regola 2: mai creare nuovi file in `api/` — Vercel a volte non li rileva (404).
> Estendere sempre gli endpoint esistenti con query param o campi nel body.

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
