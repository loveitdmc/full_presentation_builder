// ─── AIRTABLE CONSTANTS ───────────────────────────────────────────────────────
const TABLE_ACTS       = "tblbCAthb1HXfc13i";   // Artists & Shows
const TABLE_ACTIVITIES = "tblPIbMu1UDjOLYIK";   // Activities
const TABLE_MEDIA      = "tblpKKKum1aFwPjgY";    // Media

// Per-kind config: table + field names (encoded at use time)
const KINDS = {
  artists: {
    table: TABLE_ACTS,
    nameField:  "Artist or Show Name",
    tagField:   "Artist & Show Tags",
    mediaField: "Consolidated Media",
    responseKey: "artists",
  },
  activities: {
    table: TABLE_ACTIVITIES,
    nameField:  "Activity or Service Name",
    tagField:   "Activity Type",
    mediaField: "Media",
    responseKey: "activities",
  },
};

async function airtableFetch(url, token) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// ── v61/v62 — "Le mie presentazioni": lettura di Presentations e Projects ───
// (Love IT Projects, non Fornitori — stessa base/tabella scritta da §4.4).
const PROJECTS_BASE_ID    = "appdvIG3LsRARALRP";
const TABLE_PRESENTATIONS = "tblqE4NEkpj28xH8f";
const TABLE_PROJECTS      = "tbluxqrkeHZXliVTH";

async function handleArchiveList(res) {
  const token = process.env.AIRTABLE_PROJECTS_TOKEN || process.env.AIRTABLE_TOKEN;
  if (!token) return res.status(500).json({ error: "Configurazione Airtable mancante." });
  const fields = ["Title", "Template", "Suppliers", "Created At", "Created By", "File", "Project", "Deleted At"]
    .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  // v62 — nel cestino (Deleted At impostato) non compare nell'elenco, stessa
  // convenzione delle altre tabelle di questa base.
  const formula = encodeURIComponent(`{Deleted At}=BLANK()`);
  const url = `https://api.airtable.com/v0/${PROJECTS_BASE_ID}/${TABLE_PRESENTATIONS}`
    + `?${fields}&filterByFormula=${formula}&sort[0][field]=${encodeURIComponent("Created At")}&sort[0][direction]=desc&maxRecords=100`;
  try {
    const data = await airtableFetch(url, token);
    const records = data.records || [];

    // Nomi dei progetti collegati — una sola richiesta batch, come per i
    // thumbnail dei Media più sopra.
    const projectIds = [...new Set(records.flatMap(r => r.fields["Project"] || []))].slice(0, 100);
    const projectMap = new Map();
    if (projectIds.length) {
      try {
        const idsClause = projectIds.map(id => `RECORD_ID()="${id}"`).join(",");
        const purl = `https://api.airtable.com/v0/${PROJECTS_BASE_ID}/${TABLE_PROJECTS}?filterByFormula=${encodeURIComponent(`OR(${idsClause})`)}&fields[]=${encodeURIComponent("Project Name")}&maxRecords=100`;
        const pData = await airtableFetch(purl, token);
        for (const pr of (pData.records || [])) projectMap.set(pr.id, pr.fields["Project Name"] || "");
      } catch { /* nome progetto opzionale — l'elenco resta utile senza */ }
    }

    const items = records.map(r => {
      const projId = (r.fields["Project"] || [])[0] || null;
      return {
        id:          r.id,
        title:       r.fields["Title"] || "(senza titolo)",
        template:    r.fields["Template"] || "dark",
        suppliers:   (r.fields["Suppliers"] || "").split("\n").map(s => s.trim()).filter(Boolean),
        createdAt:   r.fields["Created At"] || null,
        createdBy:   r.fields["Created By"] || null,
        fileUrl:     r.fields["File"] || null,
        projectId:   projId,
        projectName: projId ? (projectMap.get(projId) || null) : null,
      };
    });
    return res.status(200).json({ items });
  } catch (e) {
    if (/Airtable 40[34]/.test(e.message)) {
      return res.status(502).json({ error: "Il token Airtable non ha accesso in lettura alla base Love IT Projects." });
    }
    return res.status(502).json({ error: `Archivio non raggiungibile: ${e.message}` });
  }
}

// v62 — elenco progetti per il selettore opzionale al momento del salvataggio.
async function handleArchiveProjects(res) {
  const token = process.env.AIRTABLE_PROJECTS_TOKEN || process.env.AIRTABLE_TOKEN;
  if (!token) return res.status(500).json({ error: "Configurazione Airtable mancante." });
  const fields = ["Project Name", "Destination", "Deleted At"].map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const formula = encodeURIComponent(`{Deleted At}=BLANK()`);
  const url = `https://api.airtable.com/v0/${PROJECTS_BASE_ID}/${TABLE_PROJECTS}`
    + `?${fields}&filterByFormula=${formula}&sort[0][field]=${encodeURIComponent("Project Name")}&maxRecords=200`;
  try {
    const data = await airtableFetch(url, token);
    const items = (data.records || [])
      .map(r => ({ id: r.id, name: r.fields["Project Name"] || "(senza nome)", destination: r.fields["Destination"] || "" }))
      .filter(p => p.name);
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: `Elenco progetti non raggiungibile: ${e.message}` });
  }
}

// v64 — svuotamento del cestino: le presentazioni cancellate (Deleted At
// impostato, v62) restano indefinitamente su Airtable finché nessuno le
// tocca — nessuna Automation Airtable ha un'azione "cancella record" nativa
// (verificato: solo create/update/find/sort/email/AI), quindi la cancellazione
// vera passa da qui, su cron giornaliero di Vercel. Protetto da CRON_SECRET:
// senza quella variabile l'endpoint rifiuta sempre, quindi non fa nulla finché
// qualcuno non lo attiva esplicitamente (stesso pattern "spento di default"
// di GOOGLE_CLIENT_ID e BLOB_READ_WRITE_TOKEN).
async function handlePurgePresentations(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(200).json({ ok: false, skipped: "CRON_SECRET non configurato — nessuna cancellazione automatica attiva." });
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Non autorizzato." });

  const token = process.env.AIRTABLE_PROJECTS_TOKEN || process.env.AIRTABLE_TOKEN;
  if (!token) return res.status(500).json({ error: "Configurazione Airtable mancante." });

  // Cancellate da più di 30 giorni: formula Airtable, non calcolata in JS,
  // così il fuso e "adesso" sono sempre quelli del server Airtable.
  const formula = encodeURIComponent(`IS_BEFORE({Deleted At}, DATEADD(NOW(), -30, 'days'))`);
  const fields = ["Deleted At", "File"].map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const url = `https://api.airtable.com/v0/${PROJECTS_BASE_ID}/${TABLE_PRESENTATIONS}?${fields}&filterByFormula=${formula}&maxRecords=200`;

  let records;
  try {
    const data = await airtableFetch(url, token);
    records = data.records || [];
  } catch (e) {
    return res.status(502).json({ error: `Lettura fallita: ${e.message}` });
  }
  if (!records.length) return res.status(200).json({ ok: true, purged: 0 });

  // Blob associato: cancellazione migliore-sforzo, non blocca la cancellazione
  // del record se fallisce (uno storage abbandonato non è pericoloso).
  try {
    const { del } = await import("@vercel/blob");
    const fileUrls = records.map(r => r.fields["File"]).filter(Boolean);
    if (fileUrls.length) await Promise.allSettled(fileUrls.map(u => del(u)));
  } catch { /* Blob non collegato o cancellazione fallita — si prosegue comunque */ }

  // Cancellazione vera dei record, a blocchi di 10 (limite Airtable per richiesta).
  let purged = 0;
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const qs = batch.map(r => `records[]=${encodeURIComponent(r.id)}`).join("&");
    try {
      const r = await fetch(`https://api.airtable.com/v0/${PROJECTS_BASE_ID}/${TABLE_PRESENTATIONS}?${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(9000),
      });
      if (r.ok) purged += batch.length;
    } catch { /* un blocco fallito non blocca gli altri */ }
  }
  return res.status(200).json({ ok: true, purged, found: records.length });
}

// Suppliers filtered by category — thumbnails come straight from the Photos attachments
const TABLE_SUPPLIERS = "tbl3rEBd03iC29uNb";
const SUPPLIER_KINDS = { restaurants: "Restaurant", hotels: "Hotel", venues: "Venue" };

async function handleSuppliersList(category, res, token, baseId) {
  const formula = encodeURIComponent(`FIND("${category}", ARRAYJOIN({Supplier Categories}))>0`);
  const fields  = ["Name", "City", "Photos"].map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  let allRecords = [];
  let offset = "";
  try {
    do {
      const url = `https://api.airtable.com/v0/${baseId}/${TABLE_SUPPLIERS}?filterByFormula=${formula}&${fields}&maxRecords=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
      const data = await airtableFetch(url, token);
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || "";
    } while (offset);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }

  const suppliers = allRecords.map(r => {
    const f = r.fields;
    if (!f.Name) return null;
    const first = (f.Photos || [])[0];
    const thumbnail = first ? (first.thumbnails?.large?.url || first.url) : null;
    return { name: f.Name, type: f.City || "", thumbnail };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ suppliers });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ── §4.1 — Configurazione del login (?auth=config) ──────────────────────────
  // Il client chiede se il Sign-In è attivo. Finché GOOGLE_CLIENT_ID non è
  // configurato su Vercel risponde {enabled:false} e l'app resta com'è oggi.
  if (req.query?.auth === "config") {
    return res.status(200).json({
      enabled:  !!process.env.GOOGLE_CLIENT_ID,
      clientId: process.env.GOOGLE_CLIENT_ID || null,
      domain:   "loveit-dmc.com",
    });
  }

  // ── v64 — Svuotamento cestino presentazioni (?purge=presentations) ──────────
  // Chiamato dal cron di Vercel (vercel.json), mai dall'interfaccia.
  if (req.query?.purge === "presentations") {
    return handlePurgePresentations(req, res);
  }

  // ── §4.4/v61-v62 — Archivio presentazioni (?archive=list|projects) ──────────
  if (req.query?.archive === "list") {
    return handleArchiveList(res);
  }
  if (req.query?.archive === "projects") {
    return handleArchiveProjects(res);
  }

  // ── Image proxy per l'export PPTX (?img=<url>) ──────────────────────────────
  // Le foto Airtable/Unsplash non mandano header CORS: il browser non può
  // leggerle per incorporarle nel .pptx. Questo proxy le rigira con CORS aperto.
  if (req.query?.img) {
    let target;
    try { target = new URL(String(req.query.img)); } catch { return res.status(400).json({ error: "Bad img url" }); }
    const okHost = /(^|\.)airtableusercontent\.com$|(^|\.)unsplash\.com$|(^|\.)googleusercontent\.com$|(^|\.)ytimg\.com$/.test(target.hostname);
    if (target.protocol !== "https:" || !okHost) return res.status(400).json({ error: "Host not allowed" });
    try {
      const r = await fetch(target.href, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return res.status(502).json({ error: `Upstream ${r.status}` });
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(buf);
    } catch (e) {
      return res.status(502).json({ error: `Proxy error: ${e.message}` });
    }
  }

  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return res.status(500).json({ error: "Missing Airtable config" });

  // Supplier category kinds (restaurants / hotels / venues)
  if (SUPPLIER_KINDS[req.query?.kind]) {
    return handleSuppliersList(SUPPLIER_KINDS[req.query.kind], res, token, baseId);
  }

  // Select kind: default artists, ?kind=activities for Activities table
  const kind = KINDS[req.query?.kind] || KINDS.artists;

  // 1. Fetch all records — only the fields we need
  const fieldsParam = [kind.nameField, kind.tagField, kind.mediaField]
    .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  let allRecords = [];
  let offset = "";
  try {
    do {
      const url = `https://api.airtable.com/v0/${baseId}/${kind.table}?${fieldsParam}&maxRecords=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
      const data = await airtableFetch(url, token);
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || "";
    } while (offset);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }

  // 2. Collect Media IDs for thumbnail lookup — up to 8 per record, because the
  // first linked media may have no File attachment (e.g. shared/generic assets)
  const firstMediaIds = [...new Set(
    allRecords.flatMap(r => (r.fields[kind.mediaField] || []).slice(0, 8))
  )].slice(0, 190);

  // 3. Batch fetch those Media records (one request for all)
  const mediaMap = new Map(); // mediaId → thumbnailUrl
  if (firstMediaIds.length > 0) {
    try {
      const idsClause = firstMediaIds.map(id => `RECORD_ID()="${id}"`).join(",");
      const mediaUrl = `https://api.airtable.com/v0/${baseId}/${TABLE_MEDIA}?filterByFormula=${encodeURIComponent(`OR(${idsClause})`)}&fields[]=File&maxRecords=200`;
      const mData = await airtableFetch(mediaUrl, token);
      for (const mr of (mData.records || [])) {
        const firstFile = (mr.fields.File || [])[0];
        if (firstFile?.url) mediaMap.set(mr.id, firstFile.url);
      }
    } catch {
      // thumbnails optional — proceed without
    }
  }

  // 4. Build list (works for both multipleSelects arrays and singleSelect strings)
  const items = allRecords.map(r => {
    const f = r.fields;
    const name = f[kind.nameField] || "";
    if (!name) return null;
    const rawTag = f[kind.tagField];
    const tags = Array.isArray(rawTag) ? rawTag.join(", ")
      : (typeof rawTag === "object" && rawTag?.name) ? rawTag.name
      : (rawTag || "");
    // First linked media that actually has a File attachment
    const thumbId = (f[kind.mediaField] || []).find(id => mediaMap.has(id));
    const thumbnail = thumbId ? mediaMap.get(thumbId) : null;
    return { name, type: tags, thumbnail };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ [kind.responseKey]: items });
}
