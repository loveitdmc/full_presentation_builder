import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── MEETING ROOMS (GET mode) ─────────────────────────────────────────────────

const TABLE_SUPPLIERS_ID = "tbl3rEBd03iC29uNb";
const TABLE_ROOMS_ID     = "tbl4JXVw0K9Sz0dHC";
const TABLE_MEDIA_ID     = "tblpKKKum1aFwPjgY";

const STOP_WORDS = new Set([
  "the","and","its","of","at","per","del","dei","della","delle","degli","di","da",
  "in","con","su","tra","fra","al","alle","agli","allo","dal","dalla","dagli","dalle",
  "la","lo","le","il","gli","un","una","uno","i","e","o",
]);

function spaceKeywords(name) {
  return name.toLowerCase().replace(/[^\w\s]/g," ").split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .map(w => w.replace(/"/g,'\\"'));
}
function spaceMatchScore(queryName, airtableName) {
  const kw = spaceKeywords(queryName);
  if (!kw.length) return 0;
  const hay = airtableName.toLowerCase();
  return kw.filter(w => hay.includes(w)).length / kw.length;
}

async function findSupplierForSpaces(name, token, baseId) {
  const kw = spaceKeywords(name);
  if (!kw.length) return null;
  const orClauses = kw.map(w => `SEARCH("${w}", LOWER({Name}))>0`).join(",");
  const formula   = encodeURIComponent(`OR(${orClauses})`);
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_SUPPLIERS_ID}?filterByFormula=${formula}&fields[]=Name&fields[]=Meeting%20Rooms&maxRecords=8`;
  const resp = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(7000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const records = data.records || [];
  if (!records.length) return null;
  const inputLower = name.toLowerCase();
  const exact = records.find(r => (r.fields.Name||"").toLowerCase() === inputLower);
  if (exact) return exact;
  const scored = records
    .map(r => ({ r, score: spaceMatchScore(name, r.fields.Name||"") }))
    .filter(({ score }) => score >= 0.5)
    .sort((a,b) => b.score - a.score);
  return scored[0]?.r || records[0]; // fall back to first result if any found
}

async function fetchRoomRecords(roomIds, token, baseId) {
  if (!roomIds.length) return [];
  const idClauses = roomIds.slice(0,50).map(id => `RECORD_ID()="${id}"`).join(",");
  const formula   = encodeURIComponent(`OR(${idClauses})`);
  // Use field IDs for reliability (no encoding issues with special chars / spaces)
  const ROOM_FIELDS = [
    "fldeg4uG2doJWRJfO", // Meeting Room Name
    "fldqEbguUNAeGuVcb", // Setting
    "fld7TGupUXKEhv0gl", // Area m²
    "fldDUuQ6PR0Gj9fN5", // Banquet Capacity
    "fldNd8cMq8sipBF8w", // Theatre Capacity
    "fldAuEO7MPwruK8Mx", // Cocktail Capacity
    "fldkf0aJv1v4J9i6i", // Classroom Capacity
    "fldcUw6U2vGvm7JtS", // Boardroom Capacity
    "fldaASdJjqXRIycfk", // Operational Notes
    "fldnvvLqifmGnGn5n", // Media (linked)
  ];
  const fieldsParam = ROOM_FIELDS.map(f => `fields[]=${f}`).join("&");
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ROOMS_ID}?filterByFormula=${formula}&${fieldsParam}&maxRecords=50`;
  const resp = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(8000) });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.records || [];
}

async function fetchRoomPhotos(mediaIds, token, baseId) {
  if (!mediaIds.length) return new Map();
  const idClauses = mediaIds.slice(0,50).map(id => `RECORD_ID()="${id}"`).join(",");
  const formula   = encodeURIComponent(`OR(${idClauses})`);
  // Use field ID for File attachment to avoid name encoding issues
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_MEDIA_ID}?filterByFormula=${formula}&fields[]=fldqQsLLwleNQAART&maxRecords=100`;
  const resp = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(7000) });
  if (!resp.ok) return new Map();
  const data = await resp.json();
  const map = new Map();
  for (const mr of (data.records||[])) {
    // fldqQsLLwleNQAART = "File" (attachments)
    const files = mr.fields["fldqQsLLwleNQAART"] || [];
    // Take first attachment regardless of type — floor plans / room photos are all valid
    const first = files[0];
    if (first?.url) map.set(mr.id, first.url);
  }
  return map;
}

// Strip sentences/clauses containing pricing or commercial commentary.
// Keeps only technical info: dimensions, ceiling height, layout notes, access, features.
function technicalNotesOnly(notes) {
  if (!notes) return null;
  const PRICE_RE = /€|£|\$|EUR|GBP|USD|\bfee\b|\bhire\b|\brent\b|\bspend\b|\bVAT\b|\bcost\b|\bprice\b|\brate\b|\bquot|\bminimum\b|\bopen.bar\b|\bcharge\b|\bsupplement\b|\bexclusive.use\b|\bexclusive use\b|\bper\s+(day|night|service|person|pax|event|hour)\b/i;
  // Split on sentence boundaries (period + space, or semicolon + space)
  const parts = notes.split(/(?<=[.;])\s+/);
  const clean = parts.filter(s => !PRICE_RE.test(s));
  const result = clean.join(' ').trim();
  return result || null;
}

async function handleGetSpaces(req, res) {
  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return res.status(500).json({ error: "Missing Airtable config" });

  const supplierParam = (req.query?.supplier || "").trim();
  if (!supplierParam) return res.status(400).json({ error: "Missing supplier param" });

  const supplierRec = await findSupplierForSpaces(supplierParam, token, baseId);
  if (!supplierRec) return res.status(200).json({ supplierName: supplierParam, rooms: [] });

  const supplierName = supplierRec.fields.Name || supplierParam;
  const roomIds = supplierRec.fields["Meeting Rooms"] || [];
  if (!roomIds.length) return res.status(200).json({ supplierName, rooms: [] });

  const roomRecords = await fetchRoomRecords(roomIds, token, baseId);
  const allMediaIds = [...new Set(roomRecords.flatMap(r => r.fields.Media || []))];
  const mediaMap    = await fetchRoomPhotos(allMediaIds, token, baseId).catch(() => new Map());

  const roomById = new Map(roomRecords.map(r => [r.id, r]));
  const rooms = roomIds
    .map(id => roomById.get(id)).filter(Boolean)
    .map(r => {
      const f = r.fields;
      // Use field IDs to read (Airtable returns fields by ID when requested by ID)
      const firstMediaId = (f["fldnvvLqifmGnGn5n"]||[])[0];
      return {
        name:      f["fldeg4uG2doJWRJfO"] || "",
        setting:   f["fldqEbguUNAeGuVcb"]?.name || null,
        area:      f["fld7TGupUXKEhv0gl"] || null,
        banquet:   f["fldDUuQ6PR0Gj9fN5"] || null,
        theatre:   f["fldNd8cMq8sipBF8w"] || null,
        cocktail:  f["fldAuEO7MPwruK8Mx"] || null,
        classroom: f["fldkf0aJv1v4J9i6i"] || null,
        boardroom: f["fldcUw6U2vGvm7JtS"] || null,
        notes:     technicalNotesOnly(f["fldaASdJjqXRIycfk"]),
        photo:     firstMediaId ? (mediaMap.get(firstMediaId)||null) : null,
      };
    }).filter(r => r.name);

  return res.status(200).json({ supplierName, rooms });
}

// ─── AIRTABLE ────────────────────────────────────────────────────────────────

// Single smart search: keyword OR-search returning up to 8 records with full data.
// Returns [] when nothing found. Words shorter than 2 chars or stop-words are skipped;
// single-word inputs like "roscioli" or "hilton" work fine.
async function findSuppliers(supplierName) {
  const token   = process.env.AIRTABLE_TOKEN;
  const baseId  = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID || "Suppliers";
  if (!token || !baseId || !supplierName) return [];

  const stopWords = new Set([
    "the","and","per","del","dei","della","delle","degli","di","da",
    "in","con","su","tra","fra","its","the",
  ]);
  const words = supplierName.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .map(w => w.replace(/"/g, '\\"'));

  if (!words.length) return [];

  const orClauses = words.map(w => `SEARCH("${w}", LOWER({Name}))>0`).join(",");
  const formula   = encodeURIComponent(`OR(${orClauses})`);
  const fields    = ["Name","City","Description","Photos","Type"]
    .map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=8&${fields}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.records || []).map(r => {
      const f = r.fields;
      const allPhotoUrls = (f.Photos || []).map(p => p.url);
      return {
        name:        f.Name        || "",
        city:        f.City        || "",
        description: f.Description || null,
        photos:      allPhotoUrls.slice(0, 4),
        allPhotos:   allPhotoUrls,
        type:        f.Type        || null,
      };
    }).filter(r => r.name);
  } catch {
    return [];
  }
}

// ─── UNSPLASH ────────────────────────────────────────────────────────────────

const FALLBACK_PHOTOS = [
  "1552832230-c0197dd311b5","1515542706656-8e1a346fdbe0",
  "1529154036614-a60975f5c760","1489824904134-891ab64532f1",
  "1566073771259-470de1bed4f7","1571003123894-1f0594d2b5d9",
  "1530482817083-29ae4b92ff15","1436491865332-7a61a109cc05",
];
let fallbackIndex = 0;
function nextFallback() {
  const id = FALLBACK_PHOTOS[fallbackIndex % FALLBACK_PHOTOS.length];
  fallbackIndex++;
  return `https://images.unsplash.com/photo-${id}?w=1920&q=80&fit=crop`;
}
async function unsplashSearch(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return nextFallback();
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const resp = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return nextFallback();
    const data = await resp.json();
    if (!data.results?.length) return nextFallback();
    const p = data.results[0];
    return `${p.urls.raw}&w=1920&q=80&fit=crop&crop=center`;
  } catch {
    return nextFallback();
  }
}

// ─── PHOTO RESOLUTION ────────────────────────────────────────────────────────

async function resolvePhotos(obj) {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return Promise.all(obj.map(item => resolvePhotos(item)));
  if (obj === null || typeof obj !== "object") return obj;

  const photoKeys = ["photo", "cityPhoto", "coverPhoto"];
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "_airtable") continue;
    if (photoKeys.includes(key) && typeof value === "string" && value.trim()) {
      result[key] = value.startsWith("http") ? value : await unsplashSearch(value);
    } else if (key === "photos" && Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map(v => {
          if (typeof v !== "string" || !v.trim()) return nextFallback();
          return v.startsWith("http") ? v : unsplashSearch(v);
        })
      );
    } else {
      result[key] = await resolvePhotos(value);
    }
  }
  return result;
}

// ─── TEMPLATE INJECTION ───────────────────────────────────────────────────────

function findTripBounds(html) {
  const marker = "const TRIP = {";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("TRIP marker not found in template");
  let i = start + "const TRIP = ".length;
  let depth = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < html.length) {
        if (html[i] === "\\") { i += 2; continue; }
        if (html[i] === q) break;
        i++;
      }
    } else if (ch === "/" && html[i+1] === "/") {
      while (i < html.length && html[i] !== "\n") i++;
    } else if (ch === "/" && html[i+1] === "*") {
      i += 2;
      while (i < html.length && !(html[i] === "*" && html[i+1] === "/")) i++;
      i++;
    } else if (ch === "{") { depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        while (end < html.length && /\s/.test(html[end])) end++;
        if (html[end] === ";") end++;
        return { start, end };
      }
    }
    i++;
  }
  throw new Error("TRIP block closing brace not found");
}

function injectTrip(template, tripObj) {
  const { start, end } = findTripBounds(template);
  return template.slice(0, start) + `const TRIP = ${JSON.stringify(tripObj, null, 2)};` + template.slice(end);
}

// ─── AI FALLBACK ─────────────────────────────────────────────────────────────

const AI_PROMPT = `You are a luxury travel copywriter for Love IT DMC, a high-end Italian DMC.
Given a supplier or venue name, return ONLY a valid JSON object.
No markdown, no code fences. Start with { and end with }.

{
  "city":          string,
  "country":       string,
  "type":          string,
  "description":   string,
  "tagline":       string,
  "photo":         string,
  "photoPosition": string,
  "photos":        [string, string, string],
  "cityPhoto":     string
}`;

async function generateWithAI(supplierName, apiKey) {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: AI_PROMPT,
    messages: [{ role: "user", content: `Supplier name: "${supplierName}"\n\nReturn the JSON profile.` }],
  });
  const text = resp.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  return JSON.parse(text);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  // GET → return meeting rooms for a supplier
  if (req.method === "GET") return handleGetSpaces(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { supplier } = req.body ?? {};
  if (!supplier?.trim()) return res.status(400).json({ error: "Missing supplier name" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });

  const templatePath = path.resolve(process.cwd(), "template", "loveit_template.html");
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return res.status(500).json({ error: "Template file not found" });
  }

  // Step 1: Smart keyword search — returns 0–8 Airtable records
  const matches = await findSuppliers(supplier.trim());

  // Step 1b: Determine which record to use (or surface picker)
  let selected = null;
  if (matches.length > 0) {
    const inputLower = supplier.trim().toLowerCase();
    const exact = matches.find(m => m.name.toLowerCase() === inputLower);
    if (exact) {
      // Exact name match — proceed directly
      selected = exact;
    } else if (matches.length === 1) {
      // Only one candidate — auto-proceed, no picker needed
      selected = matches[0];
    } else {
      // Multiple partial matches — ask frontend to confirm
      return res.status(200).json({
        status:     "fuzzy",
        candidates: matches.map(m => ({ name: m.name, city: m.city })),
      });
    }
  }

  let profile;
  if (selected?.description) {
    const cityName = selected.city || "Rome";
    profile = {
      city:          cityName,
      country:       "Italy",
      type:          selected.type || "activity",
      description:   selected.description,
      tagline:       `An exclusive experience in ${cityName}`,
      photo:         selected.photos?.[0] || null,
      photoPosition: "center center",
      photos:        selected.photos?.slice(1, 4) || [],
      allPhotos:     selected.allPhotos || [],
      cityPhoto:     `${cityName.toLowerCase()} italy aerial landmark`,
      fromAirtable:  true,
    };
  } else {
    // No Airtable record with description — fall back to AI
    // Use the real Airtable name if we found one, otherwise the user's input
    const nameForAI = selected?.name || supplier.trim();
    try {
      const ai = await generateWithAI(nameForAI, apiKey);
      profile = {
        city:          ai.city || "Rome",
        country:       ai.country || "Italy",
        type:          ai.type || "activity",
        description:   ai.description,
        tagline:       ai.tagline,
        photo:         ai.photo,
        photoPosition: ai.photoPosition || "center center",
        photos:        ai.photos || [],
        cityPhoto:     ai.cityPhoto,
        fromAirtable:  false,
      };
    } catch (e) {
      return res.status(502).json({ error: `AI generation failed: ${e.message}` });
    }
  }

  // Step 3: Build TRIP JSON
  // Use the Airtable-confirmed name when available (correct capitalisation)
  const supplierName = selected?.name || supplier.trim();
  const tripObj = {
    client:            "",
    projectRef:        "",
    title:             supplierName,
    destination:       profile.city,
    country:           profile.country,
    dates:             "",
    nights:            0,
    pax:               0,
    tagline:           profile.tagline,
    cityPhoto:         profile.cityPhoto,
    cityPhotoPosition: "center center",
    days: [{
      number: 1,
      date:   "",
      label:  supplierName,
      activities: [{
        showSlide:    true,
        type:         profile.type,
        title:        supplierName,
        description:  profile.description,
        supplierName: supplierName,
        photo:        profile.photo,
        photoPosition: profile.photoPosition,
        photos:       profile.photos,
        allPhotos:    profile.allPhotos || [],
        options:      [],
        _airtable:    profile.fromAirtable,
      }],
    }],
    closing: {
      photo:         profile.cityPhoto,
      photoPosition: "center center",
      headline:      "Let's make it happen.",
      subline:       `Contact us to add ${supplierName} to your programme.`,
      contact:       "marco@loveit-dmc.com",
    },
  };

  // Step 4: Resolve photos
  fallbackIndex = 0;
  const resolvedTrip = await resolvePhotos(tripObj);

  // Step 5: Inject template
  let finalHtml;
  try {
    finalHtml = injectTrip(template, resolvedTrip);
  } catch (e) {
    return res.status(500).json({ error: `Template error: ${e.message}` });
  }

  // Step 6: Hide slides not needed in supplier mode + inject API base
  const proto = req.headers["x-forwarded-proto"] || "https";
  const apiBase = `${proto}://${req.headers.host}`;
  const supplierCss = `<style>
    .slide-cover, .slide-overview, .slide-closing { display: none !important; }
  </style>`;
  const apiScript = `<script>window.LOVEIT_API_BASE="${apiBase}";</script>`;
  finalHtml = finalHtml.replace('</head>', supplierCss + '\n' + apiScript + '\n</head>');

  const safeFilename = supplierName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);

  return res.status(200).json({
    html:         finalHtml,
    filename:     `${safeFilename}_scheda.html`,
    supplier:     supplierName,
    city:         profile.city,
    fromAirtable: profile.fromAirtable,
  });
}
