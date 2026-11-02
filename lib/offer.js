// ─── v72 — "Offerta complessa" multi-day (stessa struttura della skill
// loveit-multiday-offer / Rome_Incentive_50_Guests_October_2027.pdf) ─────────
//
// Pipeline (condivisa da api/generate-text.js e api/generate.js):
//   1. planOffer      — Claude legge il brief (testo o PDF) → hotel, giorni,
//                       slot (pranzo/attività/cena) con le alternative.
//   2. gatherSupplier — per ogni alternativa cerca i candidati su Airtable
//                       (Suppliers / Activities / Artists & Shows) con profilo,
//                       foto e righe prezzo (tabella Prices).
//   3. composeOffer   — Claude sceglie il record giusto, scrive i testi in
//                       inglese, sceglie le righe prezzo (costo netto) e le
//                       quantità; mai inventare fatti.
//   4. buildTripOffer — il server applica margine + IVA (il margine non compare
//                       mai nel deck), assegna le foto reali, cerca su Unsplash
//                       solo cover/destinazione/divisori giorno.
//
// Non è un endpoint: vive fuori da api/ (regola §2 del CHANGELOG).

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";
const TBL = {
  SUP:    "tbl3rEBd03iC29uNb",
  ACT:    "tblPIbMu1UDjOLYIK",
  ART:    "tblbCAthb1HXfc13i",
  PRICES: "tbljeSwiqGWdJHvoQ",
  MEDIA:  "tblpKKKum1aFwPjgY",
};

// ─── utils ────────────────────────────────────────────────────────────────────
const _sel = v => (v && typeof v === "object" && !Array.isArray(v)) ? (v.name || "") : (v ?? "");
const round2 = n => Math.round(n * 100) / 100;
const STOP = new Set(["the","and","its","of","at","per","del","dei","della","delle","degli","di","da","in","con","su","tra","fra","al","alle","agli","allo","dal","dalla","dagli","dalle","la","lo","le","il","gli","un","una","uno","i","e","o","a","restaurant","ristorante","hotel","tour","roma","rome"]);
function words(q) {
  return String(q || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w));
}
function score(query, name) {
  const ws = words(query);
  if (!ws.length) return 0;
  const hay = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const hit = w => hay.some(h => h === w || (w.length >= 5 && h.startsWith(w)) || (h.length >= 5 && w.startsWith(h)));
  return ws.filter(hit).length / ws.length;
}

export function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object in AI response");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error("Unbalanced JSON in AI response (output probably truncated)");
}

// ─── Airtable ─────────────────────────────────────────────────────────────────
// Airtable accetta ~5 richieste/s per base: tutte le chiamate passano da una
// coda (max 3 in parallelo, retry sui 429). Invece di una ricerca per ogni
// alternativa si scarica una volta l'indice dei nomi (Suppliers / Activities /
// Artists) e si confronta in locale; poi i dettagli si leggono a blocchi.
let _active = 0; const _queue = [];
function _slot() { return new Promise(res => { const go = () => { _active++; res(); }; _active < 3 ? go() : _queue.push(go); }); }
function _release() { _active--; const n = _queue.shift(); if (n) setTimeout(n, 120); }
async function atPage(table, params) {
  const token = process.env.AIRTABLE_TOKEN, baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return { records: [] };
  const url = `https://api.airtable.com/v0/${baseId}/${table}?${params}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await _slot();
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
      if (r.status === 429) { await new Promise(z => setTimeout(z, 1200 * (attempt + 1))); continue; }
      if (!r.ok) { console.warn("[offer] Airtable", table, r.status); return { records: [] }; }
      return await r.json();
    } catch (e) { console.warn("[offer] Airtable error", table, e.message); if (attempt === 3) return { records: [] }; }
    finally { _release(); }
  }
  return { records: [] };
}
async function atAll(table, { formula, fields, maxPages = 15 } = {}) {
  const base = [];
  if (formula) base.push("filterByFormula=" + encodeURIComponent(formula));
  (fields || []).forEach(f => base.push("fields[]=" + encodeURIComponent(f)));
  base.push("pageSize=100");
  let all = [], offset = "", pages = 0;
  do {
    const d = await atPage(table, base.join("&") + (offset ? "&offset=" + encodeURIComponent(offset) : ""));
    all = all.concat(d.records || []); offset = d.offset || ""; pages++;
  } while (offset && pages < maxPages);
  return all;
}
async function byIds(table, ids, fields) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 60) chunks.push(uniq.slice(i, i + 60));
  const res = await Promise.all(chunks.map(c => atAll(table, { formula: `OR(${c.map(id => `RECORD_ID()="${id}"`).join(",")})`, fields, maxPages: 1 })));
  return res.flat();
}

const SUP_FIELDS = ["Name", "City", "Type", "Description", "Photos", "Media", "Address", "Website", "Capacity", "Rooms", "Prices", "Deleted At"];
const ACT_FIELDS = ["Activity or Service Name", "Supplier", "Capacity", "Duration", "Description and Operational Notes", "Media", "Prices", "Operating Areas"];
const ART_FIELDS = ["Artist or Show Name", "Supplier", "Description and Operational Notes", "Consolidated Media", "Prices", "Performance Duration", "Number of Performers"];
const PRICE_FIELDS = ["Price Line", "Category", "Amount", "Net Price", "VAT Rate", "VAT Included", "Unit", "Terms", "Included", "Excluded", "Status", "Valid From", "Valid Until", "Quoted Guests", "Minimum Quantity", "Number of Vehicles", "Duration Hours", "Deleted At"];

// Indice dei nomi (una lettura per tabella, paginata)
async function loadIndex() {
  const [sup, act, art] = await Promise.all([
    atAll(TBL.SUP, { fields: ["Name", "City", "Deleted At"] }),
    atAll(TBL.ACT, { fields: ["Activity or Service Name", "Operating Areas"] }),
    atAll(TBL.ART, { fields: ["Artist or Show Name"] }),
  ]);
  return [
    ...sup.filter(r => r.fields.Name && !r.fields["Deleted At"]).map(r => ({ kind: "supplier", id: r.id, name: r.fields.Name, where: r.fields.City || "" })),
    ...act.filter(r => r.fields["Activity or Service Name"]).map(r => ({ kind: "activity", id: r.id, name: r.fields["Activity or Service Name"], where: r.fields["Operating Areas"] || "" })),
    ...art.filter(r => r.fields["Artist or Show Name"]).map(r => ({ kind: "artist", id: r.id, name: r.fields["Artist or Show Name"], where: "" })),
  ];
}

function rankCandidates(index, queries, destination) {
  const qs = [...new Set((queries || []).filter(Boolean))];
  const dest = String(destination || "").toLowerCase();
  return index
    .map(c => {
      let s = Math.max(0, ...qs.map(q => score(q, c.name)));
      if (s > 0 && dest && String(c.where).toLowerCase().includes(dest)) s += 0.25;
      if (s > 0 && c.kind === "supplier") s += 0.05;
      return { ...c, s };
    })
    .filter(c => c.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2);
}

function photoUrls(atts) {
  return (atts || []).filter(f => f && f.url && /^image\//.test(f.type || "image/") && !/\.(mp4|webm|pdf)(\?|$)/i.test(f.url))
    .map(f => f.thumbnails?.full?.url || f.url);
}

// Dettagli dei candidati scelti, a blocchi: record, fornitore "padre",
// prezzi e foto (Media) con poche chiamate totali.
async function loadDetails(cands) {
  const ids = k => cands.filter(c => c.kind === k).map(c => c.id);
  const [sRecs, aRecs, rRecs] = await Promise.all([byIds(TBL.SUP, ids("supplier"), SUP_FIELDS), byIds(TBL.ACT, ids("activity"), ACT_FIELDS), byIds(TBL.ART, ids("artist"), ART_FIELDS)]);
  const rec = new Map([...sRecs, ...aRecs, ...rRecs].map(r => [r.id, r.fields]));
  const parentIds = [...aRecs, ...rRecs].map(r => (r.fields.Supplier || [])[0]).filter(id => id && !rec.has(id));
  const parents = await byIds(TBL.SUP, parentIds, SUP_FIELDS);
  parents.forEach(r => rec.set(r.id, r.fields));
  const mediaOf = f => (f?.Media || f?.["Consolidated Media"] || []).slice(0, 12);
  const priceIds = [], mediaIds = [];
  for (const c of cands) {
    const f = rec.get(c.id) || {};
    priceIds.push(...(f.Prices || []).slice(0, 50));
    mediaIds.push(...mediaOf(f));
    const pid = (f.Supplier || [])[0];
    if (c.kind !== "supplier" && pid) mediaIds.push(...mediaOf(rec.get(pid)));
  }
  const [prices, media] = await Promise.all([byIds(TBL.PRICES, priceIds, PRICE_FIELDS), byIds(TBL.MEDIA, mediaIds, ["File", "Asset Type"])]);
  const priceMap = new Map(prices.map(r => [r.id, r.fields]));
  const mediaMap = new Map(media.map(r => [r.id, r.fields]));
  const mediaPhotos = list => list.flatMap(id => {
    const m = mediaMap.get(id); if (!m) return [];
    if (/floor\s*plan|logo|video|document/i.test(_sel(m["Asset Type"]))) return [];
    return photoUrls(m.File);
  });
  return cands.map(c => {
    const f = rec.get(c.id) || {};
    const parent = c.kind !== "supplier" ? (rec.get((f.Supplier || [])[0]) || null) : null;
    const sup = c.kind === "supplier" ? f : (parent || {});
    const description = c.kind === "supplier" ? (f.Description || "") : (f["Description and Operational Notes"] || sup.Description || "");
    const photos = [...new Set([
      ...(c.kind === "supplier" ? photoUrls(f.Photos) : []),
      ...mediaPhotos(mediaOf(f)),
      ...(parent ? photoUrls(parent.Photos) : []),
      ...(parent ? mediaPhotos(mediaOf(parent)) : []),
    ])].slice(0, 14);
    const priceLines = (f.Prices || []).map(id => priceMap.get(id)).filter(Boolean)
      .filter(p => !p["Deleted At"] && !/generic placeholder/i.test(p.Terms || ""))
      .filter(p => (Number(p.Amount) || 0) > 0 || (Number(p["Net Price"]) || 0) > 0)
      .slice(0, 40)
      .map(p => ({
        line: p["Price Line"] || "", category: _sel(p.Category) || "", amount: p.Amount ?? null, net: p["Net Price"] ?? null,
        vat: _sel(p["VAT Rate"]) || "", vatIncluded: !!p["VAT Included"], unit: _sel(p.Unit) || "",
        status: _sel(p.Status) || "", validFrom: p["Valid From"] || "", validUntil: p["Valid Until"] || "",
        quotedGuests: p["Quoted Guests"] ?? null, minQty: p["Minimum Quantity"] ?? null,
        vehicles: p["Number of Vehicles"] ?? null, hours: p["Duration Hours"] ?? null,
        terms: String(p.Terms || "").slice(0, 300), included: String(p.Included || "").slice(0, 200), excluded: String(p.Excluded || "").slice(0, 160),
      }));
    return {
      id: c.id, kind: c.kind, name: c.name, parentName: parent?.Name || "",
      city: f.City || f["Operating Areas"] || sup.City || "", type: f.Type || sup.Type || "",
      address: sup.Address || "", website: sup.Website || "",
      capacity: f.Capacity ?? sup.Capacity ?? null, rooms: sup.Rooms ?? null,
      duration: f.Duration || f["Performance Duration"] || "",
      description: String(description).slice(0, 1600), photos, priceLines,
    };
  });
}

// ─── Unsplash (solo cover / destinazione / divisori giorno) ───────────────────
async function unsplash(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || !query) return null;
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json();
    const p = d.results?.[0];
    return p ? `${p.urls.raw}&w=2000&q=80&fit=crop&crop=entropy` : null;
  } catch { return null; }
}

// ─── Step 1: plan ─────────────────────────────────────────────────────────────
const PLAN_PROMPT = `You prepare multi-day group offers for Love IT DMC, a luxury Italian DMC.
Read the brief (Italian or English free text, or a supplier/agency quote PDF) and return ONLY a JSON object, no markdown:
{
  "title": string,            // short English event title, e.g. "Two Days in Rome"
  "client": string,           // "" if not stated
  "destination": string,      // main city in English
  "country": string,          // in English
  "dates": string,            // as stated, in English (e.g. "October 2027"); "" if not stated
  "guests": number,           // 0 if not stated
  "nights": number,           // nights stated; if not stated, use the number of programme days
  "rooms": string,            // room split as stated (e.g. "50 single rooms (DUS)"); "" if not stated
  "hotels": [ { "name": string, "queries": [string] } ],
  "days": [ { "label": "Day 1", "date": string, "slots": [
      { "kind": "Lunch" | "Activity" | "Dinner" | "Aperitif" | "Meeting" | "Transfer" | "Other",
        "options": [ { "name": string, "queries": [string], "notes": string, "quotedRows": [] } ] } ] } ],
  "extras": [ { "name": string, "label": string, "queries": [string], "quotedRows": [] } ],
  "pricesIncludeVat": boolean,
  "assumptions": [string]      // in Italian, what you had to assume
}
Rules:
- Keep EVERY alternative the brief lists ("A o B", "Option 1/2/3", "oppure"): each one is a separate entry in options[], in the order given. Never pick one and drop the others.
- "name": the venue/supplier/experience name as written, without "Option 1)" prefixes.
- "queries": 1–3 short database search strings for that option: the distinctive name words (e.g. "Meo Patacca"), plus a generic keyword for experiences (e.g. "golf cart", "rafting", "vintage car", "mixology", "cocktail"). No apostrophes.
- Hotels are listed in "hotels", not as slots.
- "extras": services with no alternative that must always be charged (transfers, guides, staff, city tax if quoted). Do not invent extras that are not in the brief or quote.
- "quotedRows": ONLY when the source is a quote with prices: [{"desc","details","qty","vat","unit"}] exactly as written for that supplier (numbers as numbers, unit = unit price). Otherwise [].
- "pricesIncludeVat": true only if the quote states unit prices include VAT.`;

// Chiamata a Claude (sostituibile nei test)
async function defaultClaude({ apiKey, system, content, maxTokens, label }) {
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  const resp = await client.messages.create({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] });
  console.log(`[offer] ${label} ${Date.now() - t0}ms, ${resp.usage?.output_tokens} tok, stop=${resp.stop_reason}`);
  if (resp.stop_reason === "max_tokens") throw new Error(`risposta AI troncata (${label})`);
  return resp.content[0].text;
}

export async function planOffer({ apiKey, text, pdfBase64, claude = defaultClaude }) {
  const content = pdfBase64
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
       { type: "text", text: "Plan the offer from this quote. Return the JSON." }]
    : [{ type: "text", text: `Brief:\n\n${text}\n\nReturn the JSON.` }];
  return extractJsonObject(await claude({ apiKey, system: PLAN_PROMPT, content, maxTokens: 6000, label: "plan" }));
}

// ─── Step 2: gather ───────────────────────────────────────────────────────────
export async function gatherSuppliers(plan) {
  const refs = [];
  (plan.hotels || []).forEach((h, i) => refs.push({ ref: `H${i + 1}`, name: h.name, queries: h.queries?.length ? h.queries : [h.name], quotedRows: h.quotedRows || [] }));
  (plan.days || []).forEach((d, di) => (d.slots || []).forEach((s, si) => (s.options || []).forEach((o, oi) =>
    refs.push({ ref: `D${di + 1}S${si + 1}O${oi + 1}`, name: o.name, queries: o.queries?.length ? o.queries : [o.name], quotedRows: o.quotedRows || [] }))));
  (plan.extras || []).forEach((x, i) => refs.push({ ref: `X${i + 1}`, name: x.name, queries: x.queries?.length ? x.queries : [x.name], quotedRows: x.quotedRows || [] }));

  const index = await loadIndex();
  const picks = refs.map(r => rankCandidates(index, [r.name, ...r.queries], plan.destination));
  const uniq = [...new Map(picks.flat().map(c => [c.id, c])).values()];
  const details = new Map((await loadDetails(uniq)).map(d => [d.id, d]));
  const out = {};
  refs.forEach((r, i) => {
    out[r.ref] = { ...r, candidates: picks[i].map((c, k) => ({ ...details.get(c.id), key: `${r.ref}C${k + 1}` })).filter(c => c.id) };
  });
  return out;
}

function candidatesText(gathered) {
  const lines = [];
  for (const [ref, g] of Object.entries(gathered)) {
    lines.push(`### ${ref} — brief name: "${g.name}"${g.quotedRows?.length ? ` — QUOTED ROWS (sale prices): ${JSON.stringify(g.quotedRows)}` : ""}`);
    if (!g.candidates.length) { lines.push("(no database match)"); continue; }
    for (const c of g.candidates) {
      lines.push(`[${c.key}] ${c.name}${c.parentName ? ` (operated by ${c.parentName})` : ""} · ${c.kind} · ${c.type || ""} · ${c.city || ""}`);
      const facts = [c.address && `address: ${c.address}`, c.website && `website: ${c.website}`, c.capacity && `capacity: ${c.capacity}`, c.rooms && `rooms: ${c.rooms}`, c.duration && `duration: ${c.duration}`, `photos available: ${c.photos.length}`].filter(Boolean);
      lines.push("  " + facts.join(" | "));
      if (c.description) lines.push("  description: " + c.description.replace(/\s+/g, " "));
      if (c.priceLines.length) {
        lines.push("  price lines (supplier NET costs, never show them as such):");
        for (const p of c.priceLines) {
          lines.push("   - " + [p.line, p.category && `[${p.category}]`, p.amount != null && `amount ${p.amount}`, p.net != null && `net ${p.net}`, `VAT ${p.vat || "?"}`, p.vatIncluded && "VAT INCLUDED", p.unit && `unit: ${p.unit}`,
            p.quotedGuests && `quoted guests ${p.quotedGuests}`, p.minQty && `min qty ${p.minQty}`, p.vehicles && `vehicles ${p.vehicles}`, p.hours && `${p.hours}h`,
            p.status && `status ${p.status}`, (p.validFrom || p.validUntil) && `valid ${p.validFrom || "?"}→${p.validUntil || "?"}`,
            p.terms && `terms: ${p.terms}`, p.included && `incl: ${p.included}`, p.excluded && `excl: ${p.excluded}`].filter(Boolean).join(" | "));
        }
      } else lines.push("  price lines: none");
    }
  }
  return lines.join("\n");
}

// ─── Step 3: compose ──────────────────────────────────────────────────────────
const COMPOSE_PROMPT = `You are the senior proposal writer of Love IT DMC (luxury Italian DMC). Build a multi-day client offer from the PLAN and the DATABASE CANDIDATES.
Return ONLY a JSON object (no markdown):
{
  "title": string,
  "coverSubtitle": string,          // e.g. "Incentive Programme · 50 Guests · October 2027"
  "coverPhotoQuery": string,        // English Unsplash query for an iconic, wide destination photo
  "destination": { "name": string, "description": string, "highlights": [string], "photoQuery": string },
  "hotels": [ HOTEL ],
  "days": [ { "label": "Day 1", "date": string, "title": string, "photoQuery": string,
              "glance": { "morning": string, "afternoon": string, "evening": string },
              "moments": [ { "time": "Lunch", "text": string } ],
              "items": [ ITEM ] } ],
  "extras": [ { "ref": string, "candidate": string|null, "name": string, "label": string, "website": string, "rows": [ ROW ] } ],
  "footnote": string,
  "terms": [ ["Validity", string], ["Availability", string], ["Payment", string] ],
  "closingLine": string,             // e.g. "One unforgettable Rome."
  "staffNotes": [string]             // IN ITALIAN, for the Love IT staff only: prices missing, season mismatch, VAT assumed, minimum guarantees, informal prices, names not found in the database, photos missing
}
HOTEL = { "ref": "H1", "candidate": "<candidate key or null>", "option": "Option A", "name": string, "sub": string, "pitch": string, "description": string,
          "facts": [[label, value]], "recommended": boolean, "website": string, "rows": [ ROW ] }
ITEM  = { "ref": "D1S1O1", "candidate": "<candidate key or null>", "slot": "d1lunch", "kind": "Lunch", "option": "Option A", "name": string, "sub": string,
          "description": string, "facts": [[label, value]], "recommended": boolean, "label": "Day 1 · Lunch", "website": string, "rows": [ ROW ] }
ROW   = { "desc": string, "details": string, "qty": number, "vat": "10%"|"22%"|"Exempt", "net": number|null, "sale": number|null }

Rules (non-negotiable):
- All client copy in ENGLISH. Never mention costs, margin, markup or commission in the copy.
- Every plan option becomes exactly one ITEM (same order inside a slot); every plan hotel one HOTEL. Never drop an alternative.
- "candidate": the key of the database record that really is this supplier/experience in this destination (check name AND city: e.g. a "Vintage Car Tour – Tuscany" is NOT a Rome tour). null if none fits. Only use facts from the chosen candidate or the brief.
- Never invent facts (capacity, room counts, inclusions, durations, vehicles, addresses). Leave a fact out rather than writing an empty or vague one. Facts: 1–3 short, useful pairs (e.g. ["Location","Via dei Gracchi 324, Rome"], ["Rooms","257"], ["Your rooms","50 single rooms (DUS), 2 nights, breakfast included"], ["Duration","3 hours"], ["Group","Up to 36 per session: two sessions for 50 guests"]).
- "description": 2–3 factual sentences in a refined tone, no superlatives, based on the candidate description; mention the planned format (menu, tasting, duration) when the price line tells it.
- "sub": short location/descriptor line (e.g. "Via del Conservatorio 58 · Historic centre", "Prati district · 4★").
- "recommended": exactly one per slot (and one among hotels): the best fit for the group (central location, value, quality). Put the recommended one FIRST in its slot and name options "Option A", "Option B", … in the final order.
- "slot": same id for all alternatives of the same choice, e.g. "d1lunch", "d1activity", "d1dinner", "d2dinner". "label": e.g. "Day 2 · Dinner".
- ROWS: choose the price lines that match this programme (right service, right season if possible, latest valid rate) and set quantities for the group:
  • per person → qty = guests; rooms per room/night → qty = rooms × nights; per vehicle/van/cart → number needed (state capacity in details); flat/per event → 1.
  • Minimum guarantees: if the venue minimum exceeds the group, qty = the minimum and say so in details and facts.
  • Sessions: when an activity has a max group size, say how many sessions in details/facts.
  • "net": the supplier NET unit price EXCLUDING VAT. Use "Net Price" if present, else "Amount"; if the line says VAT INCLUDED (or "(VAT included)"), divide by (1+VAT). If a quoted group total is given, convert to the unit you charge.
  • "vat": the rate stated; if unknown use 10% for food & beverage / restaurants / hotels and 22% for activities, services, rentals, staff; city tax "Exempt". Mention assumed VAT in staffNotes.
  • "sale": ONLY for QUOTED ROWS from the brief/quote (already a client price): the unit price exactly as quoted; then "net": null.
  • No usable price → "rows": [] and mention it in staffNotes. Never invent a price.
  • "desc" short and client-friendly (e.g. "VIP lunch with four-wine tasting", "Single room (DUS), breakfast included"); no supplier-internal wording, no dates of old quotes.
- City tax: if the recommended hotel (or any hotel) has a city/tourist tax price line, add ONE extra { "ref": "TAX", "candidate": null, "name": "<City> city tax", "label": "City tax", "website": "", rows: [{ desc "<City> city tax", details "€x per person per night", qty guests × nights, vat "Exempt", net = the tax per person per night }] }. Otherwise mention in staffNotes that city tax is not included.
- Rooms: if the brief gives no split, assume one single room (DUS) per guest for the stated nights and say it in staffNotes.
- glance: short phrases per part of the day ("—" when nothing), e.g. "Lunch · Golf cart tour or urban rafting". moments: one per slot, text "X or Y".
- day "title": evocative but plain, max 7 words (e.g. "Wine, golf carts and a rooftop dinner").
- footnote: one or two sentences: indicative prices for <dates>, VAT included, based on <guests> guests, to be reconfirmed in writing; transfers and services not shown are not included.`;

export async function composeOffer({ apiKey, plan, gathered, priceMode, claude = defaultClaude }) {
  const user = `PLAN:\n${JSON.stringify(plan)}\n\nPRICE MODE: ${priceMode === "sale" ? "the brief is a quote with client sale prices: use QUOTED ROWS as \"sale\" and do not use database prices for those suppliers" : "use database NET prices (\"net\"); the system adds margin and VAT"}\n\nDATABASE CANDIDATES:\n${candidatesText(gathered)}\n\nReturn the JSON.`;
  return extractJsonObject(await claude({ apiKey, system: COMPOSE_PROMPT, content: user, maxTokens: 16000, label: "compose" }));
}

// ─── Step 4: build TRIP ───────────────────────────────────────────────────────
const VATR = v => /22/.test(v) ? 0.22 : /10/.test(v) ? 0.10 : /4%/.test(v) ? 0.04 : 0;

export function clientUnit(row, margin, pricesIncludeVat) {
  if (row.sale != null && row.sale !== "") {
    const s = Number(row.sale);
    if (!isFinite(s)) return null;
    return round2(pricesIncludeVat ? s : s * (1 + VATR(row.vat)));
  }
  if (row.net == null || row.net === "" || !isFinite(Number(row.net))) return null;
  const exempt = /exempt/i.test(row.vat || "");
  return round2(Number(row.net) * (exempt ? 1 : (1 + margin)) * (1 + VATR(row.vat)));
}

export async function buildTripOffer({ plan, composed, gathered, margin, pricesIncludeVat }) {
  const candByKey = {};
  Object.values(gathered).forEach(g => g.candidates.forEach(c => { candByKey[c.key] = c; }));
  const used = new Set();
  const takePhotos = (cand, n) => {
    const out = [];
    for (const u of (cand?.photos || [])) { if (out.length >= n) break; if (!used.has(u)) { used.add(u); out.push(u); } }
    return out;
  };
  const suppliers = [];
  const mkRows = rows => (rows || []).map(r => [r.desc || "", r.details || "", Number(r.qty) || 1, r.vat || "", clientUnit(r, margin, pricesIncludeVat)]);
  const mkSupplier = (id, src, extra) => {
    const cand = candByKey[src.candidate] || null;
    suppliers.push({
      id, name: src.name, website: String(src.website || cand?.website || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
      label: src.label || extra.label || "", slot: extra.slot || null, recommended: !!src.recommended,
      rows: mkRows(src.rows),
    });
    return cand;
  };

  const hotels = (composed.hotels || []).map((h, i) => {
    const id = `hotel${i + 1}`;
    const cand = mkSupplier(id, h, { label: "Accommodation", slot: (composed.hotels.length > 1 ? "hotel" : null) });
    const ph = takePhotos(cand, 5);
    return { option: composed.hotels.length > 1 ? (h.option || "") : "", name: h.name, supplierName: h.name, sub: h.sub || "", pitch: h.pitch || "",
      description: h.description || "", facts: (h.facts || []).filter(f => f && f[1]), supplier: id,
      photo: ph[0] || null, cardPhoto: ph[0] || null, gallery: ph.length >= 4 ? ph.slice(1, 5) : null };
  });

  const days = await Promise.all((composed.days || []).map(async (d, di) => {
    const items = (d.items || []).map((it, ii) => {
      const id = `d${di + 1}i${ii + 1}`;
      const cand = mkSupplier(id, it, { label: it.label || `${d.label} · ${it.kind || ""}`, slot: it.slot || null });
      const ph = takePhotos(cand, 5);
      return { kind: it.kind || "", option: it.option || "", name: it.name, supplierName: it.name, sub: it.sub || "",
        description: it.description || "", facts: (it.facts || []).filter(f => f && f[1]), supplier: id,
        photo: ph[0] || null, gallery: ph.length >= 4 ? ph.slice(1, 5) : null };
    });
    const photo = (await unsplash(d.photoQuery)) || null;
    return { label: d.label || `Day ${di + 1}`, date: d.date || plan.dates || "", title: d.title || "", photo,
      glance: d.glance || {}, moments: d.moments || [], items };
  }));
  // Un solo slot con una sola opzione non è un'alternativa
  const slotCount = {};
  suppliers.forEach(s => { if (s.slot) slotCount[s.slot] = (slotCount[s.slot] || 0) + 1; });
  suppliers.forEach(s => { if (s.slot && slotCount[s.slot] === 1) { s.slot = null; s.recommended = false; } });
  // Esattamente un "recommended" per slot
  Object.keys(slotCount).forEach(k => {
    const list = suppliers.filter(s => s.slot === k);
    if (list.length > 1 && !list.some(s => s.recommended)) list[0].recommended = true;
    const r = list.findIndex(x => x.recommended);
    list.forEach((s, i) => { s.recommended = i === r; });
  });

  // Voce senza vere alternative: niente etichetta "Option A"
  const supById = Object.fromEntries(suppliers.map(s => [s.id, s]));
  days.forEach(d => d.items.forEach(it => { if (!supById[it.supplier]?.slot) it.option = ""; }));
  if (hotels.length < 2) hotels.forEach(h => { h.option = ""; });

  (composed.extras || []).forEach((x, i) => {
    if (!(x.rows || []).length) return;
    mkSupplier(`extra${i + 1}`, { ...x, recommended: false }, { label: x.label || x.name, slot: null });
  });

  // Fornitori senza slot (city tax, extra) subito dopo gli hotel, come nel deck di riferimento
  const order = s => s.id.startsWith("hotel") ? 0 : s.id.startsWith("extra") ? 1 : 2;
  suppliers.sort((a, b) => order(a) - order(b));

  const [coverPhoto, destPhoto] = await Promise.all([unsplash(composed.coverPhotoQuery), unsplash(composed.destination?.photoQuery)]);
  const anyPhoto = hotels.find(h => h.photo)?.photo || days.flatMap(d => d.items).find(i => i.photo)?.photo || null;
  days.forEach(d => { if (!d.photo) d.photo = d.items.find(i => i.photo)?.photo || anyPhoto; });

  const offer = {
    title: composed.title || plan.title || "",
    guests: Number(plan.guests) || 0,
    cover: { photo: coverPhoto || anyPhoto, eyebrow: "EVENT PROPOSAL", subtitle: composed.coverSubtitle || "" },
    destination: composed.destination ? { name: composed.destination.name || plan.destination || "", photo: destPhoto || coverPhoto || anyPhoto,
      description: composed.destination.description || "", highlights: (composed.destination.highlights || []).slice(0, 4) } : null,
    hotels, days, suppliers,
    footnote: composed.footnote || "",
    terms: composed.terms || [],
    closingLine: composed.closingLine || `One unforgettable ${plan.destination || "Italy"}.`,
  };
  return {
    client: plan.client || "", projectRef: "", title: offer.title,
    destination: plan.destination || "", country: plan.country || "Italy", dates: plan.dates || "",
    nights: Number(plan.nights) || 0, pax: offer.guests, tagline: "",
    cityPhoto: offer.cover.photo || "",
    // giorni "classici" minimi: servono solo a contatori/archivio, il deck usa TRIP.offer
    days: offer.days.map((d, i) => ({ number: i + 1, date: d.date, label: d.title, activities: [] })),
    closing: { photo: "", headline: offer.closingLine, subline: "", contact: "info@loveit-dmc.com" },
    offer,
    staffNotes: [...(plan.assumptions || []), ...(composed.staffNotes || [])],
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
export async function generateOfferTrip({ apiKey, text, pdfBase64, margin = 0.25, claude = defaultClaude }) {
  const t0 = Date.now();
  const plan = await planOffer({ apiKey, text, pdfBase64, claude });
  const gathered = await gatherSuppliers(plan);
  console.log(`[offer] gather done ${Date.now() - t0}ms`);
  const hasQuoted = Object.values(gathered).some(g => g.quotedRows?.length);
  const composed = await composeOffer({ apiKey, plan, gathered, priceMode: hasQuoted ? "sale" : "net", claude });
  const trip = await buildTripOffer({ plan, composed, gathered, margin, pricesIncludeVat: !!plan.pricesIncludeVat });
  console.log(`[offer] total ${Date.now() - t0}ms`);
  return trip;
}

// ─── Risposta HTTP comune (inietta TRIP nel template) ─────────────────────────
function findTripBounds(html) {
  const marker = "const TRIP = {";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("TRIP marker not found in template");
  let i = start + "const TRIP = ".length, depth = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < html.length) { if (html[i] === "\\") { i += 2; continue; } if (html[i] === q) break; i++; }
    } else if (ch === "/" && html[i + 1] === "/") { while (i < html.length && html[i] !== "\n") i++; }
    else if (ch === "/" && html[i + 1] === "*") { i += 2; while (i < html.length && !(html[i] === "*" && html[i + 1] === "/")) i++; i++; }
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { let end = i + 1; while (end < html.length && /\s/.test(html[end])) end++; if (html[end] === ";") end++; return { start, end }; } }
    i++;
  }
  throw new Error("TRIP block closing brace not found");
}

export function parseMargin(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!isFinite(n) || n < 0 || n > 200) return 0.25;
  return n / 100;
}

export function offerResponse({ template, trip, req, filenameBase }) {
  trip.deckTemplate = "quotation";
  const { start, end } = findTripBounds(template);
  // "</script" dentro una stringa chiuderebbe il tag: neutralizzato
  const json = JSON.stringify(trip, null, 2).replace(/<\/script/gi, "<\\/script");
  let html = template.slice(0, start) + `const TRIP = ${json};` + template.slice(end);
  const proto = req.headers["x-forwarded-proto"] || "https";
  html = html.replace("</head>", `<script>window.LOVEIT_API_BASE="${proto}://${req.headers.host}";</script>\n</head>`);
  const safe = String(filenameBase || trip.title || "offerta").replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 70);
  return {
    html, filename: `${safe}_offerta.html`,
    client: trip.client || "", destination: trip.destination || "", title: trip.title || "",
    pax: trip.pax || 0, dayCount: (trip.offer?.days || []).length,
    staffNotes: trip.staffNotes || [],
  };
}
