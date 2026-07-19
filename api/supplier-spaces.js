// GET /api/supplier-spaces?supplier=Hilton+Sorrento+Palace
// Finds the supplier, fetches its linked Meeting Rooms with photos.
// Returns: { supplierName, rooms: [{ name, setting, area, banquet, theatre, cocktail, classroom, boardroom, notes, photo }] }

const BASE_ID        = process.env.AIRTABLE_BASE_ID;
const TABLE_SUPPLIERS = "tbl3rEBd03iC29uNb";   // Suppliers
const TABLE_ROOMS     = "tbl4JXVw0K9Sz0dHC";   // Meeting Rooms
const TABLE_MEDIA     = "tblpKKKum1aFwPjgY";    // Media

// Field IDs — Suppliers
const F_SUP_NAME  = "fldf1guJqLASjc0sP";  // Name
const F_SUP_ROOMS = "fldSovyZuFZCp9N6Q";  // Meeting Rooms (linked)

// Field IDs — Meeting Rooms
const F_ROOM_NAME      = "fldeg4uG2doJWRJfO";  // Meeting Room Name
const F_ROOM_SETTING   = "fldqEbguUNAeGuVcb";  // Setting (singleSelect)
const F_ROOM_AREA      = "fld7TGupUXKEhv0gl";  // Area m²
const F_ROOM_BANQUET   = "fldDUuQ6PR0Gj9fN5";  // Banquet Capacity
const F_ROOM_THEATRE   = "fldNd8cMq8sipBF8w";  // Theatre Capacity
const F_ROOM_COCKTAIL  = "fldAuEO7MPwruK8Mx";  // Cocktail Capacity
const F_ROOM_CLASSROOM = "fldkf0aJv1v4J9i6i";  // Classroom Capacity
const F_ROOM_BOARDROOM = "fldcUw6U2vGvm7JtS";  // Boardroom Capacity
const F_ROOM_NOTES     = "fldaASdJjqXRIycfk";  // Operational Notes
const F_ROOM_MEDIA     = "fldnvvLqifmGnGn5n";  // Media (linked)

// Field IDs — Media
const F_MEDIA_FILE = "fldqQsLLwleNQAART";  // File (attachments)

async function atFetch(url, token) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── STOP WORDS (Italian + English articles/prepositions) ────────────────────
const STOP = new Set([
  "the","and","its","of","at","per","del","dei","della","delle","degli","di","da",
  "in","con","su","tra","fra","al","alle","agli","allo","dal","dalla","dagli","dalle",
  "la","lo","le","il","gli","un","una","uno","i","e","o",
]);

function keywords(name) {
  return name.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => w.replace(/"/g, '\\"'));
}

function matchScore(queryName, airtableName) {
  const kw = keywords(queryName);
  if (!kw.length) return 0;
  const hay = airtableName.toLowerCase();
  return kw.filter(w => hay.includes(w)).length / kw.length;
}

// ─── STEP 1: Find supplier record by name ────────────────────────────────────
async function findSupplierRecord(supplierName, token) {
  const kw = keywords(supplierName);
  if (!kw.length) throw new Error("Supplier name too short or ambiguous");

  const orClauses = kw.map(w => `SEARCH("${w}", LOWER({Name}))>0`).join(",");
  const formula   = encodeURIComponent(`OR(${orClauses})`);
  const fields    = [F_SUP_NAME, F_SUP_ROOMS].map(f => `fields[]=${f}`).join("&");
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SUPPLIERS}?filterByFormula=${formula}&maxRecords=8&${fields}`;

  const data = await atFetch(url, token);
  const records = data.records || [];
  if (!records.length) return null;

  // Try exact match first
  const inputLower = supplierName.toLowerCase();
  const exact = records.find(r => (r.fields[F_SUP_NAME] || "").toLowerCase() === inputLower);
  if (exact) return exact;

  // Score and pick best
  const scored = records
    .map(r => ({ r, score: matchScore(supplierName, r.fields[F_SUP_NAME] || "") }))
    .filter(({ score }) => score >= 0.5)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.r || null;
}

// ─── STEP 2: Fetch Meeting Room records by ID list ────────────────────────────
async function fetchRooms(roomIds, token) {
  if (!roomIds.length) return [];

  // Airtable allows up to ~100 RECORD_ID clauses — batch if needed
  const batches = [];
  for (let i = 0; i < roomIds.length; i += 50) batches.push(roomIds.slice(i, i + 50));

  const allRooms = [];
  const fieldList = [
    F_ROOM_NAME, F_ROOM_SETTING, F_ROOM_AREA,
    F_ROOM_BANQUET, F_ROOM_THEATRE, F_ROOM_COCKTAIL,
    F_ROOM_CLASSROOM, F_ROOM_BOARDROOM, F_ROOM_NOTES, F_ROOM_MEDIA,
  ].map(f => `fields[]=${f}`).join("&");

  for (const batch of batches) {
    const idClauses = batch.map(id => `RECORD_ID()="${id}"`).join(",");
    const formula   = encodeURIComponent(`OR(${idClauses})`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ROOMS}?filterByFormula=${formula}&${fieldList}&maxRecords=50`;
    const data = await atFetch(url, token);
    allRooms.push(...(data.records || []));
  }

  return allRooms;
}

// ─── STEP 3: Fetch first photo for each Media record ─────────────────────────
async function fetchMediaPhotos(mediaIds, token) {
  if (!mediaIds.length) return new Map();

  const idClauses = mediaIds.map(id => `RECORD_ID()="${id}"`).join(",");
  const formula   = encodeURIComponent(`OR(${idClauses})`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_MEDIA}?filterByFormula=${formula}&fields[]=${F_MEDIA_FILE}&maxRecords=200`;

  const data = await atFetch(url, token);
  const map = new Map();
  for (const mr of (data.records || [])) {
    const files = mr.fields[F_MEDIA_FILE] || [];
    // Pick first image file (skip video-only records)
    const imgFile = files.find(f => !/\.(mp4|webm|ogg)(\?|$)/i.test(f.filename || ""));
    if (imgFile?.url) map.set(mr.id, imgFile.url);
  }
  return map;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")    return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token || !BASE_ID) return res.status(500).json({ error: "Missing Airtable config" });

  const supplierParam = (req.query.supplier || "").trim();
  if (!supplierParam) return res.status(400).json({ error: "Missing supplier query param" });

  // Step 1 — find supplier
  let supplierRecord;
  try {
    supplierRecord = await findSupplierRecord(supplierParam, token);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }
  if (!supplierRecord) return res.status(404).json({ error: `Supplier not found: ${supplierParam}` });

  const supplierName = supplierRecord.fields[F_SUP_NAME] || supplierParam;
  const roomIds = (supplierRecord.fields[F_SUP_ROOMS] || []);
  if (!roomIds.length) return res.status(200).json({ supplierName, rooms: [] });

  // Step 2 — fetch room records
  let roomRecords;
  try {
    roomRecords = await fetchRooms(roomIds, token);
  } catch (e) {
    return res.status(502).json({ error: `Room fetch error: ${e.message}` });
  }

  // Step 3 — collect all Media IDs referenced by rooms → fetch photos
  const allMediaIds = [...new Set(
    roomRecords.flatMap(r => r.fields[F_ROOM_MEDIA] || [])
  )];
  let mediaMap = new Map();
  try {
    mediaMap = await fetchMediaPhotos(allMediaIds, token);
  } catch {
    // Non-fatal — rooms without photos still show
  }

  // Step 4 — build response, preserving original Airtable order (roomIds order)
  const roomById = new Map(roomRecords.map(r => [r.id, r]));
  const rooms = roomIds
    .map(id => roomById.get(id))
    .filter(Boolean)
    .map(r => {
      const f = r.fields;
      // First photo from first linked Media record
      const firstMediaId = (f[F_ROOM_MEDIA] || [])[0];
      const photo = firstMediaId ? (mediaMap.get(firstMediaId) || null) : null;
      return {
        id:        r.id,
        name:      f[F_ROOM_NAME]      || "",
        setting:   f[F_ROOM_SETTING]?.name || null,
        area:      f[F_ROOM_AREA]      || null,
        banquet:   f[F_ROOM_BANQUET]   || null,
        theatre:   f[F_ROOM_THEATRE]   || null,
        cocktail:  f[F_ROOM_COCKTAIL]  || null,
        classroom: f[F_ROOM_CLASSROOM] || null,
        boardroom: f[F_ROOM_BOARDROOM] || null,
        notes:     f[F_ROOM_NOTES]     || null,
        photo,
      };
    })
    .filter(r => r.name);

  return res.status(200).json({ supplierName, rooms });
}
