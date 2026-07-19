import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── AIRTABLE ────────────────────────────────────────────────────────────────

async function findSuppliers(supplierName) {
  const token   = process.env.AIRTABLE_TOKEN;
  const baseId  = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID || "Suppliers";
  if (!token || !baseId || !supplierName) return [];

  const stopWords = new Set([
    "the","and","per","del","dei","della","delle","degli","di","da",
    "in","con","su","tra","fra","its",
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
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=5&${fields}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
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
  const id = FALLBACK_PHOTOS[fallbackIndex++ % FALLBACK_PHOTOS.length];
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
  } catch { return nextFallback(); }
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
          if (typeof v !== "string" || !v.trim()) return Promise.resolve(null);
          return v.startsWith("http") ? Promise.resolve(v) : unsplashSearch(v);
        })
      ).then(arr => arr.filter(Boolean));
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

// ─── AI EXTRACTION ───────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a luxury travel programme parser for Love IT DMC, a high-end Italian DMC.
Parse the event programme text and return ONLY a valid JSON object — no markdown, no code fences, start with { end with }.

Required JSON structure:
{
  "client":      string,  // client or company name; "" if not stated
  "projectRef":  string,  // project code or ref; "" if not stated
  "title":       string,  // short elegant event title
  "destination": string,  // main city or destination
  "country":     "Italy",
  "dates":       string,  // date range as written; "" if not stated
  "nights":      number,  // total nights; 0 if unclear
  "pax":         number,  // total guests/participants; 0 if unclear
  "tagline":     string,  // one elegant sentence capturing the programme essence
  "cityPhoto":   string,  // Unsplash search query for a beautiful panoramic of the destination
  "cityPhotoPosition": "center center",
  "days": [
    {
      "number": number,
      "date":   string,  // full date label, e.g. "15 October 2027"
      "label":  string,  // day theme, e.g. "Arrival & Welcome Dinner"
      "activities": [
        {
          "showSlide":    true,
          "type":         string,  // one of: hotel|dinner|lunch|breakfast|transfer|activity|excursion|entertainment|meeting|gala
          "title":        string,  // venue or activity name
          "supplierName": string,  // exact supplier/venue name for database lookup; null if not applicable
          "time":         string,  // e.g. "14:00"; null if not stated
          "description":  string,  // 1–2 elegant English sentences about this activity
          "photo":        string,  // Unsplash search query for this specific venue/activity
          "photoPosition":"center center",
          "photos":       [],
          "allPhotos":    [],
          "options":      []
        }
      ]
    }
  ],
  "closing": {
    "photo":         string,  // Unsplash search query for a closing destination photo
    "photoPosition": "center center",
    "headline":      "Let's make it happen.",
    "subline":       string,  // elegant invitation to confirm the programme
    "contact":       "marco@loveit-dmc.com"
  }
}

Important rules:
- Every activity that involves a real venue or supplier must have supplierName set (use the full proper name)
- Logistical entries with no specific venue (e.g. "free afternoon") may have supplierName: null
- Maintain chronological order within each day
- Use the "type" field accurately to drive slide layout`;

async function extractProgramme(text, apiKey) {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    system:     EXTRACT_PROMPT,
    messages:   [{ role: "user", content: `Parse this event programme and return the JSON:\n\n${text}` }],
  });
  const raw = resp.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  return JSON.parse(raw);
}

// ─── AIRTABLE ENRICHMENT ─────────────────────────────────────────────────────

async function enrichWithAirtable(programme) {
  for (const day of (programme.days || [])) {
    for (const act of (day.activities || [])) {
      if (!act.supplierName) continue;
      try {
        const matches = await findSuppliers(act.supplierName);
        if (!matches.length) continue;

        // Prefer exact name match, fall back to first partial match
        const exact = matches.find(
          m => m.name.toLowerCase() === act.supplierName.toLowerCase()
        );
        const sel = exact || matches[0];

        // Override description and photos with real Airtable data
        if (sel.description) act.description = sel.description;
        if (sel.photos?.length) {
          act.photo     = sel.photos[0];          // real URL — resolvePhotos will keep it
          act.photos    = sel.photos.slice(1, 4);
          act.allPhotos = sel.allPhotos || [];
        }
        act.supplierName  = sel.name;             // canonical capitalisation
        act._airtable     = true;
      } catch {
        // non-fatal — continue with AI-generated data
      }
    }
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { programText } = req.body ?? {};
  if (!programText?.trim()) return res.status(400).json({ error: "Missing programText" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });

  const templatePath = path.resolve(process.cwd(), "template", "loveit_template.html");
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return res.status(500).json({ error: "Template file not found" });
  }

  // Step 1: AI extracts programme structure
  let programme;
  try {
    programme = await extractProgramme(programText.trim(), apiKey);
  } catch (e) {
    return res.status(502).json({ error: `AI extraction failed: ${e.message}` });
  }

  // Step 2: Enrich each activity with real Airtable data where available
  await enrichWithAirtable(programme);

  // Step 3: Resolve all photo fields (keeps existing http:// URLs, searches Unsplash for query strings)
  fallbackIndex = 0;
  let resolvedTrip;
  try {
    resolvedTrip = await resolvePhotos(programme);
  } catch (e) {
    return res.status(502).json({ error: `Photo resolution failed: ${e.message}` });
  }

  // Step 4: Inject into template
  let finalHtml;
  try {
    finalHtml = injectTrip(template, resolvedTrip);
  } catch (e) {
    return res.status(500).json({ error: `Template error: ${e.message}` });
  }

  // Step 5: Inject API base URL
  const proto   = req.headers["x-forwarded-proto"] || "https";
  const apiBase = `${proto}://${req.headers.host}`;
  finalHtml = finalHtml.replace("</head>", `<script>window.LOVEIT_API_BASE="${apiBase}";</script>\n</head>`);

  const safeTitle = (resolvedTrip.title || "programma")
    .replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);

  return res.status(200).json({
    html:        finalHtml,
    filename:    `${safeTitle}_presentazione.html`,
    client:      resolvedTrip.client      || "",
    destination: resolvedTrip.destination || "",
    title:       resolvedTrip.title       || "",
    pax:         resolvedTrip.pax         || 0,
    dayCount:    (resolvedTrip.days || []).length,
  });
}
