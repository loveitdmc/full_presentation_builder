import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert assistant for Love IT DMC, a luxury destination management company specialising in high-end incentive travel.

Read the attached PDF quote (preventivo) carefully and return ONLY a valid JSON object matching the schema below.
No markdown, no explanation, no code fences. Start with { and end with }.

SCHEMA:
{
  "client":      string,   // recipient company name
  "projectRef":  string,   // project or quote number
  "title":       string,   // e.g. "Incentive Trip"
  "destination": string,   // main city in English
  "country":     string,   // country in English
  "dates":       string,   // e.g. "23 – 27 February 2027"
  "nights":      number,
  "pax":         number,
  "tagline":     string,   // evocative 8-10 word phrase in English about the destination
  "cityPhoto":       string,  // Unsplash search keyword for aerial/landmark city photo
  "cityPhotoPosition": string, // CSS background-position, e.g. "center 60%"
  "days": [
    {
      "number": number,
      "date":   string,   // e.g. "23 February 2027"
      "label":  string,   // evocative title you invent, e.g. "The Eternal City"
      "activities": [
        {
          "showSlide":    boolean,  // false for airport transfers, true for everything else
          "type":         string,   // "transfer" | "activity" | "dinner" | "hotel" | "gala" | "free"
          "title":        string,
          "description":  string,   // 2-3 sentences, luxury travel tone, in English
          "supplierName": string,   // exact supplier/venue name as written in the quote
          "photo":        string,   // Unsplash search keyword for main slide photo
          "photoPosition": string,  // CSS background-position
          "photos": [string, string, string],  // 3 Unsplash search keywords for gallery
          "options": [              // fill ONLY if quote has Option A / B / C for same service
            {
              "label":       string,  // "Option A"
              "title":       string,
              "price":       string,  // optional, e.g. "€ 45 pp"
              "description": string   // optional, 1 sentence
            }
          ]
        }
      ]
    }
  ],
  "closing": {
    "photo":        string,   // Unsplash search keyword
    "photoPosition": string,
    "headline":     string,   // e.g. "Let's make it happen."
    "subline":      string,
    "contact":      string    // email address
  }
}

RULES (strict):
1. Airport arrival/departure transfers → showSlide: false, type: "transfer"
2. Option A / B / C of the SAME service → one activity with options[] array, NOT separate activities
3. Max 12–14 activities total with showSlide: true
4. photo / photos[] fields → concise English Unsplash search terms (e.g. "colosseum rome night", "roman forum sunset")
5. description → luxury travel copywriting, in English, 2-3 sentences
6. supplierName → extract exactly as written in the quote (will be used to search the supplier database)
7. contact email → use marco@loveit-dmc.com unless the quote specifies a different Love IT contact
8. Return ONLY the JSON object`;

// ─── AIRTABLE SUPPLIER LOOKUP ────────────────────────────────────────────────

async function searchAirtable(supplierName) {
  const token   = process.env.AIRTABLE_TOKEN;
  const baseId  = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID || "Suppliers";

  if (!token || !baseId || !supplierName) return null;

  const safeName = supplierName.replace(/"/g, '\\"').toLowerCase();
  const formula  = encodeURIComponent(`SEARCH("${safeName}", LOWER({Name}))>0`);
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      console.warn("Airtable response not OK:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    if (!data.records?.length) return null;

    const fields = data.records[0].fields;
    const photoUrls = (fields.Photos || []).map((f) => f.url);

    return {
      description: fields.Description || null,
      photos: photoUrls.slice(0, 4).length ? photoUrls.slice(0, 4) : null,
      allPhotos: photoUrls,
    };
  } catch (e) {
    console.warn("Airtable search failed for", supplierName, ":", e.message);
    return null;
  }
}

async function enrichFromAirtable(tripObj) {
  if (!tripObj.days) return tripObj;

  const enrichedDays = await Promise.all(
    tripObj.days.map(async (day) => {
      const enrichedActivities = await Promise.all(
        (day.activities || []).map(async (activity) => {
          if (!activity.showSlide || !activity.supplierName) return activity;

          const match = await searchAirtable(activity.supplierName);
          if (!match) return activity;

          console.log(`Airtable match for "${activity.supplierName}":`, {
            hasDescription: !!match.description,
            photoCount: match.photos?.length ?? 0,
          });

          return {
            ...activity,
            description: match.description || activity.description,
            photo:       match.photos?.[0] || activity.photo,
            photos:      match.photos?.slice(1, 4) || activity.photos,
            allPhotos:   match.allPhotos || [],
            _airtable:   true,
          };
        })
      );
      return { ...day, activities: enrichedActivities };
    })
  );

  return { ...tripObj, days: enrichedDays };
}

// ─── UNSPLASH ────────────────────────────────────────────────────────────────

const FALLBACK_PHOTOS = [
  "1552832230-c0197dd311b5","1515542706656-8e1a346fdbe0",
  "1529154036614-a60975f5c760","1489824904134-891ab64532f1",
  "1566073771259-470de1bed4f7","1571003123894-1f0594d2b5d9",
  "1530482817083-29ae4b92ff15","1436491865332-7a61a109cc05",
  "1523906834658-6e3a11a37e89","1568454537842-d933259bb258",
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

async function resolvePhotos(obj) {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return Promise.all(obj.map((item) => resolvePhotos(item)));
  if (obj === null || typeof obj !== "object") return obj;

  const photoKeys = ["photo", "cityPhoto", "coverPhoto"];
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "_airtable") continue;

    if (photoKeys.includes(key) && typeof value === "string" && value.trim()) {
      result[key] = value.startsWith("http") ? value : await unsplashSearch(value);
    } else if (key === "photos" && Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map((v) => {
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
      const q = ch;
      i++;
      while (i < html.length) {
        if (html[i] === "\\") { i += 2; continue; }
        if (html[i] === q) break;
        i++;
      }
    } else if (ch === "/" && html[i + 1] === "/") {
      while (i < html.length && html[i] !== "\n") i++;
    } else if (ch === "/" && html[i + 1] === "*") {
      i += 2;
      while (i < html.length && !(html[i] === "*" && html[i + 1] === "/")) i++;
      i++;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
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
  const newBlock = `const TRIP = ${JSON.stringify(tripObj, null, 2)};`;
  return template.slice(0, start) + newBlock + template.slice(end);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { pdf, filename } = req.body ?? {};
  if (!pdf) return res.status(400).json({ error: "Missing pdf field" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });

  const templatePath = path.resolve(process.cwd(), "template", "loveit_template.html");
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return res.status(500).json({ error: "Template file not found" });
  }

  // Step 1: Claude reads PDF
  const client = new Anthropic({ apiKey });
  let tripJson;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf },
          },
          {
            type: "text",
            text: `Read this quote PDF and return the TRIP JSON object. File: ${filename ?? "preventivo.pdf"}`,
          },
        ],
      }],
    });
    tripJson = response.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "");
  } catch (e) {
    console.error("Claude API error:", e);
    return res.status(502).json({ error: `Claude API error: ${e.message}` });
  }

  // Step 2: Parse JSON
  let tripObj;
  try {
    tripObj = JSON.parse(tripJson);
  } catch (e) {
    console.error("JSON parse error. Raw:", tripJson.slice(0, 300));
    return res.status(502).json({ error: "Claude returned invalid JSON. Try again.", raw: tripJson.slice(0, 500) });
  }

  // Step 3: Enrich with Airtable
  const enrichedTrip = await enrichFromAirtable(tripObj);

  // Step 4: Resolve Unsplash keywords
  fallbackIndex = 0;
  const resolvedTrip = await resolvePhotos(enrichedTrip);

  // Step 5: Inject into template
  let finalHtml;
  try {
    finalHtml = injectTrip(template, resolvedTrip);
  } catch (e) {
    return res.status(500).json({ error: `Template error: ${e.message}` });
  }

  const safeFilename = (filename ?? "presentazione")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 80);

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    html: finalHtml,
    filename: `${safeFilename}_presenta.html`,
    client: resolvedTrip.client ?? "",
    destination: resolvedTrip.destination ?? "",
  });
}
