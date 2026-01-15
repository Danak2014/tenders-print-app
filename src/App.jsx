// src/App.jsx
import React, { useState, useMemo, useEffect, useRef } from "react";
import ExcelJS from "exceljs";

/* =========================
   ✅ עזר: פתיחת קישור חיצוני
   - באפליקציית Electron: דרך window.dotAPI.openExternal
   - בדפדפן רגיל: window.open
========================= */
async function openExternalLink(url) {
  try {
    const link = (url || "").toString().trim();
    if (!link) return false;

    // ✅ Electron (preload exposes window.dotAPI.openExternal)
    if (window?.dotAPI?.openExternal) {
      const ok = await window.dotAPI.openExternal(link);
      return !!ok;
    }

    // 🌐 Web fallback
    const w = window.open(link, "_blank", "noopener,noreferrer");
    return !!w;
  } catch (e) {
    console.error("openExternalLink failed:", e);
    return false;
  }
}

/* ===== סגנונות גלובליים ===== */
function GlobalStyles() {
  return (
    <style>{`
      @media (min-width: 1024px) {
        html, body, #root { height: 100dvh; overflow-y: hidden; }
      }

      @media (max-width: 1023.98px) {
        html, body, #root { height: auto; overflow-y: auto; }
        body { scrollbar-width: thin; scrollbar-color: rgba(34,211,238,.35) rgba(2,6,23,.9); }
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #020617; border-radius: 8px; }
        ::-webkit-scrollbar-thumb { background: rgba(34,211,238,.35); border-radius: 8px; border: 2px solid rgba(2,6,23,.9); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(34,211,238,.5); }
      }
    `}</style>
  );
}

/* ===== עזר: המרת תאריך DD/MM/YYYY (גם אם יש שעה/טקסט מסביב) לאובייקט Date ===== */
function parseDMY(d) {
  if (!d) return null;
  const s = d.toString().trim();
  const m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (!m) return null;

  let dd = parseInt(m[1], 10);
  let mm = parseInt(m[2], 10);
  let yyyy = parseInt(m[3], 10);
  if (yyyy < 100) yyyy = 2000 + yyyy;

  const dt = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/* ===== כלל אחיד: "מועד תחילת ההגשה" מוצג לפי submissionStart ואם חסר -> publishDate ===== */
function getStartDateText(t) {
  if (!t) return "";
  const s1 = (t.submissionStart || "").toString().trim();
  if (s1) return s1;
  const s2 = (t.publishDate || "").toString().trim();
  return s2;
}

function getStartDateObj(t) {
  const txt = getStartDateText(t);
  return parseDMY(txt);
}

/* ===== נרמול טקסטים בעברית לחיפוש "שורש" ===== */
function normalizeHebrew(text) {
  if (!text) return "";
  let s = text.toString().toLowerCase();

  // הסרת ניקוד
  s = s.replace(/[\u0591-\u05C7]/g, "");

  // החלפת סימנים לרווח
  s = s.replace(/[^\u0590-\u05FFa-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // נרמול קל: תחיליות רק מתחילת מילה + רבים בסוף מילה
  const prefixes = ["ו", "ה", "ב", "כ", "ל", "מ", "ש"];
  s = s
    .split(" ")
    .map((w) => {
      let ww = w;

      // להסיר תחילית אחת בלבד ורק אם המילה מספיק ארוכה
      if (ww.length >= 4 && prefixes.includes(ww[0])) ww = ww.slice(1);

      // להסיר רבים
      ww = ww.replace(/(ים|ות)$/g, "");

      return ww;
    })
    .join(" ")
    .trim();

  return s;
}

function matchesSearch(t, q) {
  const nq = normalizeHebrew(q);
  if (!nq) return true;
  const hay = normalizeHebrew(`${t?.title || ""} ${t?.organization || ""} ${t?.description || ""}`);
  return hay.includes(nq);
}

/* ===== הוק קטן לאנימציית כניסה/יציאה ===== */
function useMountTransition(isOpen, duration = 250) {
  const [mounted, setMounted] = useState(isOpen);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => setShow(true));
    } else if (mounted) {
      setShow(false);
      const t = setTimeout(() => setMounted(false), duration);
      return () => clearTimeout(t);
    }
  }, [isOpen, mounted, duration]);

  return { mounted, show };
}

/* ===== קבועי סטטוס ===== */
const STATUS_OPTIONS = [
  "טרם טופל",
  "שלחנו הצעה",
  "הצעת מחיר אושרה",
  "הופקה הזמנה",
  "הופקה חשבונית",
  "סגור",
  "לא רלוונטי",
];

const STATUS_BADGE_LABELS = {
  "טרם טופל": "חדש",
  "שלחנו הצעה": "בהצעה",
  "הצעת מחיר אושרה": "אושר",
  "הופקה הזמנה": "בהזמנה",
  "הופקה חשבונית": "חשבונית",
  סגור: "סגור",
  "לא רלוונטי": "לא רלוונטי",
};

const STATUS_BADGE_STYLES = {
  "טרם טופל": "bg-slate-950/85 border-cyan-400/35 text-cyan-50",
  "שלחנו הצעה": "bg-cyan-500/10 border-cyan-300/60 text-cyan-50",
  "הצעת מחיר אושרה": "bg-emerald-500/10 border-emerald-400/50 text-emerald-50",
  "הופקה הזמנה": "bg-sky-500/10 border-sky-400/45 text-sky-50",
  "הופקה חשבונית": "bg-indigo-500/10 border-indigo-400/45 text-indigo-50",
  סגור: "bg-slate-900/75 border-slate-400/40 text-slate-50",
  "לא רלוונטי": "bg-slate-800/80 border-slate-500/70 text-slate-100",
};

/* ✅ ברירת מחדל לחיפוש (כולל "מודפס" כדי לתפוס "קרטון מודפס" וכד') */
const DEFAULT_PRINT_QUERY = "דפוס OR הדפסה OR דפס OR מודפס OR דיוור OR עיטוף OR מעטפות";

/* ✅ תנאי חד־משמעי: תמיד מוסיפים גם את תחום/קטגוריה "משרד" כדי שלא נפספס מכרזים שמופיעים רק תחת פילטר זה */
const OFFICE_FILTER_TERM = "משרד";
function ensureOfficeFilter(queryText) {
  const raw = (queryText || "").toString().trim();
  const hasOffice = /\bמשרד\b/.test(raw); // בדיקה פשוטה כדי לא להכפיל
  if (!raw) return OFFICE_FILTER_TERM;
  if (hasOffice) return raw;
  return `${raw} OR ${OFFICE_FILTER_TERM}`;
}

/* ===== שמירת סטטוסים בלוקאל־סטורג' ===== */
const STATUS_STORAGE_KEY = "tendersStatusMap";

function loadStatusMap() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STATUS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStatusMap(map) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // מתעלמים משגיאות אחסון
  }
}

/* ===== אייקון הורדה קטן ===== */
const DownloadIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M6 19h12M12 4v10m0 0 4-4m-4 4-4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ===== דרופדאון סטטוס (עם רקע אטום) ===== */
const StatusSelect = ({ value, onChange, onToggle, dimmed, openUp }) => {
  const [open, setOpen] = useState(false);
  const { mounted, show } = useMountTransition(open, 180);

  const close = () => {
    setOpen(false);
    onToggle && onToggle(false);
  };

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      onToggle && onToggle(next);
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className={
          "w-40 h-9 rounded-xl bg-slate-900/70 border border-cyan-400/20 text-slate-50 text-xs px-3 pr-4 flex items-center justify-between gap-2 focus:outline-none hover:border-cyan-300 transition " +
          (dimmed ? "opacity-30 blur-[1px]" : "")
        }
      >
        <span className="truncate text-right flex-1">{value}</span>
        <span className="text-[11px]">▾</span>
      </button>

      {mounted && (
        <>
          <div className="fixed inset-0 z-40 bg-transparent" onClick={close} />

          <div
            style={{ backgroundColor: "#020617" }}
            className={`absolute right-0 w-44 rounded-xl border border-cyan-400/25 shadow-2xl z-50 overflow-hidden transition-all duration-200 ease-out ${
              openUp ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top"
            } ${show ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-95"}`}
          >
            {STATUS_OPTIONS.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  onChange(st);
                  close();
                }}
                className={`w-full text-right px-4 py-1.5 text-xs ${
                  st === value ? "bg-cyan-500/10 text-cyan-50" : "text-slate-100 hover:bg-slate-900/60"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ===== דרופדאון שנת ארכיון (עיצוב כמו סטטוס) ===== */
const YearSelect = ({ value, options, onChange, onToggle, buttonRef }) => {
  const [open, setOpen] = useState(false);
  const { mounted, show } = useMountTransition(open, 180);

  const close = () => {
    setOpen(false);
    onToggle && onToggle(false);
  };

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      onToggle && onToggle(next);
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="w-24 h-9 rounded-xl bg-slate-900/70 border border-cyan-400/20 text-slate-50 text-xs px-3 flex items-center justify-between gap-2 focus:outline-none hover:border-cyan-300 transition"
      >
        <span className="flex-1 text-center">{value}</span>
        <span className="text-[11px]">▾</span>
      </button>

      {mounted && (
        <>
          <div className="fixed inset-0 z-40 bg-transparent" onClick={close} />

          <div
            style={{ backgroundColor: "#020617" }}
            className={`absolute right-0 top-full mt-2 w-28 rounded-xl border border-cyan-400/25 shadow-2xl z-50 overflow-hidden transition-all duration-200 ease-out origin-top ${
              show ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-95"
            }`}
          >
            {options.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => {
                  onChange(y);
                  close();
                }}
                className={`w-full text-center px-4 py-1.5 text-xs ${
                  y === value ? "bg-cyan-500/10 text-cyan-50" : "text-slate-100 hover:bg-slate-900/60"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ===== מודאל הנחיות ===== */
const InstructionsModal = ({ open, onClose }) => {
  const { mounted, show } = useMountTransition(!!open, 220);
  if (!mounted) return null;

  const handleClose = () => {
    if (!show) return;
    onClose && onClose();
  };

  // ===== SVG Icons (אחידים, מקצועיים) =====
  const IconWrap = ({ children }) => (
    <div className="w-9 h-9 rounded-xl bg-slate-900/60 border border-cyan-400/18 flex items-center justify-center text-cyan-100">
      {children}
    </div>
  );

  const IInfo = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Zm0-11v6m0-9h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const ISearch = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 7.5-7.5A7.5 7.5 0 0 1 10.5 18Zm6.1-1.4L21 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const ICalendar = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3v2M17 3v2M4 8h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 12h3M8 16h3M13 12h3M13 16h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );

  const ICards = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 9h10M7 12h7M7 15h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );

  const IArchive = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4V7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 13h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const IBlock = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 8l8 8M16 8l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );

  const IFilter = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const ITabs = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IWarning = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 9v5m0 3h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const IReport = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const IExport = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v10m0 0 4-4m-4 4-4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 19h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  // ===== Item Card =====
  const Item = ({ icon, title, children, tone = "normal" }) => {
    const toneWrap = tone === "warning" ? "border-amber-300/35 bg-amber-500/5" : "border-cyan-400/12 bg-slate-950/40";

    const titleColor = tone === "warning" ? "text-amber-200" : "text-cyan-50";
    const iconTone =
      tone === "warning"
        ? "text-amber-200 border-amber-300/25 bg-amber-500/5"
        : "text-cyan-100 border-cyan-400/18 bg-slate-900/60";

    return (
      <div className={`rounded-xl border ${toneWrap} px-4 py-2.5`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${iconTone} flex items-center justify-center`}>{icon}</div>
          <div className={`text-[13px] font-semibold ${titleColor}`}>{title}</div>
        </div>
        <div className="mt-1.5 text-[12px] leading-relaxed text-slate-200">{children}</div>
      </div>
    );
  };

  const ScrollbarStyles = () => (
    <style>{`
      /* ===== macOS-style hidden scrollbar ===== */

      /* Firefox */
      .instructions-scroll {
        scrollbar-width: none; /* מוסתר כברירת מחדל */
      }
      .instructions-scroll:hover {
        scrollbar-width: thin;
        scrollbar-color: rgba(34,211,238,.45) rgba(2,6,23,.55);
      }

      /* Chrome / Edge / Safari */
      .instructions-scroll::-webkit-scrollbar {
        width: 10px;
      }

      /* Track – מוסתר כברירת מחדל */
      .instructions-scroll::-webkit-scrollbar-track {
        background: transparent;
      }

      /* Thumb – כמעט בלתי נראה */
      .instructions-scroll::-webkit-scrollbar-thumb {
        background-color: rgba(34,211,238, 0);
        border-radius: 10px;
        border: 2px solid transparent;
        transition: background-color .2s ease, border .2s ease;
      }

      /* Hover על אזור הגלילה */
      .instructions-scroll:hover::-webkit-scrollbar-track {
        background: rgba(2,6,23,.55);
        border-radius: 10px;
        border: 1px solid rgba(34,211,238,.12);
      }

      .instructions-scroll:hover::-webkit-scrollbar-thumb {
        background-color: rgba(34,211,238,.35);
        border: 2px solid rgba(2,6,23,.65);
      }

      /* Hover על ה-thumb עצמו */
      .instructions-scroll::-webkit-scrollbar-thumb:hover {
        background-color: rgba(34,211,238,.55);
      }
    `}</style>
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${
        show ? "bg-slate-950/70" : "bg-slate-950/0"
      } transition-colors duration-200 backdrop-blur-md overflow-y-auto`}
      dir="rtl"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative max-w-xl w-full rounded-2xl border border-cyan-400/15 shadow-[0_0_60px_rgba(0,0,0,0.45)] transition-all duration-200 ease-out transform-gpu ${
          show ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95"
        }`}
        style={{
          background:
            "linear-gradient(180deg, rgba(2,6,23,0.92) 0%, rgba(2,6,23,0.88) 60%, rgba(15,23,42,0.85) 100%)",
        }}
      >
        {" "}
        <ScrollbarStyles />
        {/* Header */}
        <div className="px-5 py-4 border-b border-cyan-400/10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconWrap>
                <IInfo />
              </IconWrap>
              <div>
                <h2 className="text-lg font-semibold text-cyan-50 leading-tight">הנחיות שימוש</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">כללי עבודה, סינונים וייצוא — לפי המערכת</p>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-9 h-9 rounded-xl bg-slate-900/50 border border-cyan-400/15 text-slate-200 hover:text-white hover:border-cyan-300/35 transition flex items-center justify-center"
              aria-label="סגור"
              type="button"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <div className="instructions-scroll space-y-2 max-h-[70vh] overflow-y-auto pr-2">
            <Item icon={<ISearch />} title="שדה חיפוש">
              מיועד לאיתור מכרזים לפי שם גוף מפרסם ו/או מילות מפתח, באמצעות לחיצה על "חפש" או מקש Enter.
            </Item>

            <Item icon={<ICalendar />} title="מועד תחילת ההגשה / תאריך פרסום">
              בכרטיס המכרז מוצג מועד תחילת ההגשה, ובהיעדרו מוצג תאריך הפרסום כמועד הקובע לצורך הצגה וסיווג.
            </Item>

            <Item icon={<ICards />} title='מסך "כרטיסי מכרזים"'>
              מציג מכרזים שמועד הגשת ההצעות בעניינם טרם פקע.
            </Item>

            <Item icon={<IBlock />} title='סימון "לא רלוונטי"'>
              סימון מכרז כ"לא רלוונטי" מעביר אותו למסך "ארכיון" ומסירו ממסך "כרטיסי מכרזים".
            </Item>

            <Item icon={<IArchive />} title='מסך "ארכיון"'>
              מציג מכרזים שמועד ההגשה שלהם פקע בשנת הארכיון שנבחרה, וכן מכרזים שסומנו כ"לא רלוונטי".
            </Item>

            <Item icon={<IFilter />} title="סינון לפי מועד תחילת ההגשה">
              מאפשר הצגת מכרזים שמועד תחילת ההגשה שלהם תואם במדויק לתאריך שהוזן בפורמט DD/MM/YYYY.
            </Item>

            <Item icon={<ITabs />} title='כפתורי "פעילים" / "עתידיים"'>
              מסננים מכרזים בהתאם למועד תחילת ההגשה ביחס למועד הצפייה.
            </Item>

            <Item icon={<IWarning />} title="התראת מועד הגשה מתקרב" tone="warning">
              מוצגת כאשר מועד ההגשה חל בתוך <span className="font-semibold text-amber-200">48 שעות</span> ממועד הצפייה.
            </Item>

            <Item icon={<IReport />} title='מסך "דוח סיכום"'>
              מציג תמונת מצב מרוכזת של המכרזים, לרבות פילוחים, סטטיסטיקות וספירות, בהתאם לנתונים המוצגים במערכת במועד הצפייה.
            </Item>

            <Item icon={<IExport />} title='ייצוא נתונים – מסך "כרטיסי מכרזים"'>
              מפיק קובץ Excel הכולל את רשימת המכרזים המוצגים במסך זה בלבד, בהתאם למסננים הפעילים במועד ההפקה.
            </Item>

            <Item icon={<IExport />} title='ייצוא נתונים – מסך "דוח סיכום"'>
              מפיק קובץ Excel הכולל דוח סיכום ונתונים מפורטים, בהתאם לחלוקות ולסינונים המוצגים במסך דוח הסיכום במועד ההפקה.
            </Item>
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={handleClose}
              className="px-6 py-2 rounded-xl bg-slate-900/70 border border-cyan-400/25 text-slate-50 text-sm hover:bg-slate-900/90 hover:border-cyan-300/40 transition"
              type="button"
            >
              סגור
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ===== מודאל פרטי מכרז ===== */
const TenderDetailsModal = ({ tender, onClose, onStatusChange }) => {
  const isOpen = !!tender;
  const { mounted, show } = useMountTransition(isOpen, 220);
  if (!mounted) return null;

  const handleClose = () => onClose && onClose();
  const organizationText = tender?.organization?.toString().trim() || "לא צוין";
  const startText = getStartDateText(tender) || "לא צוין";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${
        show ? "bg-slate-950/70" : "bg-slate-950/0"
      } transition-colors duration-200 backdrop-blur-sm overflow-y-auto`}
      dir="rtl"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative bg-slate-950/95 border border-cyan-400/15 rounded-2xl max-w-2xl w-full shadow-[0_0_40px_rgba(0,0,0,0.35)] transition-all duration-200 ease-out transform-gpu ${
          show ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95"
        }`}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-cyan-400/10">
          <h2 className="text-lg font-semibold text-cyan-50 text-right">{tender?.title}</h2>
          <button onClick={handleClose} className="text-slate-200 text-sm hover:text-white transition">
            ✕
          </button>
        </header>

        <div className="px-6 py-5 space-y-4 text-sm text-slate-100 text-right">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="text-right min-w-[180px]">
              <p className="text-slate-400 text-xs mb-1">גוף מפרסם</p>
              <p>{organizationText}</p>
            </div>

            <div className="flex gap-6 text-right flex-wrap">
              <div>
                <p className="text-slate-400 text-xs mb-1">מועד תחילת ההגשה</p>
                <p>{startText}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">תוקף הגשה</p>
                <p>{tender?.deadline || "לא צוין"}</p>
              </div>
            </div>
          </div>

          {tender?.description && <p className="text-slate-300 text-xs">{tender.description}</p>}
        </div>

        <div className="flex flex-wrap gap-4 px-6 pb-5 justify-between items-center">
          <StatusSelect value={tender?.status} onChange={(v) => onStatusChange(tender.id, v)} />

          <button
            onClick={async () => {
              const link = tender?.tenderUrl || tender?.url || "";
              const ok = await openExternalLink(link);
              if (!ok) alert("לא ניתן לפתוח את הקישור בסביבה הזו.");
            }}
            className="px-6 py-2 rounded-xl bg-cyan-500/20 text-cyan-50 border border-cyan-400/35 text-xs hover:bg-cyan-500/30 transition"
          >
            פתח מכרז באתר הרשמי
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===== כרטיס מכרז ===== */
const TenderCard = ({
  tender,
  onStatusChange,
  onOpenDetails,
  dimStatusButton,
  onStatusDropdownToggle,
  openUp,
  dimExternally = false,
}) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const badgeLabel = STATUS_BADGE_LABELS[tender.status] || "חדש";
  const badgeClasses = STATUS_BADGE_STYLES[tender.status] || "bg-slate-950/85 border-cyan-400/35 text-cyan-50";

  const handleStatusToggle = (isOpen) => {
    setStatusOpen(isOpen);
    onStatusDropdownToggle && onStatusDropdownToggle(tender.id, isOpen);
  };

  const overlayActive = dimExternally;
  const organizationText = tender.organization?.toString().trim() || "לא צוין";
  const startText = getStartDateText(tender) || "לא צוין";

  return (
    <div
      className={
        "relative bg-gradient-to-br from-slate-950/70 via-slate-950/30 to-slate-900/60 border border-cyan-400/15 rounded-2xl shadow-[0_18px_40px_rgba(15,23,42,0.55)] h-[245px]" +
        (statusOpen ? " z-40" : " z-10")
      }
      data-tender-id={tender.id}
    >
      <div
        className={`absolute inset-0 z-20 rounded-2xl bg-transparent backdrop-blur-[6px] transition-opacity duration-150 ${
          overlayActive ? "opacity-100 pointer-events-none" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      <div className="relative z-10 p-5 flex flex-col h-full">
        <div className="absolute top-4 left-4">
          <span className={"inline-flex items-center rounded-full px-4 py-1 text-[11px] shadow-lg " + badgeClasses}>
            {badgeLabel}
          </span>
        </div>

        {tender.isNearDeadline && (
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center rounded-full bg-amber-400/95 px-3 py-0.5 text-[11px] text-slate-900 shadow-lg">
              ⚠ מועד הגשה מתקרב (עוד {tender.daysToDeadline} ימים)
            </span>
          </div>
        )}

        <div className="mt-8 text-right">
          <div className="h-[48px] overflow-hidden">
            <h3 className="text-[17px] font-semibold text-cyan-50 leading-tight line-clamp-2">{tender.title}</h3>
          </div>

          <div className="mt-2">
            <p className="text-[11px] text-slate-400">גוף מפרסם</p>
            <p className="text-[13px] text-slate-300 truncate whitespace-nowrap">{organizationText}</p>
          </div>
        </div>

        <div className="mt-auto"></div>

        <div className="flex justify-between text-[11px] text-slate-200 mt-3 gap-6">
          <div className="text-right">
            <p className="text-slate-400">מועד תחילת ההגשה</p>
            <p className="mt-0.5">{startText}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">תוקף הגשה</p>
            <p className="mt-0.5">{tender.deadline || "לא צוין"}</p>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between gap-3 sm:flex-nowrap flex-wrap">
          <StatusSelect
            value={tender.status}
            onChange={(v) => onStatusChange(tender.id, v)}
            onToggle={handleStatusToggle}
            dimmed={dimStatusButton}
            openUp={openUp}
          />

          <button
            onClick={onOpenDetails}
            className="h-9 min-w-[145px] px-4 rounded-xl bg-cyan-500/20 text-cyan-50 border border-cyan-400/35 text-xs transition-all duration-300 ease-out whitespace-nowrap text-center hover:bg-cyan-500/30 flex items-center justify-center"
          >
            לחץ לפרטי המכרז
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===== מסך דוח סיכום ===== */
const SummaryView = ({
  baseTenders,
  today,
  onExportExcel,
  nearDeadlineTenders,
  onOpenTenderFromSummary,
  archiveCount,
  archiveYear,
}) => {
  const total = baseTenders.length;

  const future = baseTenders.filter((t) => {
    const d = getStartDateObj(t);
    return d && d > today;
  }).length;

  const active = total - future;

  const statusCounts = useMemo(() => {
    const acc = STATUS_OPTIONS.reduce((obj, st) => {
      obj[st] = 0;
      return obj;
    }, {});
    for (const t of baseTenders) {
      if (acc[t.status] === undefined) acc[t.status] = 0;
      acc[t.status]++;
    }
    return acc;
  }, [baseTenders]);

  const maxCount = Math.max(1, ...Object.values(statusCounts).map((v) => (typeof v === "number" ? v : 0)));

  return (
    <section className="max-w-5xl mx-auto mt-10 flex flex-col gap-8 items-stretch">
      <div className="flex flex-wrap gap-4 justify-center mb-2">
        <button
          onClick={onExportExcel}
          className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-slate-950/70 border border-cyan-400/45 text-sm text-cyan-50 hover:bg-cyan-500/10 transition"
        >
          <DownloadIcon />
          <span>ייצוא דוח סיכום ל-Excel</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-950/80 border border-cyan-400/25 px-6 py-4 text-center">
          <p className="text-xs text-slate-400 mb-1">סך־הכול מכרזים</p>
          <p className="text-3xl font-semibold text-cyan-100">{total}</p>
        </div>
        <div className="rounded-2xl bg-slate-950/80 border border-cyan-400/25 px-6 py-4 text-center">
          <p className="text-xs text-slate-400 mb-1">מכרזים פעילים</p>
          <p className="text-3xl font-semibold text-cyan-100">{active}</p>
        </div>
        <div className="rounded-2xl bg-slate-950/80 border border-cyan-400/25 px-6 py-4 text-center">
          <p className="text-xs text-slate-400 mb-1">מכרזים עתידיים</p>
          <p className="text-3xl font-semibold text-cyan-100">{future}</p>
        </div>
        <div className="rounded-2xl bg-slate-950/80 border border-cyan-400/25 px-6 py-4 text-center">
          <p className="text-xs text-slate-400 mb-1">מכרזים בארכיון</p>
          <p className="text-3xl font-semibold text-cyan-100">{archiveCount}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            שנת ארכיון: <span className="font-semibold text-cyan-200">{archiveYear}</span>
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-950/80 border border-cyan-400/20 px-6 py-5">
        <h3 className="text-sm font-semibold text-cyan-50 text-center mb-4">חלוקה לפי סטטוס טיפול</h3>
        <div className="space-y-1.5 text-xs text-slate-100">
          {STATUS_OPTIONS.map((st) => {
            const val = statusCounts[st] || 0;
            const widthPercent = (val / maxCount) * 100;
            return (
              <div key={st} className="flex items-center gap-3">
                <div className="w-24 text-right">{st}</div>
                <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-500" style={{ width: `${widthPercent}%` }} />
                </div>
                <div className="w-6 text-left text-slate-300">{val}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-slate-950/80 border border-amber-300/35 px-6 py-4">
        {nearDeadlineTenders.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">⚠</span>
              <h3 className="text-sm font-semibold text-amber-200">מועד הגשה מתקרב (עד 2 ימים)</h3>
            </div>

            <p className="text-xs text-slate-200 mb-3">
              יש <span className="font-semibold text-amber-200">{nearDeadlineTenders.length}</span> מכרזים שהמועד האחרון להגשה
              שלהם הוא היום או בתוך יומיים:
            </p>

            <ul className="space-y-1.5 text-[11px] text-slate-100">
              {nearDeadlineTenders.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-1 last:border-0 last:pb-0"
                >
                  <div className="flex-1 text-right min-w-[180px]">
                    <div className="font-medium line-clamp-1">{t.title}</div>
                    <div className="text-[10px] text-slate-400 line-clamp-1">{t.organization}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-amber-200 whitespace-nowrap">{t.deadline}</span>
                    <button
                      type="button"
                      onClick={() => onOpenTenderFromSummary(t)}
                      className="rounded-full bg-amber-300 px-3 py-1 text-[11px] font-semibold text-slate-900 hover:bg-amber-200"
                    >
                      לפרטי המכרז
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-lg text-emerald-300">✔</span>
            <p className="text-xs text-slate-200">אין כרגע מכרזים עם מועד הגשה מתקרב ב־2 הימים הקרובים.</p>
          </div>
        )}
      </div>
    </section>
  );
};

/* ===== אפליקציית המכרזים ===== */
function TendersApp() {
  const [view, setView] = useState("cards"); // cards | summary | archive
  const [tab, setTab] = useState("active"); // active / future
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [baseTenders, setBaseTenders] = useState([]);

  const [page, setPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);

  const [openTender, setOpenTender] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const [openStatusTenderId, setOpenStatusTenderId] = useState(null);
  const [columns, setColumns] = useState(1);

  // חיפוש ארכיון (UI בלבד – לא שולח לשרת)
  const [archiveSearchInput, setArchiveSearchInput] = useState("");
  const [archiveAppliedSearch, setArchiveAppliedSearch] = useState("");

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const currentYear = today.getFullYear();

  // ✅ ברירת מחדל מוצגת: השנה הנוכחית
  const [archiveYear, setArchiveYear] = useState(currentYear);
  const [archiveYearDropdownOpen, setArchiveYearDropdownOpen] = useState(false);

  // ✅ (1) טשטוש: רק הכרטיס שמתחת לרשימת השנים
  const archiveGridRef = useRef(null);
  const archiveYearBtnRef = useRef(null);
  const [dimmedArchiveTenderId, setDimmedArchiveTenderId] = useState(null);

  const API_BASE = "http://localhost:8787/api/tenders";

  useEffect(() => {
    const calcColumns = () => {
      const w = window.innerWidth;
      if (w >= 1280) setColumns(3);
      else if (w >= 768) setColumns(2);
      else setColumns(1);
    };
    calcColumns();
    window.addEventListener("resize", calcColumns);
    return () => window.removeEventListener("resize", calcColumns);
  }, []);

  /* ===== טעינת נתונים מה-API ===== */
  const fetchTenders = async (query = "") => {
    try {
      setLoading(true);
      setLoadError("");

      const effectiveQueryRaw = query && query.trim().length ? query.trim() : DEFAULT_PRINT_QUERY;

      // ✅ השינוי היחיד: תמיד מוסיפים "משרד" לשאילתת החיפוש כדי לתפוס מכרזים שמופיעים באתר רק תחת פילטר "משרד"
      const effectiveQuery = ensureOfficeFilter(effectiveQueryRaw);

      const url = `${API_BASE}?q=${encodeURIComponent(effectiveQuery)}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error("שגיאה בטעינת נתונים מהשרת");

      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      const savedStatuses = loadStatusMap();

      const enriched = list.map((t) => {
        const baseStatus = t.status || "טרם טופל";
        const storedStatus = savedStatuses[t.id];

        const org =
          t.organization ||
          t.publisher ||
          t.publisherName ||
          t.publisher_name ||
          t.publishingBody ||
          t.agency ||
          t.agencyName ||
          t.ministry ||
          t.ministryName ||
          t.buyer ||
          t.buyerName ||
          t.office ||
          t.officeName ||
          t.department ||
          t.departmentName ||
          t.org ||
          t.orgName ||
          t["גוף מפרסם"] ||
          t["גורם מפרסם"] ||
          t["שם המפרסם"] ||
          t["מפרסם"] ||
          (t.publisher && typeof t.publisher === "object" ? t.publisher.name || t.publisher.title || t.publisher.text : "") ||
          (t.organization && typeof t.organization === "object"
            ? t.organization.name || t.organization.title || t.organization.text
            : "") ||
          "";

        // ✅ שדות תאריך מהשרת
        const submissionStart = (t.submissionStart || t.submission_start || "").toString().trim();
        const publishDate = (t.publishDate || t.publish_date || "").toString().trim();

        return {
          ...t,
          organization: org,
          submissionStart,
          publishDate,
          status: storedStatus || baseStatus,
        };
      });

      setBaseTenders(enriched);
      setPage(1);
      setArchivePage(1);

      // ✅ אם המשתמשת כרגע בוחרת שנת ארכיון שאינה השנה הנוכחית – לא משנים לה.
      // אבל אם זו השנה הנוכחית – נשאיר כפי שהיא.
      // (הרשימה עצמה תתעדכן אוטומטית לפי הנתונים)
    } catch (err) {
      console.error(err);
      setLoadError("לא הצלחנו לטעון נתונים מהשרת.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchInput.trim() === "" && appliedSearch !== "") {
      setAppliedSearch("");
      fetchTenders("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // ✅ אם נמחק חיפוש בארכיון – חוזרים לכל הרשימה
  useEffect(() => {
    if (archiveSearchInput.trim() === "" && archiveAppliedSearch !== "") {
      setArchiveAppliedSearch("");
      setArchivePage(1);
    }
  }, [archiveSearchInput, archiveAppliedSearch]);

  const tendersWithMeta = useMemo(() => {
    return baseTenders.map((t) => {
      const d = parseDMY(t.deadline);
      let daysToDeadline = null;
      let isNearDeadline = false;

      if (d) {
        const diffMs = d.getTime() - today.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        daysToDeadline = diffDays;
        if (diffDays >= 0 && diffDays <= 2) isNearDeadline = true;
      }

      return { ...t, daysToDeadline, isNearDeadline };
    });
  }, [baseTenders, today]);

  const nearDeadlineTenders = useMemo(
    () => tendersWithMeta.filter((t) => t.isNearDeadline && t.status !== "לא רלוונטי"),
    [tendersWithMeta]
  );

  // ✅ מסך כרטיסים: לא מציגים "לא רלוונטי"
  const nonExpiredTenders = useMemo(() => {
    return tendersWithMeta.filter((t) => (t.daysToDeadline === null || t.daysToDeadline >= 0) && t.status !== "לא רלוונטי");
  }, [tendersWithMeta]);

  // ✅ ארכיון: פגי תוקף + "לא רלוונטי" תמיד
  const expiredTendersRaw = useMemo(() => {
    const list = tendersWithMeta.filter((t) => {
      const isExpired = typeof t.daysToDeadline === "number" && t.daysToDeadline < 0;
      const isNotRelevant = t.status === "לא רלוונטי";
      return isExpired || isNotRelevant;
    });

    list.sort((a, b) => {
      const da = parseDMY(a.deadline) || getStartDateObj(a);
      const db = parseDMY(b.deadline) || getStartDateObj(b);
      if (!da || !db) return 0;
      return db - da;
    });

    return list;
  }, [tendersWithMeta]);

  // ✅ רשימת שנים דינמית: כל השנים שמופיעות בתאריכים + השנה הנוכחית
  const archiveYearOptions = useMemo(() => {
    const years = new Set([currentYear]);

    const addYearFromDate = (txt) => {
      const d = parseDMY(txt);
      if (d) years.add(d.getFullYear());
    };

    for (const t of tendersWithMeta) {
      addYearFromDate(t.deadline);
      addYearFromDate(getStartDateText(t));
      addYearFromDate(t.publishDate);
    }

    // תצוגה: יורד מהגבוה לנמוך
    return Array.from(years).sort((a, b) => b - a);
  }, [tendersWithMeta, currentYear]);

  // ✅ אם השנה הנוכחית לא קיימת ברשימה (לא אמור לקרות) – עדיין נציג אותה
  useEffect(() => {
    if (!archiveYearOptions.includes(currentYear)) return;
    // אם המשתמשת לא שינתה שנה (נשארה על הנוכחית) – נשאיר; אחרת לא נוגעים.
  }, [archiveYearOptions, currentYear]);

  // ✅ ארכיון לפי שנה + חיפוש
  const expiredTenders = useMemo(() => {
    let list = expiredTendersRaw.filter((t) => {
      // "לא רלוונטי" תמיד בארכיון – אבל נסנן לפי שנה כדי שיהיה הגיוני:
      // אם יש deadline קריא – לפי deadline
      const d = parseDMY(t.deadline);
      if (d) return d.getFullYear() === archiveYear;

      // אם אין deadline – לפי start/publish
      const sd = getStartDateObj(t);
      if (sd) return sd.getFullYear() === archiveYear;

      // fallback: "לא רלוונטי" יופיע לפחות בשנת הנוכחית
      return t.status === "לא רלוונטי" && archiveYear === currentYear;
    });

    if (archiveAppliedSearch.trim()) {
      list = list.filter((t) => matchesSearch(t, archiveAppliedSearch));
    }

    return list;
  }, [expiredTendersRaw, archiveYear, currentYear, archiveAppliedSearch]);

  // ✅ מסך כרטיסים – פילטרים
  const filtered = useMemo(() => {
    let list = [...nonExpiredTenders];

    if (dateFilter.trim()) {
      const df = dateFilter.trim();
      list = list.filter((t) => (getStartDateText(t) || "").startsWith(df));
    }

    list = list.filter((t) => {
      const start = getStartDateObj(t);
      const isFuture = start && start > today;
      return tab === "future" ? isFuture : !isFuture;
    });

    list.sort((a, b) => {
      const aNR = a.status === "לא רלוונטי";
      const bNR = b.status === "לא רלוונטי";
      if (aNR !== bNR) return aNR ? 1 : -1;

      const aDays = typeof a.daysToDeadline === "number" ? a.daysToDeadline : Number.POSITIVE_INFINITY;
      const bDays = typeof b.daysToDeadline === "number" ? b.daysToDeadline : Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;

      const aStart = getStartDateObj(a)?.getTime() ?? 0;
      const bStart = getStartDateObj(b)?.getTime() ?? 0;
      return aStart - bStart;
    });

    return list;
  }, [nonExpiredTenders, dateFilter, tab, today]);

  const PAGE_SIZE = 6;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openStatusIndex = pageItems.findIndex((t) => t.id === openStatusTenderId);

  const archiveTotalPages = Math.max(1, Math.ceil(expiredTenders.length / PAGE_SIZE));
  const archiveCurrentPage = Math.min(archivePage, archiveTotalPages);
  const archiveItems = expiredTenders.slice((archiveCurrentPage - 1) * PAGE_SIZE, archiveCurrentPage * PAGE_SIZE);

  const archiveOpenStatusIndex = archiveItems.findIndex((t) => t.id === openStatusTenderId);

  // ✅ (1) קובע את הכרטיס שנמצא "מתחת" לרשימת השנים (לפי מיקום בפועל על המסך)
  useEffect(() => {
    if (view !== "archive" || !archiveYearDropdownOpen) {
      setDimmedArchiveTenderId(null);
      return;
    }

    const timer = setTimeout(() => {
      const btn = archiveYearBtnRef.current;
      const grid = archiveGridRef.current;
      if (!btn || !grid) return;

      const btnRect = btn.getBoundingClientRect();
      const anchorX = btnRect.left + btnRect.width / 2;
      const anchorY = btnRect.bottom;

      const cards = Array.from(grid.querySelectorAll("[data-tender-id]"));
      if (!cards.length) return;

      let bestId = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const el of cards) {
        const r = el.getBoundingClientRect();
        const dy = r.top - anchorY;
        if (dy < -10) continue;

        const insideX = anchorX >= r.left && anchorX <= r.right;
        const dx = insideX ? 0 : Math.min(Math.abs(anchorX - r.left), Math.abs(anchorX - r.right));

        const score = dy * 1.0 + dx * 2.0;
        if (score < bestScore) {
          bestScore = score;
          bestId = el.getAttribute("data-tender-id");
        }
      }

      setDimmedArchiveTenderId(bestId);
    }, 0);

    return () => clearTimeout(timer);
  }, [view, archiveYearDropdownOpen, archiveItems, columns]);

  const handleStatusChange = (id, newStatus) => {
    setBaseTenders((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t));
      const map = loadStatusMap();
      map[id] = newStatus;
      saveStatusMap(map);
      return updated;
    });

    if (openTender && openTender.id === id) {
      setOpenTender((prev) => ({ ...prev, status: newStatus }));
    }
  };

  const handleSearch = () => {
    const cleaned = searchInput.trim(); // ✅ לא מוחקים OR
    setAppliedSearch(cleaned);
    fetchTenders(cleaned);
  };

  const handleSearchKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleArchiveSearch = () => {
    const cleaned = archiveSearchInput.trim();
    setArchiveAppliedSearch(cleaned);
    setArchivePage(1);
  };

  const handleArchiveSearchKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleArchiveSearch();
    }
  };

  /* ===== יצוא אקסל מלא (כרטיסי מכרזים חיים) ===== */
  const handleExportExcel = async () => {
    try {
      if (!nonExpiredTenders.length) {
        alert("אין נתונים לייצוא.");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "מכרזים בענף הדפוס";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("כרטיסי מכרזים", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });

      worksheet.columns = [
        { key: "title", width: 55 },
        { key: "org", width: 28 },
        { key: "start", width: 16 },
        { key: "deadline", width: 14 },
        { key: "status", width: 16 },
        { key: "kind", width: 12 },
        { key: "url", width: 45 },
        { key: "soon", width: 40 },
      ];

      const headerRow = worksheet.getRow(1);
      headerRow.values = [
        "כותרת המכרז",
        "גוף מפרסם",
        "מועד תחילת ההגשה",
        "תוקף הגשה",
        "סטטוס",
        "סוג מכרז",
        "קישור למכרז",
        "אזהרת מועד הגשה",
      ];
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FF000000" } },
          left: { style: "thin", color: { argb: "FF000000" } },
          right: { style: "thin", color: { argb: "FF000000" } },
          bottom: { style: "thin", color: { argb: "FF000000" } },
        };
      });

      worksheet.autoFilter = { from: "A1", to: "H1" };

      const metaById = new Map(tendersWithMeta.map((t) => [t.id, t]));

      nonExpiredTenders.forEach((tender, index) => {
        const meta = metaById.get(tender.id);
        const isNear = meta?.isNearDeadline;
        const soonText = isNear ? "⚠ מועד הגשה מתקרב (עד 2 ימים)" : "";
        const link = tender.tenderUrl || tender.url || "";

        const startText = getStartDateText(tender);
        const startObj = getStartDateObj(tender);

        const row = worksheet.addRow({
          title: tender.title,
          org: tender.organization,
          start: startText,
          deadline: tender.deadline,
          status: tender.status,
          kind: startObj && startObj > today ? "עתידי" : "פעיל",
          url: link,
          soon: soonText,
        });

        const isEven = index % 2 === 0;

        row.eachCell((cell, colNumber) => {
          cell.font = { name: "Arial", size: 10, color: { argb: "FF111111" } };
          const isSummaryColumn = (colNumber >= 3 && colNumber <= 6) || colNumber === 8;
          const alignment = { vertical: "middle", horizontal: isSummaryColumn ? "center" : "right", wrapText: true };

          if (colNumber === 7) {
            alignment.horizontal = "left";
            alignment.readingOrder = 1;
          }

          cell.alignment = alignment;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF5F5F5" : "FFE5E5E5" } };
          cell.border = {
            top: { style: "hair", color: { argb: "FFB3B3B3" } },
            left: { style: "thin", color: { argb: "FFE5E5E5" } },
            right: { style: "thin", color: { argb: "FFE5E5E5" } },
            bottom: { style: "hair", color: { argb: "FFB3B3B3" } },
          };
        });

        row.height = 18;

        if (link) {
          const linkCell = row.getCell(7);
          linkCell.value = { text: link, hyperlink: link };
          linkCell.font = { name: "Arial", size: 10, color: { argb: "FF1D4ED8" }, underline: true };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `מכרזים-בענף-הדפוס-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("אירעה שגיאה בעת יצוא הנתונים לאקסל.");
    }
  };

  /* ===== ✅ יצוא אקסל – דוח סיכום מלא עם קישורים וגיליונות פרטים ===== */
  const handleExportSummaryExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();

      const ws = workbook.addWorksheet("סיכום מכרזים", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
      });

      const titleRow = ws.addRow(["סיכום מכרזים"]);
      ws.mergeCells("A1:B1");
      titleRow.height = 22;
      titleRow.eachCell((cell) => {
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
        cell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFECFEFF" } };
      });

      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const yyyy = today.getFullYear();
      const dateStr = `${dd}.${mm}.${yyyy}`;

      const dateRow = ws.addRow([`תאריך דוח: ${dateStr}`]);
      ws.mergeCells("A2:B2");
      dateRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF555555" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      ws.addRow([]);

      ws.columns = [
        { key: "name", width: 40 },
        { key: "value", width: 12 },
      ];

      const headerRow = ws.addRow(["פרמטר", "כמות"]);
      headerRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
      });

      const total = nonExpiredTenders.length;
      const future = nonExpiredTenders.filter((t) => {
        const d = getStartDateObj(t);
        return d && d > today;
      }).length;
      const active = total - future;
      const archiveTotal = expiredTenders.length;

      const byStatus = STATUS_OPTIONS.reduce((acc, st) => {
        acc[st] = 0;
        return acc;
      }, {});
      for (const t of nonExpiredTenders) {
        if (byStatus[t.status] === undefined) byStatus[t.status] = 0;
        byStatus[t.status]++;
      }

      const nearCount = nearDeadlineTenders.length;

      const rows = [
        { key: "total", name: "סך־הכול מכרזים", value: total },
        { key: "active", name: "מכרזים פעילים", value: active },
        { key: "future", name: "מכרזים עתידיים", value: future },
        { key: "archive", name: "מכרזים בארכיון", value: archiveTotal },
        { key: "near", name: "מכרזים עם מועד הגשה מתקרב (עד 2 ימים)", value: nearCount },
        {},
        { key: "statusHeader", name: "חלוקה לפי סטטוס טיפול", value: "" },
        ...STATUS_OPTIONS.map((st) => ({ key: `status:${st}`, name: st, value: byStatus[st] || 0 })),
      ];

      const rowNumbersByKey = {};
      const valuesByKey = {};

      rows.forEach((row) => {
        const excelRow = ws.addRow([row.name ?? "", row.value ?? ""]);
        excelRow.eachCell((cell, colNumber) => {
          cell.font = { name: "Arial", size: 10, color: { argb: "FF111111" } };
          cell.alignment = { vertical: "middle", horizontal: colNumber === 1 ? "right" : "center" };
        });

        if (row.key) {
          rowNumbersByKey[row.key] = excelRow.number;
          valuesByKey[row.key] = row.value ?? 0;
        }

        if (!row.name && !row.value && excelRow.number > 4) excelRow.height = 8;

        if (row.key === "statusHeader") {
          excelRow.eachCell((cell) => {
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
          });
        }
      });

      const addDetailsSheet = (sheetName, sourceTenders, filterFn) => {
        const sheet = workbook.addWorksheet(sheetName, {
          views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
        });

        sheet.columns = [
          { key: "title", width: 55 },
          { key: "org", width: 28 },
          { key: "start", width: 16 },
          { key: "deadline", width: 14 },
          { key: "status", width: 16 },
          { key: "kind", width: 12 },
          { key: "url", width: 45 },
        ];

        const dHeader = sheet.getRow(1);
        dHeader.values = ["כותרת המכרז", "גוף מפרסם", "מועד תחילת ההגשה", "תוקף הגשה", "סטטוס", "סוג מכרז", "קישור למכרז"];
        dHeader.height = 20;
        dHeader.eachCell((cell) => {
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
        });

        sheet.autoFilter = { from: "A1", to: "G1" };

        const filteredTenders = sourceTenders.filter(filterFn);

        filteredTenders.forEach((tender, index) => {
          const link = tender.tenderUrl || tender.url || "";
          const startText = getStartDateText(tender);
          const startObj = getStartDateObj(tender);

          const row = sheet.addRow({
            title: tender.title,
            org: tender.organization,
            start: startText,
            deadline: tender.deadline,
            status: tender.status,
            kind: startObj && startObj > today ? "עתידי" : "פעיל",
            url: link,
          });

          const isEven = index % 2 === 0;
          row.eachCell((cell, colNumber) => {
            cell.font = { name: "Arial", size: 10, color: { argb: "FF111111" } };
            cell.alignment = { vertical: "middle", horizontal: colNumber === 1 ? "right" : "center", wrapText: true };
            if (colNumber === 7) {
              cell.alignment.horizontal = "left";
              cell.alignment.readingOrder = 1;
            }
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF5F5F5" : "FFE5E5E5" } };
          });

          if (link) {
            const linkCell = row.getCell(7);
            linkCell.value = { text: link, hyperlink: link };
            linkCell.font = { name: "Arial", size: 10, color: { argb: "FF1D4ED8" }, underline: true };
          }
        });

        return sheet;
      };

      const isFutureFn = (t) => {
        const d = getStartDateObj(t);
        return d && d > today;
      };
      const nearIds = new Set(nearDeadlineTenders.map((t) => t.id));

      const sheetNamesByKey = {};

      sheetNamesByKey["total"] = "כרטיסי מכרזים - כל המכרזים";
      addDetailsSheet(sheetNamesByKey["total"], nonExpiredTenders, () => true);

      sheetNamesByKey["active"] = "מכרזים פעילים";
      addDetailsSheet(sheetNamesByKey["active"], nonExpiredTenders, (t) => !isFutureFn(t));

      sheetNamesByKey["future"] = "מכרזים עתידיים";
      addDetailsSheet(sheetNamesByKey["future"], nonExpiredTenders, (t) => isFutureFn(t));

      sheetNamesByKey["near"] = "מכרזים עם מועד מתקרב";
      addDetailsSheet(sheetNamesByKey["near"], nonExpiredTenders, (t) => nearIds.has(t.id));

      sheetNamesByKey["archive"] = `ארכיון ${archiveYear}`;
      addDetailsSheet(sheetNamesByKey["archive"], expiredTenders, () => true);

      STATUS_OPTIONS.forEach((st) => {
        const key = `status:${st}`;
        const name = `סטטוס - ${st}`;
        sheetNamesByKey[key] = name;
        addDetailsSheet(name, nonExpiredTenders, (t) => t.status === st);
      });

      Object.entries(sheetNamesByKey).forEach(([key, sheetName]) => {
        const rowNumber = rowNumbersByKey[key];
        const value = valuesByKey[key] || 0;
        if (!rowNumber || value === 0) return;

        const cell = ws.getCell(`B${rowNumber}`);
        const text = cell.value != null ? String(cell.value) : "";
        cell.value = { text, hyperlink: `#'${sheetName}'!A1` };
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1D4ED8" }, underline: true };
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `מכרזים-בענף-הדפוס-דוח-סיכום-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("אירעה שגיאה בעת יצוא דוח הסיכום לאקסל.");
    }
  };

  return (
    <div className="min-h-screen lg:h-dvh bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100 lg:overflow-hidden" dir="rtl">
      <main className="max-w-7xl mx-auto px-4 pt-10 pb-8 flex flex-col gap-6 relative">
        <div className="absolute top-4 left-4 group inline-flex">
          <button
            onClick={() => setShowInstructions(true)}
            className="w-10 h-10 rounded-full border border-cyan-400/35 bg-slate-950/60 text-cyan-50 flex items-center justify-center text-sm font-semibold shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all duration-300 ease-out"
            aria-label="הנחיות שימוש"
          >
            i
          </button>
          <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute top-12 left-1/2 -translate-x-1/2 bg-slate-950/90 border border-cyan-400/25 text-slate-50 text-xs py-1.5 px-3 rounded-xl whitespace-nowrap shadow-lg">
            הנחיות שימוש
          </div>
        </div>

        <header className="text-center space-y-1 mb-2">
          <h1 className="text-4xl font-bold text-cyan-100">מכרזים בענף הדפוס</h1>
          <p className="text-slate-400 text-sm">חיפוש מתקדם ובזמן אמת של מכרזים ומכרזי משנה בתחום הדפוס</p>
        </header>

        <div className="flex justify-center gap-4 mb-2">
          <button
            onClick={() => setView("summary")}
            className={`px-8 py-2 rounded-xl text-sm border transition ${
              view === "summary"
                ? "bg-cyan-500/10 border-cyan-400/60 text-cyan-50"
                : "bg-slate-900/40 border-cyan-400/20 text-slate-200 hover:bg-slate-900/70"
            }`}
          >
            דוח סיכום
          </button>

          <button
            onClick={() => {
              setView("cards");
              setPage(1);
            }}
            className={`px-8 py-2 rounded-xl text-sm border transition ${
              view === "cards"
                ? "bg-cyan-500/10 border-cyan-400/60 text-cyan-50"
                : "bg-slate-900/40 border-cyan-400/20 text-slate-200 hover:bg-slate-900/70"
            }`}
          >
            כרטיסי מכרזים
          </button>

          <button
            onClick={() => {
              setView("archive");
              setArchivePage(1);
            }}
            className={`px-8 py-2 rounded-xl text-sm border transition ${
              view === "archive"
                ? "bg-cyan-500/10 border-cyan-400/60 text-cyan-50"
                : "bg-slate-900/40 border-cyan-400/20 text-slate-200 hover:bg-slate-900/70"
            }`}
          >
            ארכיון
          </button>
        </div>

        {view === "cards" && (
          <>
            <div className="max-w-6xl mx-auto mt-2 min-h-[56px] flex flex-wrap items-center gap-3 justify-between">
              <div className="relative flex-none">
                <button
                  onClick={() => setExportMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-950/60 border border-cyan-400/60 text-cyan-50 text-sm transition whitespace-nowrap"
                >
                  <span>ייצוא נתונים</span>
                  <span className="text-xs">▾</span>
                </button>

                {exportMenuOpen && (
                  <div className="absolute mt-2 right-0 w-44 rounded-xl bg-slate-950/95 border border-cyan-400/25 shadow-2xl z-40 overflow-hidden text-sm">
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportExcel();
                      }}
                      className="w-full text-right px-4 py-2 text-slate-100 hover:bg-slate-900/70 text-xs"
                    >
                      ייצוא ל-Excel
                    </button>
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportSummaryExcel();
                      }}
                      className="w-full text-right px-4 py-2 text-slate-100 hover:bg-slate-900/70 text-xs"
                    >
                      ייצוא דוח סיכום ל-Excel
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 justify-end flex-1">
                <button
                  onClick={() => {
                    setTab("active");
                    setPage(1);
                  }}
                  className={`px-6 py-2 rounded-xl border text-xs transition-all duration-300 ease-out ${
                    tab === "active"
                      ? "bg-cyan-500/10 border-cyan-400/50 text-cyan-50"
                      : "bg-slate-900/30 border-cyan-400/10 text-slate-200 hover:bg-slate-900/60"
                  }`}
                >
                  פעילים
                </button>

                <button
                  onClick={() => {
                    setTab("future");
                    setPage(1);
                  }}
                  className={`px-6 py-2 rounded-xl border text-xs transition-all duration-300 ease-out ${
                    tab === "future"
                      ? "bg-cyan-500/10 border-cyan-400/50 text-cyan-50"
                      : "bg-slate-900/30 border-cyan-400/10 text-slate-200 hover:bg-slate-900/60"
                  }`}
                >
                  עתידיים
                </button>

                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKey}
                  placeholder="...חיפוש מכרזים"
                  className="h-9 rounded-xl bg-slate-900/60 border border-cyan-400/15 px-4 text-xs text-slate-100 placeholder:text-slate-500 flex-1 min-w-[220px] text-right focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/50"
                />

                <input
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setPage(1);
                  }}
                  placeholder="מועד תחילת ההגשה (DD/MM/YYYY)"
                  className="h-9 rounded-xl bg-slate-900/60 border border-cyan-400/15 px-4 text-xs text-slate-100 placeholder:text-slate-500 w-[230px] flex-none text-right focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/50"
                />

                <button
                  onClick={handleSearch}
                  className="px-6 py-2 rounded-xl bg-slate-950/40 border border-cyan-400/40 text-cyan-50 text-xs transition-all duration-300 ease-out whitespace-nowrap flex-none hover:bg-cyan-500/10"
                >
                  חפש
                </button>
              </div>
            </div>

            {loading && <div className="mt-6 text-center text-sm text-slate-300">טוען נתונים מהשרת...</div>}
            {!loading && loadError && <div className="mt-6 text-center text-sm text-rose-300">{loadError}</div>}

            {!loading && !loadError && (
              <>
                {filtered.length === 0 ? (
                  <div className="mt-10 text-center text-sm text-slate-300">אין מכרזים להצגה.</div>
                ) : (
                  <div className="flex flex-col min-h-[620px] mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 flex-1">
                      {pageItems.map((t, index) => {
                        const dimStatusButton = openStatusIndex !== -1 && index === openStatusIndex + columns;
                        const hasMultipleRows = pageItems.length > columns;
                        const isBottomRow = hasMultipleRows && index >= pageItems.length - columns;

                        return (
                          <TenderCard
                            key={t.id}
                            tender={t}
                            onStatusChange={handleStatusChange}
                            onOpenDetails={() => setOpenTender(t)}
                            dimStatusButton={dimStatusButton}
                            onStatusDropdownToggle={(id, isOpen) => setOpenStatusTenderId(isOpen ? id : null)}
                            openUp={isBottomRow}
                          />
                        );
                      })}
                    </div>

                    <div className="mt-auto flex justify-center items-center gap-4 pb-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-4 py-1 rounded-lg border border-cyan-400/30 text-xs hover:bg-cyan-500/10 disabled:opacity-40"
                        disabled={currentPage === 1}
                      >
                        קודם
                      </button>
                      <span className="text-xs text-slate-200">
                        עמוד {currentPage} מתוך {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="px-4 py-1 rounded-lg border border-cyan-400/30 text-xs hover:bg-cyan-500/10 disabled:opacity-40"
                        disabled={currentPage === totalPages}
                      >
                        הבא
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {view === "archive" && (
          <>
            {/* ✅ אותו סגנון סרגל כמו במסך כרטיסים, ובאותה שורה: חיפוש + שנת ארכיון */}
            <div className="max-w-6xl mx-auto mt-2 min-h-[56px] flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3 flex-none">
                <span className="text-slate-400 text-xs">שנת ארכיון:</span>
                <YearSelect
                  value={archiveYear}
                  options={archiveYearOptions}
                  onChange={(y) => {
                    setArchiveYear(y);
                    setArchivePage(1);
                  }}
                  onToggle={(isOpen) => setArchiveYearDropdownOpen(isOpen)}
                  buttonRef={archiveYearBtnRef}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 justify-end flex-1">
                <input
                  value={archiveSearchInput}
                  onChange={(e) => setArchiveSearchInput(e.target.value)}
                  onKeyDown={handleArchiveSearchKey}
                  placeholder="...חיפוש בארכיון"
                  className="h-9 rounded-xl bg-slate-900/60 border border-cyan-400/15 px-4 text-xs text-slate-100 placeholder:text-slate-500 flex-1 min-w-[260px] text-right focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/50"
                />

                <button
                  onClick={handleArchiveSearch}
                  className="px-6 py-2 rounded-xl bg-slate-950/40 border border-cyan-400/40 text-cyan-50 text-xs transition-all duration-300 ease-out whitespace-nowrap flex-none hover:bg-cyan-500/10"
                >
                  חפש
                </button>
              </div>
            </div>

            {expiredTenders.length === 0 ? (
              <div className="mt-12 flex justify-center">
                <div className="rounded-2xl border border-cyan-400/25 bg-slate-950/70 px-10 py-8 text-center shadow-[0_18px_40px_rgba(15,23,42,0.55)]">
                  <p className="text-sm text-slate-200 mb-1">אין מכרזים בארכיון לשנת {archiveYear}.</p>
                  <p className="text-xs text-slate-400">
                    מכרזים שסומנו כ<span className="font-semibold text-cyan-200">"לא רלוונטי"</span> או שתוקף ההגשה שלהם פג במהלך
                    השנה – יופיעו כאן.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col min-h-[620px] mt-4">
                {/* ✅ אותה גריד/מיקום כמו במסך כרטיסים */}
                <div ref={archiveGridRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 flex-1">
                  {archiveItems.map((t, index) => {
                    const dimStatusButton = archiveOpenStatusIndex !== -1 && index === archiveOpenStatusIndex + columns;
                    const hasMultipleRows = archiveItems.length > columns;
                    const isBottomRow = hasMultipleRows && index >= archiveItems.length - columns;

                    return (
                      <TenderCard
                        key={t.id}
                        tender={t}
                        onStatusChange={handleStatusChange}
                        onOpenDetails={() => setOpenTender(t)}
                        dimStatusButton={dimStatusButton}
                        onStatusDropdownToggle={(id, isOpen) => setOpenStatusTenderId(isOpen ? id : null)}
                        openUp={isBottomRow}
                        dimExternally={archiveYearDropdownOpen && String(t.id) === String(dimmedArchiveTenderId)}
                      />
                    );
                  })}
                </div>

                <div className="mt-auto flex justify-center items-center gap-4 pb-2">
                  <button
                    onClick={() => setArchivePage((p) => Math.max(1, p - 1))}
                    className="px-4 py-1 rounded-lg border border-cyan-400/30 text-xs hover:bg-cyan-500/10 disabled:opacity-40"
                    disabled={archiveCurrentPage === 1}
                  >
                    קודם
                  </button>
                  <span className="text-xs text-slate-200">
                    עמוד {archiveCurrentPage} מתוך {archiveTotalPages}
                  </span>
                  <button
                    onClick={() => setArchivePage((p) => Math.min(archiveTotalPages, p + 1))}
                    className="px-4 py-1 rounded-lg border border-cyan-400/30 text-xs hover:bg-cyan-500/10 disabled:opacity-40"
                    disabled={archiveCurrentPage === archiveTotalPages}
                  >
                    הבא
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {view === "summary" && (
          <SummaryView
            baseTenders={nonExpiredTenders}
            today={today}
            onExportExcel={handleExportSummaryExcel}
            nearDeadlineTenders={nearDeadlineTenders}
            onOpenTenderFromSummary={(t) => setOpenTender(t)}
            archiveCount={expiredTenders.length}
            archiveYear={archiveYear}
          />
        )}
      </main>

      <TenderDetailsModal tender={openTender} onClose={() => setOpenTender(null)} onStatusChange={handleStatusChange} />
      <InstructionsModal open={showInstructions} onClose={() => setShowInstructions(false)} />
    </div>
  );
}

/* ===== קומפוננטת root ===== */
export default function App() {
  return (
    <>
      <GlobalStyles />
      <TendersApp />
    </>
  );
}
