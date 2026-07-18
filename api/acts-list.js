// ─── AIRTABLE CONSTANTS ───────────────────────────────────────────────────────
const TABLE_ACTS  = "tblbCAthb1HXfc13i";   // Artists
const TABLE_MEDIA = "tblpKKKum1aFwPjgY";    // Media

// Field names — use encodeURIComponent to handle spaces and commas correctly
const FIELD_NAME  = encodeURIComponent("Artist or Act Name");
const FIELD_TAGS  = encodeURIComponent("Artist Tags");
const FIELD_MEDIA = encodeURIComponent("Consolidated Media");

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return res.status(500).json({ error: "Missing Airtable config" });

  // 1. Fetch all Artist records — only the fields we need
  const fieldsParam = `fields[]=${FIELD_NAME}&fields[]=${FIELD_TAGS}&fields[]=${FIELD_MEDIA}`;
  let allRecords = [];
  let offset = "";
  try {
    do {
      const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ACTS}?${fieldsParam}&maxRecords=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
      const data = await airtableFetch(url, token);
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || "";
    } while (offset);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }

  // 2. Collect unique first-Media IDs for thumbnail lookup
  const firstMediaIds = [...new Set(
    allRecords.map(r => (r.fields.Media || [])[0]).filter(Boolean)
  )];

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

  // 4. Build artist list
  const artists = allRecords.map(r => {
    const f = r.fields;
    const name = f["Artist or Act Name"] || "";
    if (!name) return null;
    // Artist Tags is a multipleSelects — array of strings
    const tags = Array.isArray(f["Artist Tags"]) ? f["Artist Tags"].join(", ") : (f["Artist Tags"] || "");
    const firstMediaId = (f["Consolidated Media"] || [])[0];
    const thumbnail = firstMediaId ? (mediaMap.get(firstMediaId) || null) : null;
    return { name, type: tags, thumbnail };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ artists });
}
