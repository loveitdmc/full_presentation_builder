# Changelog — Love IT DMC Presenta

App: https://full-presentation-builder.vercel.app
Airtable base: `app17rv8UlvfpaANc` (LoveIT Fornitori)

> Regola d'oro imparata sul campo: quando si richiedono campi Airtable per **field ID**,
> aggiungere sempre `returnFieldsByFieldId=true` all'URL, altrimenti la risposta usa i nomi.
> Regola 2: mai creare nuovi file in `api/` — Vercel a volte non li rileva (404).
> Estendere sempre gli endpoint esistenti con query param o campi nel body.

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
