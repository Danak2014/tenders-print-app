// scrape-maccabi.cjs
// ✅ מכבי בלבד: חילוץ מכרזים מתוך https://www.maccabi4u.co.il/bids/
// ✅ לא תלוי ב-UI (בחירות "משרד" / "בקשות להצעות מחיר/מידע") - מסננים לפי data-item-search
// ✅ מחזיר tenderUrl עדיף ל-PDF של "לפרטי הבקשה" אם קיים, אחרת ל-endpoint של Umbraco

const https = require("https");
const zlib = require("zlib");

const MACCABI_BIDS_URL = "https://www.maccabi4u.co.il/bids/";
const MACCABI_BASE = "https://www.maccabi4u.co.il";

// חוקיות מכבי בלבד (כפי שהגדרת)
const MACCABI_REQUIRED_AREA = "משרד";
const MACCABI_REQUIRED_TOPIC = "בקשות להצעות מחיר/מידע";

/* ------------------------------
   HTTP fetch (כולל br/gzip)
-------------------------------- */
function getUrlBuffer(targetUrl, timeoutMs = 15000) {
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
            Connection: "close",
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
  const resp = await getUrlBuffer(targetUrl, 15000);
  if (!resp.ok) return "";
  const html = await decodeBody(resp);
  return html || "";
}

/* ------------------------------
   Utilities
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

function normalizeSpaces(str) {
  if (!str) return "";
  return str.toString().replace(/\s+/g, " ").trim();
}

function safeJsonParse(str) {
  try {
    if (!str) return null;
    const s = decodeHtmlEntities(str).trim();
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// תומך גם ב:
// 2025/12/22  | 22.12.2025 | 05.01.2026 | 28/12/2025
function normalizeDateToDMY(value) {
  if (!value) return "";
  const s = value.toString().trim();
  if (!s) return "";

  // yyyy/mm/dd
  let m = s.match(/(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/);
  if (m) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
    }
  }

  // dd/mm/yyyy or dd.mm.yyyy
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (m) {
    let dd = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);
    let yy = parseInt(m[3], 10);
    if (yy < 100) yy = 2000 + yy;

    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy >= 1900 && yy <= 2100) {
      return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yy)}`;
    }
  }

  return "";
}

function makeAbsUrl(href) {
  const h = (href || "").toString().trim();
  if (!h) return "";
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("/")) return MACCABI_BASE + h;
  return MACCABI_BASE + "/" + h;
}

/* ------------------------------
   Extract cards from HTML
-------------------------------- */
function extractMaccabiCardsFromHtml(html) {
  const src = html || "";
  const out = [];

  const marker = 'class="michrazim-item';
  let pos = 0;
  const starts = [];

  while (true) {
    const i = src.indexOf(marker, pos);
    if (i === -1) break;
    starts.push(i);
    pos = i + marker.length;
  }

  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1] : src.length;
    const block = src.slice(start, end);

    const idMatch = block.match(/data-item-id="([^"]+)"/i);
    const itemId = idMatch ? idMatch[1].trim() : "";

    const itemSearchMatch = block.match(/data-item-search="([^"]+)"/i);
    const itemSearchRaw = itemSearchMatch ? itemSearchMatch[1] : "";
    const itemSearchObj = safeJsonParse(itemSearchRaw) || {};

    const area =
      normalizeSpaces(itemSearchObj.area || itemSearchObj.Area || "") ||
      normalizeSpaces((block.match(/data-area="([^"]+)"/i) || [])[1] || "");

    const topic =
      normalizeSpaces(itemSearchObj.topic || itemSearchObj.Topic || "") ||
      normalizeSpaces((block.match(/data-topic="([^"]+)"/i) || [])[1] || "");

    const publicationDate = normalizeSpaces(itemSearchObj.publicationDate || itemSearchObj.publication_date || "");
    const deadline = normalizeSpaces(itemSearchObj.deadline || itemSearchObj.submissionDeadline || "");

    // Title: עדיפות ל-data-popover-content ואז <h2>
    let title = "";
    const popTitle = (block.match(/data-popover-content="([^"]+)"/i) || [])[1] || "";
    if (popTitle) title = normalizeSpaces(decodeHtmlEntities(popTitle));

    if (!title) {
      const h2 = (block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || "";
      title = normalizeSpaces(decodeHtmlEntities(h2.replace(/<[^>]*>/g, " ")));
    }

    // מסמך "לפרטי הבקשה" (PDF לרוב)
    const docHref =
      (block.match(/href="([^"]+)"[^>]*aria-label="לפרטי הבקשה"/i) || [])[1] ||
      (block.match(/<a[^>]*class="more-info"[^>]*href="([^"]+)"[^>]*>\s*לפרטי הבקשה\s*<\/a>/i) || [])[1] ||
      "";

    const docUrl = makeAbsUrl(docHref);

    // request url (popup endpoint)
    const reqUrlRel = (block.match(/data-request-url="([^"]+)"/i) || [])[1] || "";
    const reqUrlAbs = makeAbsUrl(reqUrlRel);

    const tenderUrl = docUrl || reqUrlAbs || MACCABI_BIDS_URL;

    // רק אם יש לנו מינימום
    if (!itemId && !tenderUrl) continue;

    out.push({
      id: itemId,
      title,
      area,
      topic,
      publicationDate,
      deadline,
      tenderUrl,
      _debug_itemSearch: itemSearchObj,
    });
  }

  return out;
}

/* ------------------------------
   Main: fetch Maccabi office tenders
-------------------------------- */
async function fetchOfficeTendersFromMaccabi() {
  console.log("Maccabi bids URL:", MACCABI_BIDS_URL);

  const html = await fetchHtmlReliable(MACCABI_BIDS_URL);
  if (!html) {
    console.log("✖ מכבי: לא הצלחנו למשוך HTML מהאתר.");
    return [];
  }

  const cards = extractMaccabiCardsFromHtml(html);

  const officeOnly = cards.filter((c) => (c.area || "").includes(MACCABI_REQUIRED_AREA));
  const topicOnly = officeOnly.filter((c) => (c.topic || "").includes(MACCABI_REQUIRED_TOPIC));

  console.log(
    `✔ מכבי: נמצאו ${cards.length} כרטיסים גולמיים, ` +
      `${officeOnly.length} אחרי area="${MACCABI_REQUIRED_AREA}", ` +
      `${topicOnly.length} אחרי topic="${MACCABI_REQUIRED_TOPIC}"`
  );

  // מיפוי לפורמט שהשרת/אפליקציה שלך מצפים
  return topicOnly.map((c) => {
    const pub = normalizeDateToDMY(c.publicationDate);
    const ddl = normalizeDateToDMY(c.deadline);

    // id ייחודי יציב
    const stableId = c.id ? `maccabi-${c.id}` : `maccabi-${Buffer.from(c.tenderUrl || "").toString("hex").slice(0, 16)}`;

    return {
      id: stableId,
      title: c.title || "מכרז מכבי",
      organization: "מכבי שירותי בריאות",
      submissionStart: pub || "",
      publishDate: pub || "",
      deadline: ddl || "",
      status: "טרם טופל",
      description: c.area ? `תחום: ${c.area}` : "",
      tenderUrl: c.tenderUrl || MACCABI_BIDS_URL,

      // שדות עזר לדיבוג (לא מפריע לאפליקציה)
      _source: "maccabi",
      _area: c.area || "",
      _topic: c.topic || "",
      _maccabi_id: c.id || "",
    };
  });
}

// Alias (אם יש לך קוד ישן שמצפה לשם אחר)
async function fetchMaccabiOfficeTendersHtml() {
  return fetchOfficeTendersFromMaccabi();
}

module.exports = {
  fetchOfficeTendersFromMaccabi,
  fetchMaccabiOfficeTendersHtml,
};
