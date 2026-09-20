/**
 * QIǍN / LEDGER — Google Apps Script backend
 * ------------------------------------------------
 * Turns one Google Sheet into a JSON API for:
 *   - the expense tracker  (index.html)
 *   - the finance dashboard (dashboard.html)
 *
 * Deploy as a Web App ("Execute as: Me", "Who has access: Anyone"),
 * then paste the /exec URL into assets/api.js as API_URL.
 *
 * SECURITY --------------------------------------------------------
 * Because the pages are served publicly from GitHub Pages, this API
 * is gated by a shared secret. Set it once:
 *
 *   Apps Script editor → Project Settings → Script Properties
 *   → Add:  AUTH_TOKEN = <a long random string>
 *
 * Until AUTH_TOKEN is set, the API stays open (so you can't lock
 * yourself out mid-setup). Once set, every request must carry it.
 * -----------------------------------------------------------------
 *
 * Sheets (auto-created on first run):
 *
 *   "Expenses":   Date       | Amount | Category | Item
 *                 2026-08-01 | 12.50  | Food     | Lunch with team
 *
 *   "Budgets":    Month   | Category  | Budget
 *                 2026-08 | Food      | 300
 *
 *   "Positions":  Date       | Account   | Type        | Amount   | Remarks
 *                 2026-09-20 | DBS Multiplier | Savings | 24500.00 | main account
 *                 2026-09-20 | MariBank  | Savings     | 8000.00  | 2.5% p.a.
 *                 2026-09-20 | IBKR      | Investments | 31200.00 | VWRA
 */

const EXPENSES_SHEET  = "Expenses";
const BUDGETS_SHEET   = "Budgets";
const POSITIONS_SHEET = "Positions";

/* ============================ AUTH ============================ */

function getAuthToken_() {
  return PropertiesService.getScriptProperties().getProperty("AUTH_TOKEN") || "";
}

// Returns true when the request is allowed through.
// If no AUTH_TOKEN has been configured yet, everything is allowed.
function isAuthorized_(supplied) {
  const expected = getAuthToken_();
  if (!expected) return true;
  return String(supplied || "") === expected;
}

function unauthorized_() {
  return json_({ status: "unauthorized", message: "Bad or missing token." });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ========================= SHEET ACCESS ======================== */

function getExpensesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXPENSES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(EXPENSES_SHEET);
    sheet.appendRow(["Date", "Amount", "Category", "Item"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getBudgetsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BUDGETS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BUDGETS_SHEET);
    sheet.appendRow(["Month", "Category", "Budget"]);
    sheet.setFrozenRows(1);
  }
  // Force column A to plain text so Sheets doesn't silently auto-convert
  // a value like "2026-08" into an actual date (which would break every
  // month lookup done by key on the frontend).
  sheet.getRange("A:A").setNumberFormat("@");
  return sheet;
}

function getPositionsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(POSITIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(POSITIONS_SHEET);
    sheet.appendRow(["Date", "Account", "Type", "Amount", "Remarks"]);
    sheet.setFrozenRows(1);
  }
  // Same plain-text guard as Budgets: keep the snapshot date a string
  // so "2026-09-20" round-trips instead of becoming a Date object.
  sheet.getRange("A:A").setNumberFormat("@");
  return sheet;
}

/* ========================= NORMALIZERS ========================= */

// Normalizes any cell value (Date object or string) down to a clean
// "yyyy-MM" month string. Repairs rows where Sheets already auto-converted
// the month into a real date before the plain-text format was applied.
function normalizeMonth_(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM");
  }
  const s = String(value).trim();
  const match = s.match(/^\d{4}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM");
  }
  return s;
}

// Normalizes any cell value (Date object or string) down to a clean
// "yyyy-MM-dd" string, with no time-of-day component.
function normalizeDate_(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(value).trim();
  const match = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return s;
}

// Collapses any casing/spelling of an account type into one of the two
// canonical buckets the dashboard understands.
function normalizeType_(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s.indexOf("invest") === 0 || s === "investment" || s === "investments") return "Investments";
  return "Savings";
}

/* ============================== GET ============================ */
//
// GET ?token=... -> {
//   entries:   [{date, amount, category, item}, ...],
//   budgets:   { "2026-08": { "Food": 300, ... }, ... },
//   positions: [{date, account, type, amount, remarks}, ...]
// }
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!isAuthorized_(params.token)) return unauthorized_();

  // --- expenses ---
  const expValues = getExpensesSheet_().getDataRange().getValues();
  const entries = expValues.slice(1)
    .filter(r => r[0] !== "" && r[0] !== null)
    .map(r => ({
      date: normalizeDate_(r[0]),
      amount: Number(r[1]) || 0,
      category: String(r[2] || ""),
      item: String(r[3] || "")
    }));

  // --- budgets ---
  const budValues = getBudgetsSheet_().getDataRange().getValues();
  const budgets = {};
  budValues.slice(1).forEach(r => {
    const month = normalizeMonth_(r[0]);
    const category = String(r[1] || "").trim();
    if (!month || !category) return;
    if (!budgets[month]) budgets[month] = {};
    budgets[month][category] = Number(r[2]) || 0;
  });

  // --- positions ---
  const posValues = getPositionsSheet_().getDataRange().getValues();
  const positions = posValues.slice(1)
    .filter(r => r[0] !== "" && r[0] !== null && String(r[1] || "").trim() !== "")
    .map(r => ({
      date: normalizeDate_(r[0]),
      account: String(r[1] || "").trim(),
      type: normalizeType_(r[2]),
      amount: Number(r[3]) || 0,
      remarks: String(r[4] || "")
    }));

  return json_({ entries, budgets, positions });
}

/* ============================= POST ============================ */
//
// Body shapes (body.type):
//
//   (default)  {token, date, amount, category, item}
//              -> appends one row to Expenses
//
//   "budget"   {token, type:"budget", month:"2026-08",
//               budgets:{"Food":300, "Transport":100}}
//              -> upserts one row per category in Budgets for that month
//
//   "positions" {token, type:"positions", date:"2026-09-20",
//                positions:[{account, type, amount, remarks}, ...]}
//              -> replaces the whole snapshot for that date in Positions
//
// Sent as text/plain from the browser to dodge a CORS preflight.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!isAuthorized_(body.token)) return unauthorized_();

    /* -------------------- budgets -------------------- */
    if (body.type === "budget") {
      if (!body.month || !body.budgets || typeof body.budgets !== "object") {
        throw new Error("Missing month or budgets");
      }
      const sheet = getBudgetsSheet_();
      const values = sheet.getDataRange().getValues();

      Object.keys(body.budgets).forEach(category => {
        const amount = Number(body.budgets[category]);
        if (isNaN(amount)) return;

        let rowIndex = -1;
        for (let i = 1; i < values.length; i++) {
          if (normalizeMonth_(values[i][0]) === String(body.month).trim() &&
              String(values[i][1]).trim() === String(category).trim()) {
            rowIndex = i + 1; // 1-indexed sheet row
            break;
          }
        }
        if (rowIndex > 0) {
          // Re-write column A too, in case this row was an auto-converted
          // date from before the plain-text fix — this heals it going forward.
          sheet.getRange(rowIndex, 1).setValue(body.month);
          sheet.getRange(rowIndex, 3).setValue(amount);
        } else {
          sheet.appendRow([body.month, category, amount]);
          values.push([body.month, category, amount]); // keep local copy in sync
        }
      });

      return json_({ status: "ok" });
    }

    /* ------------------- positions ------------------- */
    if (body.type === "positions") {
      const date = normalizeDate_(body.date);
      if (!date) throw new Error("Missing snapshot date");
      if (!Array.isArray(body.positions)) throw new Error("Missing positions array");

      // Build and validate the replacement rows BEFORE deleting anything,
      // so a malformed request can never leave the date wiped and empty.
      const rows = body.positions
        .filter(p => String(p.account || "").trim() !== "")
        .map(p => [
          date,
          String(p.account).trim(),
          normalizeType_(p.type),
          Number(p.amount) || 0,
          String(p.remarks || "")
        ]);
      if (!rows.length) throw new Error("No accounts to save");

      const sheet = getPositionsSheet_();

      // A snapshot is the whole picture on one date, so saving replaces
      // that date wholesale rather than appending duplicates. Delete from
      // the bottom up so earlier row indices stay valid as we go.
      const values = sheet.getDataRange().getValues();
      const doomed = [];
      for (let i = 1; i < values.length; i++) {
        if (normalizeDate_(values[i][0]) === date) doomed.push(i + 1);
      }
      for (let i = doomed.length - 1; i >= 0; i--) {
        sheet.deleteRow(doomed[i]);
      }

      // One batch write rather than N appendRow round-trips — Apps Script
      // charges per call, not per cell.
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat("@");

      return json_({ status: "ok", saved: rows.length });
    }

    /* -------------------- expense -------------------- */
    if (!body.date || body.amount === undefined || !body.category) {
      throw new Error("Missing date, amount, or category");
    }
    getExpensesSheet_().appendRow([
      body.date,
      Number(body.amount),
      String(body.category),
      String(body.item || "")
    ]);
    return json_({ status: "ok" });

  } catch (err) {
    return json_({ status: "error", message: err.message });
  }
}
