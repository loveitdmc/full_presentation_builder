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
