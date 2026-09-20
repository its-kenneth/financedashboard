/* ------------------------------------------------------------------
 * util.js — date, month and money helpers shared by both pages.
 * Plain classic script (no ES modules) so the files also open over
 * file:// without a server. Everything hangs off window.Q.
 * ---------------------------------------------------------------- */
window.Q = window.Q || {};

(function (Q) {
  "use strict";

  function pad2(n) { return String(n).padStart(2, "0"); }

  /** Today as "yyyy-MM-dd", in the browser's local timezone. */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /**
   * Normalizes any date value — clean ISO string, timestamp string, or a
   * full "Thu Aug 01 2026 00:00:00 GMT+0800 (...)"-style string — down to
   * a plain "yyyy-MM-dd" with no time-of-day component.
   */
  function toISODate(raw) {
    if (raw === null || raw === undefined || raw === "") return "";
    const s = String(raw).trim();
    const isoMatch = s.match(/^\d{4}-\d{2}-\d{2}/);
    if (isoMatch) return isoMatch[0];
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /** "2026-09-20" -> "2026-09" */
  function monthOf(raw) {
    return toISODate(raw).slice(0, 7);
  }

  /** Month key N months from now, e.g. monthKeyFromOffset(-1) -> last month. */
  function monthKeyFromOffset(offset) {
    const d = new Date();
    d.setDate(1); // avoid month-length rollover surprises
    d.setMonth(d.getMonth() + offset);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  /** "2026-09" -> "September 2026" */
  function monthLabel(key) {
    const parts = String(key).split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  /** "2026-09" -> "Sep" (used for crowded chart axes) */
  function monthShort(key) {
    const parts = String(key).split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleString(undefined, { month: "short" });
  }

  /** "2026-09-20" -> "20 Sep 2026" */
  function dateLabel(raw) {
    const iso = toISODate(raw);
    if (!iso) return "";
    const parts = iso.split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function daysInMonth(key) {
    const parts = String(key).split("-").map(Number);
    return new Date(parts[0], parts[1], 0).getDate();
  }

  /**
   * % of the given month that has elapsed so far (0–100).
   * Past months = 100, future months = 0.
   */
  function monthProgressPct(key) {
    const current = todayISO().slice(0, 7);
    if (key < current) return 100;
    if (key > current) return 0;
    return Math.min(100, (new Date().getDate() / daysInMonth(key)) * 100);
  }

  /**
   * Every month key from `from` to `to` inclusive, with no gaps — so a
   * month where nothing was recorded still gets a slot on the x-axis
   * instead of being silently skipped.
   */
  function monthRange(from, to) {
    const out = [];
    if (!from || !to || from > to) return out;
    let [y, m] = from.split("-").map(Number);
    const [ey, em] = to.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(y + "-" + pad2(m));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }

  function money(n) {
    return "$" + Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  /** Compact form for axis ticks and tight tiles: $24.5k, $1.2m */
  function moneyShort(n) {
    const v = Number(n || 0);
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "m";
    if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + "k";
    return sign + "$" + abs.toFixed(0);
  }

  function pct(n) { return Math.round(n) + "%"; }

  /** Escapes a string for safe interpolation into innerHTML. */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** Trailing-edge debounce, used for resize-driven chart re-renders. */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  }

  Q.util = {
    todayISO, toISODate, monthOf, monthKeyFromOffset, monthLabel, monthShort,
    dateLabel, daysInMonth, monthProgressPct, monthRange,
    money, moneyShort, pct, esc, debounce
  };
})(window.Q);
