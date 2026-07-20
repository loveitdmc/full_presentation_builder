import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── AIRTABLE CONSTANTS ───────────────────────────────────────────────────────
// Use table IDs (most reliable) — verified from Airtable schema
const TABLE_ACTS       = "tblbCAthb1HXfc13i";   // Artists & Shows
const TABLE_ACTIVITIES = "tblPIbMu1UDjOLYIK";   // Activities
const TABLE_SUPPLIERS  = "tbl3rEBd03iC29uNb";    // Suppliers
const TABLE_MEDIA      = "tblpKKKum1aFwPjgY";    // Media

// ─── VIDEO URL HELPERS ────────────────────────────────────────────────────────

function toEmbedUrl(url) {
  if (!url) return null;
  url = url.trim();
  // YouTube
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  // Vimeo
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`;
  // Google Drive
  const drive = url.match(/drive\.google\.com\/file\/d\/([^/\?]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  // Direct video file
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return url;
  return null;
}

// Extract all URLs from a multiline text field (e.g. "Video Links")
function extractUrls(text) {
  if (!text) return [];
  return (text.match(/https?:\/\/\S+/g) || []).map(u => u.replace(/[,;)>\]"']+$/, ''));
}

// Parse "Video Links" line by line: each line may carry a label before/after the URL.
// e.g. "Gala Dinner Performance – https://youtu.be/xyz" → { url, label }
function parseVideoLinks(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(https?:\/\/\S+)/);
    if (!m) continue;
    const url = m[1].replace(/[,;)>\]"']+$/, '');
    const label = line.replace(m[1], '')
      .replace(/^[\s\-–—:•·|]+/, '').replace(/[\s\-–—:•·|]+$/, '')
      .trim();
    out.push({ url, label: label || null });
  }
  return out;
}

// Fetch real video titles from YouTube oEmbed (no API key needed).
// Mutates v.title in place; non-YouTube videos keep their existing title.
async function enrichYouTubeTitles(videos) {
  await Promise.all(videos.map(async v => {
    const yt = v.embedUrl.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
    if (!yt) return;
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${yt[1]}`;
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.title) v.title = d.title;
      }
    } catch { /* keep existing title */ }
  }));
  return videos;
}

function isVideoLinkOrType(assetType, driveLink, fileUrls) {
  const t = (assetType || "").toLowerCase();
  if (t.includes("video")) return true;
  if (driveLink && /(?:youtube\.com|youtu\.be|vimeo\.com)/.test(driveLink)) return true;
  if (fileUrls.some(u => /\.(mp4|webm|ogg)(\?|$)/i.test(u))) return true;
  return false;
}

// ─── AIRTABLE HELPERS ─────────────────────────────────────────────────────────

async function airtableFetch(url, token) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// Smart keyword search — returns up to 8 candidates with name + type.
// Works with partial names like "stefano", "camilli", "jazz", etc.
async function findActCandidates(actName, token, baseId) {
  const stopWords = new Set([
    "the","and","per","del","dei","della","delle","degli","di","da",
    "in","con","su","tra","fra","its",
  ]);
  const words = actName.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .map(w => w.replace(/"/g, '\\"'));

  if (!words.length) return [];

  const orClauses = words.map(w => `SEARCH("${w}", LOWER({Artist or Show Name}))>0`).join(",");
  const formula   = encodeURIComponent(`OR(${orClauses})`);
  const nameField = encodeURIComponent("Artist or Show Name");
  const tagsField = encodeURIComponent("Artist & Show Tags");
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ACTS}?filterByFormula=${formula}&maxRecords=8&fields[]=${nameField}&fields[]=${tagsField}`;

  try {
    const data = await airtableFetch(url, token);
    return (data.records || []).map(r => {
      const f    = r.fields;
      const name = f["Artist or Show Name"] || "";
      const tags = Array.isArray(f["Artist & Show Tags"])
        ? f["Artist & Show Tags"].join(", ")
        : (f["Artist & Show Tags"] || "");
      return { name, type: tags };
    }).filter(c => c.name);
  } catch {
    return [];
  }
}

async function searchAct(actName, token, baseId) {
  // Artists table — field name: "Artist or Show Name"
  const safe = actName.replace(/"/g, '\\"').toLowerCase();
  const formula = encodeURIComponent(`SEARCH("${safe}", LOWER({Artist or Show Name}))>0`);
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ACTS}?filterByFormula=${formula}&maxRecords=1`;
  const data = await airtableFetch(url, token);
  if (!data.records?.length) return null;
  const r = data.records[0];
  const f = r.fields;
  // Artist & Show Tags is multipleSelects — array of strings
  const tags = Array.isArray(f["Artist & Show Tags"]) ? f["Artist & Show Tags"].join(", ") : (f["Artist & Show Tags"] || null);
  return {
    id:          r.id,
    name:        f["Artist or Show Name"] || actName,
    supplierIds: f.Supplier             || [],
    mediaIds:    f["Consolidated Media"] || [],
    notes:       f["Description and Operational Notes"] || null,
    type:        tags,
    videoLinks:  f["Video Links"] || "",
  };
}

// ─── ACTIVITIES ──────────────────────────────────────────────────────────────

async function searchActivity(name, token, baseId) {
  const safe = name.replace(/"/g, '\\"').toLowerCase();
  const formula = encodeURIComponent(`SEARCH("${safe}", LOWER({Activity or Service Name}))>0`);
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ACTIVITIES}?filterByFormula=${formula}&maxRecords=1`;
  const data = await airtableFetch(url, token);
  if (!data.records?.length) return null;
  const r = data.records[0];
  const f = r.fields;
  const sel = v => (typeof v === "object" && v?.name) ? v.name : (v || null);
  return {
    id:          r.id,
    name:        f["Activity or Service Name"] || name,
    supplierIds: f.Supplier || [],
    mediaIds:    f.Media    || [],
    notes:       f["Description and Operational Notes"] || null,
    type:        sel(f["Activity Type"]),
    setting:     sel(f.Setting),
    capacity:    f.Capacity || null,
    duration:    f.Duration || null,
  };
}

async function handleActivity(activityName, res, token, baseId) {
  let rec;
  try {
    rec = await searchActivity(activityName, token, baseId);
  } catch (e) {
    return res.status(502).json({ error: `Airtable error: ${e.message}` });
  }
  if (!rec) return res.status(404).json({ error: `"${activityName}" not found in Activities.` });

  let supplier = null;
  if (rec.supplierIds.length > 0) {
    supplier = await getSupplier(rec.supplierIds[0], token, baseId);
  }

  const mediaRecords = await getMediaRecords(rec.mediaIds, token, baseId);

  // Media linked to only THIS activity are specific; media linked to 2+ activities
  // are generic supplier assets shared across tours — use them only as fallback.
  const buildAssets = recs => {
    const photos = [], vids = [];
    for (const m of recs) {
      photos.push(...m.fileUrls.filter(u => !/\.(mp4|webm|ogg)(\?|$)/i.test(u)));
      const videoRawUrl = m.driveLink
        || m.fileUrls.find(u => /\.(mp4|webm|ogg)(\?|$)/i.test(u)) || null;
      if (videoRawUrl) {
        const embedUrl = toEmbedUrl(videoRawUrl);
        if (embedUrl) vids.push({
          embedUrl,
          sourceUrl: videoRawUrl,
          isFile: /\.(mp4|webm|ogg)(\?|$)/i.test(videoRawUrl),
          title: m.description || "Video",
        });
      }
    }
    return { photos, vids };
  };

  const specific = mediaRecords.filter(m => m.activityCount <= 1);
  let { photos: photoUrls, vids: videos } = buildAssets(specific);
  if (!photoUrls.length && !videos.length) {
    ({ photos: photoUrls, vids: videos } = buildAssets(mediaRecords));
  }
  videos = videos.slice(0, 6);
  await enrichYouTubeTitles(videos);

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  const cityName    = supplier?.city || "Italy";
  const mainPhoto   = photoUrls[0]
    || await unsplashSearch(`${cityName} italy ${rec.type || "experience"}`, unsplashKey);

  const description = rec.notes
    || supplier?.description
    || `An exclusive experience: ${rec.name}.`;

  // Meta line for the slide (type · setting · capacity · duration)
  const metaParts = [];
  if (rec.type)     metaParts.push(rec.type);
  if (rec.setting)  metaParts.push(rec.setting);
  if (rec.capacity) metaParts.push(`Max ${rec.capacity} pax`);
  if (rec.duration) metaParts.push(rec.duration);

  return res.status(200).json({
    act:         rec.name,
    description,
    supplier:    supplier?.name || null,
    meta:        metaParts.join(" · ") || null,
    mainPhoto,
    photos:      photoUrls,
    videos,
  });
}

async function getSupplier(supplierId, token, baseId) {
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_SUPPLIERS}/${supplierId}`;
  try {
    const data = await airtableFetch(url, token);
    const f = data.fields;
    return {
      name:        f.Name        || null,
      description: f.Description || null,
      city:        f.City        || null,
    };
  } catch {
    return null;
  }
}

async function getMediaRecords(mediaIds, token, baseId) {
  if (!mediaIds.length) return [];
  const idsClause = mediaIds.map(id => `RECORD_ID()="${id}"`).join(",");
  const formula = encodeURIComponent(`OR(${idsClause})`);
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_MEDIA}?filterByFormula=${formula}&maxRecords=50`;
  try {
    const data = await airtableFetch(url, token);
    return (data.records || []).map(r => {
      const f = r.fields;
      const assetType = typeof f["Asset Type"] === "object"
        ? f["Asset Type"]?.name || ""
        : f["Asset Type"] || "";
      const fileUrls = (f.File || []).map(att => att.url).filter(Boolean);
      // How many Activities this media record is linked to — used to detect
      // generic/shared assets (linked to many activities) vs specific ones
      const activityCount = Array.isArray(f.Activities) ? f.Activities.length : 0;
      return { assetType, fileUrls, driveLink: f["Drive Link"] || null, description: f.Description || null, activityCount };
    });
  } catch {
    return [];
  }
}

// ─── UNSPLASH FALLBACK ───────────────────────────────────────────────────────

const FALLBACK_PHOTOS = [
  "1552832230-c0197dd311b5","1515542706656-8e1a346fdbe0",
  "1566073771259-470de1bed4f7","1571003123894-1f0594d2b5d9",
  "1530482817083-29ae4b92ff15","1436491865332-7a61a109cc05",
];
let fbIdx = 0;
function nextFallback() {
  const id = FALLBACK_PHOTOS[fbIdx++ % FALLBACK_PHOTOS.length];
  return `https://images.unsplash.com/photo-${id}?w=1920&q=80&fit=crop`;
}
async function unsplashSearch(query, key) {
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

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { act, activity, format } = req.body ?? {};
  if (!act?.trim() && !activity?.trim()) return res.status(400).json({ error: "Missing act or activity name" });
  const jsonOnly = format === "json";

  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) return res.status(500).json({ error: "Missing Airtable configuration (AIRTABLE_TOKEN or AIRTABLE_BASE_ID)" });

  // Activities mode — always JSON (used by the in-presentation picker)
  if (activity?.trim()) {
    return handleActivity(activity.trim(), res, token, baseId);
  }

  // For JSON-only mode we don't need the template
  let template = null;
  if (!jsonOnly) {
    const templatePath = path.resolve(process.cwd(), "template", "loveit_template.html");
    try {
      template = fs.readFileSync(templatePath, "utf8");
    } catch {
      return res.status(500).json({ error: "Template file not found" });
    }
  }

  // 1. Smart keyword search — find candidates
  let candidates;
  try {
    candidates = await findActCandidates(act.trim(), token, baseId);
  } catch (e) {
    return res.status(502).json({ error: `Airtable search error: ${e.message}` });
  }

  if (candidates.length === 0) {
    return res.status(404).json({ error: `"${act}" not found in Artists. Check the name and try again.` });
  }

  // Determine which artist to use
  let selectedName;
  const inputLower = act.trim().toLowerCase();
  const exact = candidates.find(c => c.name.toLowerCase() === inputLower);
  if (exact) {
    selectedName = exact.name;
  } else if (candidates.length === 1) {
    // Single partial match — auto-proceed
    selectedName = candidates[0].name;
  } else {
    // Multiple partial matches — return picker
    return res.status(200).json({ status: "fuzzy", candidates });
  }

  // 1b. Fetch full record for the selected artist
  let actRecord;
  try {
    actRecord = await searchAct(selectedName, token, baseId);
  } catch (e) {
    return res.status(502).json({ error: `Airtable fetch error: ${e.message}` });
  }
  if (!actRecord) {
    return res.status(404).json({ error: `"${selectedName}" not found.` });
  }

  // 2. Fetch linked supplier
  let supplier = null;
  if (actRecord.supplierIds.length > 0) {
    supplier = await getSupplier(actRecord.supplierIds[0], token, baseId);
  }

  // 3. Fetch Media records for photos
  const mediaRecords = await getMediaRecords(actRecord.mediaIds, token, baseId);

  // 4. Build photo + video lists from Media records.
  // Photos and videos are NOT mutually exclusive — a "Consolidated Photos and Videos"
  // record can carry image attachments AND a video Drive Link simultaneously.
  // Rule: always extract image file attachments as photos; only extract an embeddable
  // video from the Drive Link field (or explicit video file URLs in File).
  const photoUrls = [];
  const videosFromMedia = [];

  for (const m of mediaRecords) {
    // Always extract image attachments (filter out video file extensions)
    const imageUrls = m.fileUrls.filter(u => !/\.(mp4|webm|ogg)(\?|$)/i.test(u));
    photoUrls.push(...imageUrls);

    // Extract video: Drive Link first (YouTube/Vimeo/GDrive), then explicit video files
    const videoRawUrl = m.driveLink
      || m.fileUrls.find(u => /\.(mp4|webm|ogg)(\?|$)/i.test(u))
      || null;
    if (videoRawUrl) {
      const embedUrl = toEmbedUrl(videoRawUrl);
      if (embedUrl) {
        videosFromMedia.push({
          embedUrl,
          sourceUrl: videoRawUrl,
          isFile: /\.(mp4|webm|ogg)(\?|$)/i.test(videoRawUrl),
          title: m.description || "Performance",
        });
      }
    }
  }

  // 5. Build video list from "Video Links" field (more reliable source)
  const videosFromField = parseVideoLinks(actRecord.videoLinks)
    .map(({ url, label }) => {
      const embedUrl = toEmbedUrl(url);
      if (!embedUrl) return null;
      return {
        embedUrl,
        sourceUrl: url,
        isFile: /\.(mp4|webm|ogg)(\?|$)/i.test(url),
        title: label || "Performance",
      };
    })
    .filter(Boolean);

  // Prefer field videos if present, otherwise use Media videos — max 6, real YT titles
  const videos = (videosFromField.length > 0 ? videosFromField : videosFromMedia).slice(0, 6);
  await enrichYouTubeTitles(videos);

  // 6. Cover photo
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  const cityName    = supplier?.city || "Italy";
  const mainPhoto   = photoUrls[0]
    || await unsplashSearch(`${cityName} italy luxury performance venue`, unsplashKey);

  // 7. Build TRIP JSON
  const actName    = actRecord.name;
  const description = actRecord.notes
    || supplier?.description
    || `An exclusive performance experience featuring ${actName}.`;

  const tripObj = {
    client:            "",
    projectRef:        "",
    title:             actName,
    destination:       cityName,
    country:           "Italy",
    dates:             "",
    nights:            0,
    pax:               0,
    tagline:           `An unforgettable performance experience`,
    cityPhoto:         mainPhoto,
    cityPhotoPosition: "center center",
    days: [{
      number:   1,
      date:     "",
      label:    actName,
      activities: [{
        showSlide:     true,
        type:          actRecord.type || "activity",
        title:         actName,
        description,
        supplierName:  supplier?.name || actName,
        photo:         mainPhoto,
        photoPosition: "center center",
        photos:        photoUrls.slice(1, 4),
        allPhotos:     photoUrls,
        videos,
        options:       [],
      }],
    }],
    closing: {
      photo:         mainPhoto,
      photoPosition: "center center",
      headline:      "Let's make it happen.",
      subline:       `Contact us to include ${actName} in your programme.`,
      contact:       "marco@loveit-dmc.com",
    },
  };

  // 8a. JSON-only mode: return slide data without rendering HTML
  if (jsonOnly) {
    return res.status(200).json({
      act:         actName,
      description,
      supplier:    supplier?.name || null,
      mainPhoto,
      photos:      photoUrls,
      videos,
    });
  }

  // 8. Inject into template
  let finalHtml;
  try {
    finalHtml = injectTrip(template, tripObj);
  } catch (e) {
    return res.status(500).json({ error: `Template error: ${e.message}` });
  }

  // 9. Hide cover / overview / closing + inject API base for in-presentation features
  const proto = req.headers["x-forwarded-proto"] || "https";
  const apiBase = `${proto}://${req.headers.host}`;
  const actCss = `<style>
    .slide-cover, .slide-overview, .slide-closing { display: none !important; }
  </style>`;
  const apiScript = `<script>window.LOVEIT_API_BASE="${apiBase}";</script>`;
  finalHtml = finalHtml.replace("</head>", actCss + "\n" + apiScript + "\n</head>");

  const safeFilename = actName.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);

  return res.status(200).json({
    html:       finalHtml,
    filename:   `${safeFilename}_scheda.html`,
    act:        actName,
    city:       cityName,
    photoCount: photoUrls.length,
    videoCount: videos.length,
  });
}
