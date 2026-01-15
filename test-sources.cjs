// test-sources.cjs
// סקריפט בדיקה פשוט לאתרים של מכרזים בענף הדפוס

const https = require("https");

// מילות מפתח רלוונטיות לדפוס
const PRINT_KEYWORDS = ["דפוס", "הדפסה", "דפס"];

// רשימת האתרים לבדיקה
const SITES = [
  {
    name: "ממשל זמין - מכרזים פעילים (MR.gov.il)",
    url: "https://www.mr.gov.il/ilgstorefront/he/search/?q=%3AupdateDate%3Aarchive%3Afalse&text=&s=TENDER",
  },
  {
    name: "IsraelTenders - דף הבית",
    url: "https://www.israeltenders.com",
  },
  {
    name: "Tendersinfo - Israel tenders",
    url: "https://www.tendersinfo.com/global-israel-tenders.php",
  },
  {
    name: "מכרזי מכבי שירותי בריאות",
    url: "https://www.maccabi4u.co.il/bids/",
  },
  {
    name: "מכרזי כללית - בינוי",
    url: "https://www.clalit.co.il/he/info/tenders/Pages/public_binui.aspx",
  },
  {
    name: "מכרזים פעילים - מאוחדת",
    url: "https://www.meuhedet.co.il/%D7%9E%D7%9B%D7%A8%D7%96%D7%99%D7%9D/%D7%9E%D7%9B%D7%A8%D7%96%D7%99%D7%9D-%D7%A4%D7%A2%D7%99%D7%9C%D7%99%D7%9D/",
  },
];

// פונקציה כללית שמביאה HTML מ-URL בעזרת https של Node
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          // User-Agent "אמיתי" כדי שאתרים לא יחסמו אותנו בקלות
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, html: data });
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode} from ${url}`
              )
            );
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.setTimeout(30000, () => {
      req.destroy(new Error("Timeout"));
    });
  });
}

// בודקת הופעה של מילות מפתח בטקסט (בלי רגישות לאותיות סופיות)
function containsPrintKeyword(html) {
  if (!html) return { found: false, counts: {} };

  const text = html.toString();

  const counts = {};
  let found = false;

  for (const kw of PRINT_KEYWORDS) {
    const re = new RegExp(kw, "g");
    const matches = text.match(re);
    const count = matches ? matches.length : 0;
    counts[kw] = count;
    if (count > 0) found = true;
  }

  return { found, counts };
}

// פונקציית הרצה ראשית
async function main() {
  console.log("בודק מקורות מכרזים לענף הדפוס...\n");

  for (const site of SITES) {
    console.log("========================================");
    console.log(`שם האתר: ${site.name}`);
    console.log(`URL: ${site.url}\n`);

    try {
      const { status, html } = await fetchHtml(site.url);

      console.log(`✓ סטטוס HTTP: ${status}`);

      const length = html.length;
      console.log(`✓ אורך HTML שהתקבל: ${length.toLocaleString()} תווים`);

      const { found, counts } = containsPrintKeyword(html);

      if (found) {
        console.log("✓ נמצאו אזכורים למילות מפתח בתחום הדפוס:");
      } else {
        console.log(
          "⚠ לא נמצאו מילות מפתח ברורות לדפוס (לפי החיפוש הפשוט שלנו)."
        );
      }

      for (const kw of PRINT_KEYWORDS) {
        console.log(`   - "${kw}": ${counts[kw]} הופעות`);
      }

      const snippet = html
        .replace(/\s+/g, " ")
        .slice(0, 200);

      console.log("\nקצת מה־HTML (לבדיקה ידנית):");
      console.log(snippet + (html.length > 200 ? "..." : ""));
    } catch (err) {
      console.log("✗ שגיאה בעת הפנייה לאתר:");
      console.log("  " + err.message);
    }

    console.log("\n"); // רווח בין אתרים
  }

  console.log("סיום בדיקת כל האתרים.");
}

// הרצה
main().catch((err) => {
  console.error("שגיאה כללית:", err);
});
