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
    // English
    "the","and","its","of","at",
    // Italian prepositions
    "per","del","dei","della","delle","degli","di","da","in","con","su","tra","fra","al","alle","agli","allo","dal","dalla","dagli","dalle",
    // Italian articles (critical: "la" alone matches hundreds of records)
    "la","lo","le","il","gli","un","una","uno","i",
    // Italian conjunctions
    "e","o",
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
  return extractJsonObject(raw);
}

// Robust JSON extraction: the model sometimes adds text before/after the JSON.
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object in AI response");
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in AI response");
}

// ─── AIRTABLE ENRICHMENT ─────────────────────────────────────────────────────

// Score how well an Airtable name matches the input query.
// Returns a value 0–1: fraction of meaningful query keywords found in the Airtable name.
function matchScore(queryName, airtableName) {
  const stopWords = new Set([
    "the","and","its","of","at","per","del","dei","della","delle","degli","di","da","in","con","su","tra","fra","al","alle","agli","allo","dal","dalla","dagli","dalle",
    "la","lo","le","il","gli","un","una","uno","i","e","o",
  ]);
  const keywords = queryName.toLowerCase()
    .replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
  if (!keywords.length) return 0;
  const haystack = airtableName.toLowerCase();
  const hits = keywords.filter(w => haystack.includes(w)).length;
  return hits / keywords.length;
}

async function enrichWithAirtable(programme) {
  for (const day of (programme.days || [])) {
    for (const act of (day.activities || [])) {
      if (!act.supplierName) continue;
      try {
        const matches = await findSuppliers(act.supplierName);
        if (!matches.length) continue;

        // Prefer exact name match first
        const exact = matches.find(
          m => m.name.toLowerCase() === act.supplierName.toLowerCase()
        );

        let sel = exact;
        if (!sel) {
          // Score each candidate — require ≥ 50% keyword overlap to avoid false matches
          const scored = matches
            .map(m => ({ m, score: matchScore(act.supplierName, m.name) }))
            .filter(({ score }) => score >= 0.5)
            .sort((a, b) => b.score - a.score);
          sel = scored[0]?.m || null;
        }

        if (!sel) continue; // no good-enough match — keep AI-generated data

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

// ─── AI TEXT REWRITE (in-presentation editor) ────────────────────────────────

async function handleRewrite(rewrite, res, apiKey) {
  const { text, instruction, context } = rewrite || {};
  if (!text?.trim()) return res.status(400).json({ error: "Missing text to rewrite" });

  const client = new Anthropic({ apiKey });
  const sys = `You are the senior copywriter of Love IT DMC, a luxury Italian destination management company.
You rewrite short presentation texts (slide descriptions, taglines, headlines).
Rules:
- Return ONLY the rewritten text — no quotes, no preamble, no markdown.
- Keep the same language as the original unless the instruction says otherwise.
- Elegant, refined, concise luxury-hospitality tone.
- Keep roughly the same length unless the instruction says otherwise.`;

  const user = `${context ? `Slide context: ${context}\n` : ""}Instruction: ${instruction || "Improve this text: more elegant and refined."}

Original text:
${text.trim()}`;

  try {
    const resp = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:     sys,
      messages:   [{ role: "user", content: user }],
    });
    return res.status(200).json({ text: resp.content[0].text.trim() });
  } catch (e) {
    return res.status(502).json({ error: `AI rewrite failed: ${e.message}` });
  }
}

// ─── DATABASE CHAT (natural-language queries over Airtable) ──────────────────

async function atFetchAll(baseId, token, tableId, fields) {
  const fieldsParam = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  let all = [], offset = "";
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?${fieldsParam}&pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`Airtable ${resp.status} on ${tableId}`);
    const data = await resp.json();
    all = all.concat(data.records || []);
    offset = data.offset || "";
  } while (offset);
  return all;
}

const _v = v => Array.isArray(v) ? v.map(x => x?.name || x).join(",")
  : (typeof v === "object" && v?.name) ? v.name : (v ?? "");
const _row = arr => arr.map(x => String(x ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ").trim()).join("|");

async function handleDbChat(dbchat, res, apiKey) {
  const { question, history } = dbchat || {};
  if (!question?.trim()) return res.status(400).json({ error: "Missing question" });
  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return res.status(500).json({ error: "Missing Airtable config" });

  let suppliers, prices, rooms, activities, artists;
  try {
    [suppliers, prices, rooms, activities, artists] = await Promise.all([
      atFetchAll(baseId, token, "tbl3rEBd03iC29uNb", ["Name","City","Type","Supplier Categories","Capacity","Rooms","Preferred Supplier","Features"]),
      atFetchAll(baseId, token, "tbljeSwiqGWdJHvoQ", ["Price Line","Supplier","Category","Amount","Currency","Unit","VAT Included","Valid Until","Status","Quoted Guests","Effective Price per Person"]),
      atFetchAll(baseId, token, "tbl4JXVw0K9Sz0dHC", ["Meeting Room Name","Supplier","Setting","Area m²","Banquet Capacity","Theatre Capacity","Cocktail Capacity","Classroom Capacity","Boardroom Capacity"]),
      atFetchAll(baseId, token, "tblPIbMu1UDjOLYIK", ["Activity or Service Name","Supplier","Activity Type","Setting","Capacity","Duration","Current Fee EUR","Fee Basis"]),
      atFetchAll(baseId, token, "tblbCAthb1HXfc13i", ["Artist or Show Name","Supplier","Artist & Show Tags","Number of Performers","Performance Duration","Current Fee EUR","Fee Basis"]),
    ]);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }

  const supName = new Map(suppliers.map(r => [r.id, r.fields.Name || ""]));
  const sn = f => supName.get((f.Supplier || [])[0]) || "";

  const db = `SUPPLIERS (Name|City|Type|Categories|Capacity|Rooms|Preferred|Features):
${suppliers.map(r => { const f = r.fields; return _row([f.Name, f.City, f.Type, _v(f["Supplier Categories"]), f.Capacity, f.Rooms, f["Preferred Supplier"] ? "yes" : "", _v(f.Features)]); }).join("\n")}

PRICES (Supplier|PriceLine|Category|Amount|Currency|Unit|VATincluded|ValidUntil|Status|QuotedGuests|EffectivePricePerPerson):
${prices.map(r => { const f = r.fields; return _row([sn(f), f["Price Line"], _v(f.Category), f.Amount, _v(f.Currency), _v(f.Unit), f["VAT Included"] ? "yes" : "", f["Valid Until"], _v(f.Status), f["Quoted Guests"], f["Effective Price per Person"]]); }).join("\n")}

MEETING ROOMS (Supplier|Room|Setting|Area m2|Banquet|Theatre|Cocktail|Classroom|Boardroom):
${rooms.map(r => { const f = r.fields; return _row([sn(f), f["Meeting Room Name"], _v(f.Setting), f["Area m²"], f["Banquet Capacity"], f["Theatre Capacity"], f["Cocktail Capacity"], f["Classroom Capacity"], f["Boardroom Capacity"]]); }).join("\n")}

ACTIVITIES (Supplier|Activity|Type|Setting|Capacity|Duration|FeeEUR|FeeBasis):
${activities.map(r => { const f = r.fields; return _row([sn(f), f["Activity or Service Name"], _v(f["Activity Type"]), _v(f.Setting), f.Capacity, f.Duration, f["Current Fee EUR"], _v(f["Fee Basis"])]); }).join("\n")}

ARTISTS & SHOWS (Supplier|Name|Tags|Performers|Duration|FeeEUR|FeeBasis):
${artists.map(r => { const f = r.fields; return _row([sn(f), f["Artist or Show Name"], _v(f["Artist & Show Tags"]), f["Number of Performers"], f["Performance Duration"], f["Current Fee EUR"], _v(f["Fee Basis"])]); }).join("\n")}`;

  const sys = `You are the database assistant of Love IT DMC, a luxury Italian DMC.
Answer questions using ONLY the database snapshot below (pipe-separated tables).
Rules:
- Answer in the user's language (usually Italian). Be concise.
- Format results as a short intro line followed by a bulleted list: "• **Name** — City — key details".
- Include prices with currency and unit when relevant (e.g. "€65 per person, VAT included").
- Prices marked with QuotedGuests are group totals; use EffectivePricePerPerson for per-head comparisons.
- If nothing matches, say so clearly and suggest the closest alternatives from the data.
- Never invent data that is not in the snapshot.

DATABASE SNAPSHOT:
${db}`;

  const msgs = [];
  for (const h of (history || []).slice(-4)) {
    if (h.q && h.a) { msgs.push({ role: "user", content: h.q }); msgs.push({ role: "assistant", content: h.a }); }
  }
  msgs.push({ role: "user", content: question.trim() });

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1500,
      system:     sys,
      messages:   msgs,
    });
    return res.status(200).json({ answer: resp.content[0].text.trim() });
  } catch (e) {
    return res.status(502).json({ error: `AI error: ${e.message}` });
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  let _body = req.body ?? {};
  if (Buffer.isBuffer(_body)) { try { _body = JSON.parse(_body.toString("utf8")); } catch { _body = {}; } }
  else if (typeof _body === "string") { try { _body = JSON.parse(_body); } catch { _body = {}; } }
  const { rewrite, dbchat } = _body;
  const programText = typeof _body.programText === "string" ? _body.programText : (_body.programText == null ? undefined : String(_body.programText));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });

  // Rewrite mode: quick AI edit of a single text from the in-presentation editor
  if (rewrite) return handleRewrite(rewrite, res, apiKey);

  // Database chat mode: natural-language questions over Airtable
  if (dbchat) return handleDbChat(dbchat, res, apiKey);

  if (!programText?.trim()) return res.status(400).json({ error: "Missing programText" });

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
