// scrape-tenders.cjs
// סקרייפר ממוקד ל־MR.gov שמחזיר מכרזים רלוונטיים לדפוס בלבד
// + ✅ חדש: סקרייפר למכרזים באתר מכבי (bids) עם פילטר “משרד”

const cheerio = require("cheerio");

const MR_BASE = "https://www.mr.gov.il";
const MR_SEARCH_URL =
  "https://www.mr.gov.il/ilgstorefront/he/search/?q=%3AupdateDate%3Aarchive%3Afalse&s=TENDER&text=";

// ✅ חדש: מכבי – עמוד מכרזים ורכש
const MACCABI_BIDS_URL = "https://www.maccabi4u.co.il/bids/";
const MACCABI_BASE = "https://www.maccabi4u.co.il";

const MACCABI_OFFICE_AREA = "משרד";
const MACCABI_REQUIRED_TOPIC = "בקשות להצעות מחיר/מידע";

// מילות מפתח בתחום הדפוס
// ✅ עודכן לפי בקשתך: הוספת "דיוור", "עיטוף", "מעטפות"
const PRINT_KEYWORDS = ["דפוס", "הדפסה", "דפס", "דיוור", "עיטוף", "מעטפות"];

// בדיקה האם טקסט מכיל אחת ממילות המפתח
function hasPrintKeyword(text) {
  if (!text) return false;
  const t = text.toString();
  return PRINT_KEYWORDS.some((kw) => t.includes(kw));
}

// חילוץ כל התאריכים בפורמט DD/MM/YYYY
function extractDates(text) {
  if (!text) return { publishDate: null, deadline: null };

  const dates = text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
  if (dates.length < 2) {
    return { publishDate: null, deadline: null };
  }

  // בהנחה: התאריך הראשון הוא "תאריך פרסום", האחרון הוא "מועד אחרון להגשה"
  return {
    publishDate: dates[0],
    deadline: dates[dates.length - 1],
  };
}

// חילוץ גוף מפרסם מתוך הטקסט (אם קיים)
function extractOrganization(text) {
  if (!text) return "";
  const m = text.match(/שם\s+המפרסם[:\s]*([^|]+?)(?=\s{2,}|$)/);
  return m ? m[1].trim() : "";
}

/**
 * הבאת מכרזים רלוונטיים לדפוס מ־MR.gov
 * effectiveQuery – המחרוזת שנשלחת לשדה החיפוש באתר (למשל "דפוס הדפסה דפס")
 */
async function fetchPrintTendersFromMR(effectiveQuery) {
  const query = (effectiveQuery || PRINT_KEYWORDS.join(" ")).trim();
  const url = MR_SEARCH_URL + encodeURIComponent(query);

  console.log("MR.gov URL:", url);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    console.error("✖ שגיאה ב־MR.gov, סטטוס:", res.status);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];

  // נעבור על כל הלינקים – אבל נבדוק את ה"בלוק" שסביבם
  $("a").each((i, el) => {
    const href = $(el).attr("href");
    let title = $(el).text().trim();

    if (!href || !title) return;

    // ננקה רווחים מיותרים
    title = title.replace(/\s+/g, " ");

    // נבנה URL מלא
    const fullUrl = href.startsWith("http") ? href : MR_BASE + href;

    // סינון קישורים מובהקים שהם *לא* כרטיס מכרז
    if (
      /\/(lobby|news|register|about|contact|regulations|info)\b/.test(fullUrl)
    ) {
      return;
    }

    // נחפש div (או בלוק דומה) הקרוב ללינק, שהטקסט שלו מכיל את הפרטים
    const block = $(el).closest("div");
    const blockText = block.text().replace(/\s+/g, " ").trim();

    // רק אם בבלוק יש מילות מפתח של דפוס – אנחנו ממשיכים
    if (!hasPrintKeyword(blockText)) {
      return;
    }

    // חילוץ תאריכים
    const { publishDate, deadline } = extractDates(blockText);
    if (!publishDate || !deadline) {
      // בלי תאריכים – לא מציגים באפליקציה
      return;
    }

    const organization = extractOrganization(blockText);

    results.push({
      id: `mr-${results.length + 1}`,
      title,
      organization: organization || "",
      publishDate,
      deadline,
      status: "טרם טופל",
      description: "",
      tenderUrl: fullUrl,
    });
  });

  console.log(
    `✔ נמצאו ${results.length} מכרזים רלוונטיים לדפוס עם תאריכים (MR.gov)`
  );

  return results;
}

/* ============================================================
   ✅ מכבי – מכרזים ורכש: area="משרד" + topic="בקשות להצעות מחיר/מידע"
   תיקון קריטי:
   - לא מחפשים "משרד" בטקסט הגלוי (blockText)
   - מחלצים JSON מתוך data-item-search ומסננים לפי area/topic
   - לוקחים קישור "לפרטי הבקשה" (PDF) אם קיים; אחרת data-request-url
============================================================ */

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
  return String(str).replace(/\s+/g, " ").trim();
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

function normalizeDateToDMY(value) {
  if (!value) return "";

  const s = String(value).trim();
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
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
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

async function fetchOfficeTendersFromMaccabi() {
  try {
    console.log("Maccabi bids URL:", MACCABI_BIDS_URL);

    const res = await fetch(MACCABI_BIDS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "he,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.error("✖ שגיאה ב־Maccabi bids, סטטוס:", res.status);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const results = [];

    // ✅ כל כרטיס באתר מכבי נמצא בתוך div.michrazim-item עם data-item-search
    $(".michrazim-item").each((idx, el) => {
      const $item = $(el);

      const itemId = normalizeSpaces($item.attr("data-item-id") || "");
      const itemSearchRaw = $item.attr("data-item-search") || "";
      const itemSearch = safeJsonParse(itemSearchRaw) || {};

      const area = normalizeSpaces(itemSearch.area || "");
      const topic = normalizeSpaces(itemSearch.topic || $item.attr("data-topic") || "");

      // ✅ חוקיות מכבי בלבד
      if (!area.includes(MACCABI_OFFICE_AREA)) return;
      if (!topic.includes(MACCABI_REQUIRED_TOPIC)) return;

      // כותרת: עדיפות ל-data-popover-content ואז h2
      let title = "";
      const pop = $item.find(".popover-title-box").attr("data-popover-content") || "";
      if (pop) title = normalizeSpaces(decodeHtmlEntities(pop));
      if (!title) {
        title = normalizeSpaces(decodeHtmlEntities($item.find("h2").first().text()));
      }
      if (!title) return;

      // תאריכים מה-JSON
      const publishDate = normalizeDateToDMY(itemSearch.publicationDate || "");
      const deadline = normalizeDateToDMY(itemSearch.deadline || "");

      // קישור "לפרטי הבקשה" (PDF)
      const docHref =
        $item.find('a.more-info[aria-label="לפרטי הבקשה"]').attr("href") ||
        $item
          .find("a.more-info")
          .filter((i, a) => normalizeSpaces($(a).text()) === "לפרטי הבקשה")
          .first()
          .attr("href") ||
        "";

      const docUrl = makeAbsUrl(docHref);

      // fallback: request url (pop up endpoint)
      const requestRel = $item.attr("data-request-url") || "";
      const requestUrl = makeAbsUrl(requestRel);

      const tenderUrl = docUrl || requestUrl || MACCABI_BIDS_URL;

      // id יציב
      const stableId = itemId ? `maccabi-${itemId}` : `maccabi-${results.length + 1}`;

      results.push({
        id: stableId,
        title,
        organization: "מכבי שירותי בריאות",
        publishDate: publishDate || "",
        deadline: deadline || "",
        status: "טרם טופל",
        description: area ? `תחום: ${area}` : "",
        tenderUrl,
      });
    });

    // מניעת כפילויות לפי URL
    const uniq = [];
    const seen = new Set();
    for (const t of results) {
      const k = (t.tenderUrl || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(t);
    }

    console.log(
      `✔ נמצאו ${uniq.length} מכרזים במכבי עם פילטר area="${MACCABI_OFFICE_AREA}" + topic="${MACCABI_REQUIRED_TOPIC}"`
    );

    return uniq;
  } catch (err) {
    console.error("✖ שגיאה בסקרייפר מכבי:", err);
    return [];
  }
}

// ייצוא לפלאגין השרת
module.exports = {
  fetchPrintTendersFromMR,
  fetchOfficeTendersFromMaccabi,
};

// הרצה ישירה מהטרמינל לבדיקת הסקרייפר
if (require.main === module) {
  (async () => {
    console.log(
      "מריץ בדיקת משיכה מ־MR.gov עבור מילות המפתח דפוס / הדפסה / דפס..."
    );
    const tenders = await fetchPrintTendersFromMR("דפוס הדפסה דפס");

    console.log("סה\"כ מכרזים שחולצו:", tenders.length);
    console.log("3 הראשונים לדוגמה:\n");

    tenders.slice(0, 3).forEach((t, idx) => {
      console.log(`(${idx + 1}) ${t.title}`);
      console.log(`   גוף מפרסם: ${t.organization || "(לא זוהה)"}`);
      console.log(`   תאריך פרסום: ${t.publishDate || "(חסר)"}`);
      console.log(`   מועד הגשה: ${t.deadline || "(חסר)"}`);
      console.log(`   URL: ${t.tenderUrl}`);
      console.log("------------------------------------");
    });

    console.log("\nמריץ בדיקת משיכה ממכבי (משרד + בקשות להצעות מחיר/מידע)...");
    const m = await fetchOfficeTendersFromMaccabi();
    console.log("סה\"כ מכרזים במכבי (משרד):", m.length);
    m.slice(0, 5).forEach((t, idx) => {
      console.log(`(${idx + 1}) ${t.title}`);
      console.log(`   גוף מפרסם: ${t.organization}`);
      console.log(`   תאריך פרסום: ${t.publishDate || "(חסר)"}`);
      console.log(`   מועד אחרון: ${t.deadline || "(חסר)"}`);
      console.log(`   URL: ${t.tenderUrl}`);
      console.log("------------------------------------");
    });
  })().catch((err) => {
    console.error("שגיאה בהרצת בדיקת הסקרייפרים:", err);
  });
}
