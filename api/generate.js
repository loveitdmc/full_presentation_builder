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
          "supplierName": string,
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
6. contact email → use marco@loveit-dmc.com unless the quote specifies a different Love IT contact
7. Return ONLY the JSON object`;

// ─── UNSPLASH SEARCH ─────────────────────────────────────────────────────────

// Curated fallback photos (Unsplash IDs) for common search terms
const FALLBACK_PHOTOS = [
  "1552832230-c0197dd311b5", // Rome aerial
  "1515542706656-8e1a346fdbe0", // Rome colosseum
  "1529154036614-a60975f5c760", // italy landscape
  "1489824904134-891ab64532f1", // luxury dinner
  "1566073771259-470de1bed4f7", // luxury hotel lobby
  "1571003123894-1f0594d2b5d9", // wine tasting
  "1530482817083-29ae4b92ff15", // cityscape night
  "1436491865332-7a61a109cc05", // aerial city
  "1523906834658-6e3a11a37e89", // historic street
  "1568454537842-d933259bb258", // gala dinner
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

// Walk the TRIP object and resolve all photo search strings to URLs
async function resolvePhotos(obj) {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item, i) => resolvePhotos(item)));
  }
  if (obj === null || typeof obj !== "object") return obj;

  const result = {};
  const photoKeys = ["photo", "cityPhoto", "coverPhoto"];

  for (const [key, value] of Object.entries(obj)) {
    if (photoKeys.includes(key) && typeof value === "string" && value.trim()) {
      result[key] = await unsplashSearch(value);
    } else if (key === "photos" && Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map((v) => (typeof v === "string" && v.trim() ? unsplashSearch(v) : nextFallback()))
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
      // Skip string contents
      const q = ch;
      i++;
      while (i < html.length) {
        if (html[i] === "\\" ) { i += 2; continue; } // escape
        if (html[i] === q) break;
        i++;
      }
    } else if (ch === "/" && html[i + 1] === "/") {
      // Skip line comment
      while (i < html.length && html[i] !== "\n") i++;
    } else if (ch === "/" && html[i + 1] === "*") {
      // Skip block comment
      i += 2;
      while (i < html.length && !(html[i] === "*" && html[i + 1] === "/")) i++;
      i++;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // find the semicolon
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
  const tripJson = JSON.stringify(tripObj, null, 2);
  const newBlock = `const TRIP = ${tripJson};`;
  return template.slice(0, start) + newBlock + template.slice(end);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pdf, filename } = req.body ?? {};
  if (!pdf) {
    return res.status(400).json({ error: "Missing pdf field (base64 string)" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server not configured: missing ANTHROPIC_API_KEY" });
  }

  // Load template
  const templatePath = path.resolve(process.cwd(), "template", "loveit_template.html");
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch (e) {
    return res.status(500).json({ error: "Template file not found. Please upload loveit_template.html to the template/ folder." });
  }

  // ── Step 1: Call Claude to extract TRIP data from PDF ───────────────────────
  const client = new Anthropic({ apiKey });
  let tripJson;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdf,
              },
            },
            {
              type: "text",
              text: `Read this quote PDF and return the TRIP JSON object. File: ${filename ?? "preventivo.pdf"}`,
            },
          ],
        },
      ],
    });

    tripJson = response.content[0].text.trim();

    // Strip any accidental markdown fences
    tripJson = tripJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  } catch (e) {
    console.error("Claude API error:", e);
    return res.status(502).json({ error: `Claude API error: ${e.message}` });
  }

  // ── Step 2: Parse JSON ───────────────────────────────────────────────────────
  let tripObj;
  try {
    tripObj = JSON.parse(tripJson);
  } catch (e) {
    console.error("JSON parse error. Raw output:", tripJson);
    return res.status(502).json({
      error: "Claude returned invalid JSON. Try again.",
      raw: tripJson.slice(0, 500),
    });
  }

  // ── Step 3: Resolve Unsplash photo search terms to URLs ────────────────────
  fallbackIndex = 0; // reset for deterministic order
  const resolvedTrip = await resolvePhotos(tripObj);

  // ── Step 4: Inject into template ────────────────────────────────────────────
  let finalHtml;
  try {
    finalHtml = injectTrip(template, resolvedTrip);
  } catch (e) {
    console.error("Template injection error:", e);
    return res.status(500).json({ error: `Template error: ${e.message}` });
  }

  // ── Step 5: Return HTML ─────────────────────────────────────────────────────
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
