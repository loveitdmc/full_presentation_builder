import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── AIRTABLE ────────────────────────────────────────────────────────────────

async function searchAirtable(supplierName) {
  const token   = process.env.AIRTABLE_TOKEN;
  const baseId  = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID || "Fornitori";
  if (!token || !baseId || !supplierName) return null;

  const safeName = supplierName.replace(/"/g, '\\"').toLowerCase();
  const formula  = encodeURIComponent(`SEARCH("${safeName}", LOWER({Name}))>0`);
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.records?.length) return null;
    const fields = data.records[0].fields;
    return {
      description: fields.Descrizione || null,
      photos: (fields.Foto || []).slice(0, 4).map(f => f.url),
      city: fields.Città || null,
      type: fields.Tipo || null,
    };
  } catch {
    return null;
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
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

  // Step 1: Airtable lookup
  const airtableData = await searchAirtable(supplier.trim());

  let profile;
  if (airtableData?.description) {
    const cityName = airtableData.city || "Rome";
    profile = {
      city:          cityName,
      country:       "Italy",
      type:          airtableData.type || "activity",
      description:   airtableData.description,
      tagline:       `An exclusive experience in ${cityName}`,
      photo:         airtableData.photos?.[0] || null,
      photoPosition: "center center",
      photos:        airtableData.photos?.slice(1, 4) || [],
      cityPhoto:     `${cityName.toLowerCase()} italy aerial landmark`,
      fromAirtable:  true,
    };
  } else {
    // Step 2: AI generation
    try {
      const ai = await generateWithAI(supplier.trim(), apiKey);
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
  const supplierName = supplier.trim();
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

  // Step 6: Hide slides not needed in supplier mode (overview + closing)
  const supplierCss = `<style>
    .slide-cover, .slide-overview, .slide-closing { display: none !important; }
  </style>`;
  finalHtml = finalHtml.replace('</head>', supplierCss + '\n</head>');

  const safeFilename = supplierName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);

  return res.status(200).json({
    html:         finalHtml,
    filename:     `${safeFilename}_scheda.html`,
    supplier:     supplierName,
    city:         profile.city,
    fromAirtable: profile.fromAirtable,
  });
}
