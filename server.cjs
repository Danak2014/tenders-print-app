console.log(">>> server.cjs loaded <<<");

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

// שרת API שמחזיר מכרזים אמיתיים מ־MR.gov בתחום הדפוס
// ✅ מחזירים תמיד submissionStart + deadline מנורמלים DD/MM/YYYY
// ✅ publishDate מוחזר רק אם קיים "פרסום אמיתי" (וגם מנורמל)
// ✅ תיקון חשוב: אם יש מועד תחילת הגשה אמיתי בעמוד – נעדיף אותו (למשל 08/01/2026)

const http = require("http");
const url = require("url");
const https = require("https");
const zlib = require("zlib");

const { fetchPrintTendersFromMR, fetchOfficeTendersFromMaccabi } = require("./scrape-tenders.cjs");

const PORT = 8787;

// מילות המפתח הקבועות לתחום הדפוס
const PRINT_KEYWORDS = ["דפוס", "הדפסה", "דפס", "דיוור", "עיטוף", "מעטפות"];

// בניית שאילתה אפקטיבית – בלי OR, רק מילים מופרדות ברווחים
function buildEffectiveQuery(rawQuery) {
  const q = (rawQuery || "").toString().trim();
  if (!q) return PRINT_KEYWORDS.join(" ");

  const cleaned = q.replace(/\s+OR\s+/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned || PRINT_KEYWORDS.join(" ");
}

/* ------------------------------
   ✅ עזר: נרמול תאריכים לפורמט DD/MM/YYYY
   תומך גם במחרוזות עם שעה כמו: "08:00, 08/01/2026"
   ותומך גם בנקודות: 08.01.2026
-------------------------------- */
function normalizeDateToDMY(value) {
  if (!value) return "";

  const s = value.toString().trim();
  if (!s) return "";

  const m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (!m) return "";

  let dd = parseInt(m[1], 10);
  let mm = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);

  if (yy < 100) yy = 2000 + yy;

  if (!(dd >= 1 && dd <= 31)) return "";
  if (!(mm >= 1 && mm <= 12)) return "";
  if (!(yy >= 1900 && yy <= 2100)) return "";

  const DD = String(dd).padStart(2, "0");
  const MM = String(mm).padStart(2, "0");
  const YYYY = String(yy);

  return `${DD}/${MM}/${YYYY}`;
}

// ניסיון לחלץ "תאריך פרסום אמיתי" אם קיים בשדות שונים שהסקרייפר יכול להחזיר
function pickRealPublishDate(t) {
  if (!t || typeof t !== "object") return "";

  const candidates = [
    t.realPublishDate,
    t.publishDateReal,
    t.publish_date,
    t.publicationDate,
    t.publication_date,
    t.datePublished,
    t.publishedAt,
    t.published_at,
    t.publish,
    t["תאריך פרסום"],
    t["תאריך_פרסום"],
  ];

  for (const c of candidates) {
    const norm = normalizeDateToDMY(c);
    if (norm) return norm;
  }

  return "";
}

/* ------------------------------
   עזר: הורדת HTML (כולל br/gzip)
-------------------------------- */
function getUrlBuffer(targetUrl, timeoutMs = 12000) {
  return new Promise((resolve) => {
    try {
      const req = https.request(
        targetUrl,
        {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "he,en;q=0.9",
            "Accept-Encoding": "br, gzip, deflate",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              encoding: (res.headers["content-encoding"] || "").toString(),
              buffer: buf,
            });
          });
        }
      );

      req.on("error", () =>
        resolve({ ok: false, status: 0, encoding: "", buffer: Buffer.alloc(0) })
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ ok: false, status: 0, encoding: "", buffer: Buffer.alloc(0) });
      });

      req.end();
    } catch {
      resolve({ ok: false, status: 0, encoding: "", buffer: Buffer.alloc(0) });
    }
  });
}

function decodeBody({ encoding, buffer }) {
  return new Promise((resolve) => {
    if (!buffer || !buffer.length) return resolve("");

    const enc = (encoding || "").toLowerCase();

    const finish = (err, out) => {
      if (err || !out) return resolve(buffer.toString("utf8"));
      resolve(out.toString("utf8"));
    };

    if (enc.includes("br")) return zlib.brotliDecompress(buffer, finish);
    if (enc.includes("gzip")) return zlib.gunzip(buffer, finish);
    if (enc.includes("deflate")) return zlib.inflate(buffer, finish);

    return resolve(buffer.toString("utf8"));
  });
}

async function fetchHtmlReliable(targetUrl) {
  const resp = await getUrlBuffer(targetUrl, 12000);
  if (!resp.ok) return "";
  const html = await decodeBody(resp);
  return html || "";
}

/* ------------------------------
   חילוץ טקסט “נקי” מתוך HTML
-------------------------------- */
function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, " ");
}

function normalizeSpaces(str) {
  if (!str) return "";
  return str.replace(/\s+/g, " ").trim();
}

/* ------------------------------
   ✅ חילוץ שדה לפי "כותרת" בעברית בעמוד MR
-------------------------------- */
function extractFieldFromMrHtml(html, anchorLabel) {
  if (!html) return "";

  const clean = normalizeSpaces(decodeHtmlEntities(stripTags(html)));
  const idx = clean.indexOf(anchorLabel);
  if (idx === -1) return "";

  const tail = clean.slice(idx);

  const after = tail.split(":").slice(1).join(":");
  if (!after) return "";

  // מילות עצירה שמתחילות שדות אחרים
  const stopWords = [
    "מס' פרסום",
    "מס׳ פרסום",
    "סטטוס",
    "מס׳ הליך",
    "מס' הליך",
    "תאריך פרסום",
    "תאריך עדכון",
    "מועד תחילת ההגשה",
    "מועד אחרון להגשה",
    "שם המפרסם",
    "פניה למפרסם",
    "מסמכים נלווים",
    "תיאור",
  ];

  let candidate = after;
  for (const sw of stopWords) {
    const p = candidate.indexOf(sw);
    if (p !== -1) candidate = candidate.slice(0, p);
  }

  const value = normalizeSpaces(candidate);
  return value.replace(/^[:\-–—\s]+/, "").replace(/[:\-–—\s]+$/, "");
}

function extractPublisherFromMrHtml(html) {
  const publisher = extractFieldFromMrHtml(html, "שם המפרסם");
  if (!publisher || publisher === "לא צויין" || publisher === "לא צוין") return "";
  if (publisher.length < 2) return "";
  return publisher;
}

function extractSubmissionStartFromMrHtml(html) {
  // "מועד תחילת ההגשה: 08:00, 08/01/2026"
  const raw = extractFieldFromMrHtml(html, "מועד תחילת ההגשה");
  return normalizeDateToDMY(raw);
}

function extractDeadlineFromMrHtml(html) {
  // "מועד אחרון להגשה: 14:00 17/12/2025" או דומה
  const raw = extractFieldFromMrHtml(html, "מועד אחרון להגשה");
  return normalizeDateToDMY(raw);
}

function extractPublishDateFromMrHtml(html) {
  // "תאריך פרסום: 12/11/2025"
  const raw = extractFieldFromMrHtml(html, "תאריך פרסום");
  return normalizeDateToDMY(raw);
}

/* ------------------------------
   המרה: מה שמגיע מהסקרייפר -> פורמט ה-API החדש
-------------------------------- */
function remapTenderDates(t) {
  if (!t || typeof t !== "object") return t;

  const submissionRaw =
    (t.submissionStart || "").toString().trim() ||
    (t.submission_start || "").toString().trim() ||
    (t.submissionStartDate || "").toString().trim() ||
    (t.startDate || "").toString().trim() ||
    (t.start_date || "").toString().trim() ||
    (t.publishDate || "").toString().trim() || // תאימות אחורה
    "";

  const submissionStart = normalizeDateToDMY(submissionRaw);

  const deadlineRaw =
    (t.deadline || "").toString().trim() ||
    (t.submissionDeadline || "").toString().trim() ||
    (t.lastDate || "").toString().trim() ||
    (t.closeDate || "").toString().trim() ||
    (t["מועד אחרון להגשה"] || "").toString().trim() ||
    "";

  const deadline = normalizeDateToDMY(deadlineRaw);

  const realPublish = pickRealPublishDate(t);

  const out = { ...t };

  out.submissionStart = submissionStart || "";
  out.deadline = deadline || "";

  if (realPublish) out.publishDate = realPublish;
  else delete out.publishDate;

  return out;
}

function remapTendersDates(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map(remapTenderDates);
}

/* ------------------------------
   מקביליות + Cache + ✅ העשרה מהעמוד: publisher + submissionStart + deadline + publishDate
-------------------------------- */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichTendersWithMrPageData(tenders) {
  const cache = new Map(); // tenderUrl -> { publisher, submissionStart, publishDate, deadline }
  const list = Array.isArray(tenders) ? tenders : [];

  return mapWithConcurrency(list, 4, async (t) => {
    try {
      if (!t || typeof t !== "object") return t;

      const link = (t.tenderUrl || t.url || "").toString().trim();
      if (!link) return t;

      // ✅ שינוי מינימלי: העשרת MR בלבד (לא נוגעים במכבי)
      if (!link.includes("mr.gov.il/ilgstorefront")) return t;

      if (cache.has(link)) {
        const c = cache.get(link) || {};
        return {
          ...t,
          organization: (t.organization || "").toString().trim() || c.publisher || "",
          submissionStart: (t.submissionStart || "").toString().trim() || c.submissionStart || "",
          publishDate: (t.publishDate || "").toString().trim() || c.publishDate || "",
          deadline: (t.deadline || "").toString().trim() || c.deadline || "",
        };
      }

      const html = await fetchHtmlReliable(link);
      if (!html) {
        cache.set(link, { publisher: "", submissionStart: "", publishDate: "", deadline: "" });
        return t;
      }

      const publisher = extractPublisherFromMrHtml(html) || "";
      const pageSubmissionStart = extractSubmissionStartFromMrHtml(html) || "";
      const pagePublishDate = extractPublishDateFromMrHtml(html) || "";
      const pageDeadline = extractDeadlineFromMrHtml(html) || "";

      cache.set(link, {
        publisher,
        submissionStart: pageSubmissionStart,
        publishDate: pagePublishDate,
        deadline: pageDeadline,
      });

      // ✅ החוקיות שביקשת:
      // 1) מועד תחילת הגשה (מהעמוד) אם יש
      // 2) אחרת תאריך פרסום (מהעמוד) אם יש
      // 3) אחרת מה שיש כבר בנתונים (submissionStart/publishDate)
      const currentStartNorm = normalizeDateToDMY(t.submissionStart || "");
      const currentPublishNorm = normalizeDateToDMY(t.publishDate || "");

      const betterStart =
        pageSubmissionStart ||
        pagePublishDate ||
        currentStartNorm ||
        currentPublishNorm ||
        "";

      const currentDeadlineNorm = normalizeDateToDMY(t.deadline || "");
      const betterDeadline = currentDeadlineNorm || pageDeadline || "";

      return {
        ...t,
        organization: (t.organization || "").toString().trim() || publisher || "",
        submissionStart: betterStart,
        // נשמר publishDate אם קיים (בעיקר לצרכי דיבוג/תצוגה)
        publishDate: currentPublishNorm || pagePublishDate || t.publishDate || "",
        deadline: betterDeadline,
      };
    } catch {
      return t;
    }
  });
}

/* ------------------------------
   השרת עצמו
-------------------------------- */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const { pathname, query } = parsedUrl;

  // CORS – כדי שה־React ב־5173 יוכל לגשת
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ✅ Health
  if (pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "tenders-api",
        port: PORT,
        time: new Date().toISOString(),
      })
    );
    return;
  }

  if (pathname === "/api/tenders" && req.method === "GET") {
    try {
      const incomingQuery = query.q || "";
      console.log("Incoming query:", incomingQuery);

      const effectiveQuery = buildEffectiveQuery(incomingQuery);
      console.log("Effective query used:", effectiveQuery);

      const mrTenders = await fetchPrintTendersFromMR(effectiveQuery);

      // ✅ חדש: משיכת מכרזים מאתר מכבי עם פילטר “משרד”
      const maccabiOfficeTenders = await fetchOfficeTendersFromMaccabi();

      // ✅ מיזוג + מניעת כפילויות לפי URL
      const merged = [];
      const seen = new Set();

      const pushUnique = (t) => {
        const key = (t && (t.tenderUrl || t.url)) ? String(t.tenderUrl || t.url).trim() : "";
        const fallbackKey = t && t.id ? String(t.id) : "";
        const k = key || fallbackKey;
        if (!k) return;
        if (seen.has(k)) return;
        seen.add(k);
        merged.push(t);
      };

      mrTenders.forEach(pushUnique);
      maccabiOfficeTenders.forEach(pushUnique);

      // ✅ העשרה: MR בלבד
      const enriched = await enrichTendersWithMrPageData(merged);

      // ✅ נרמול תאריכים + שני שדות קבועים
      const remapped = remapTendersDates(enriched);

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(remapped));
    } catch (err) {
      console.error("שגיאה בטיפול בבקשה ל-/api/tenders:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "שגיאה בשרת בעת משיכת מכרזים" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

// ✅ לוגים כדי לוודא שהשרת באמת מאזין ולא נסגר
console.log(">>> about to listen on", PORT);

server.listen(PORT, () => {
  console.log(`API server is running on http://localhost:${PORT}/api/tenders`);
});

console.log(">>> listen() called");
