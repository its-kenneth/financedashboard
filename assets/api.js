/* ------------------------------------------------------------------
 * api.js — the single place that talks to Google Apps Script, plus the
 * passphrase gate that keeps the Sheet from being readable by anyone
 * who views source on the public GitHub Pages site.
 *
 * CONFIGURE ME: paste your Apps Script Web App /exec URL below.
 * Leave it as "PASTE_YOUR_URL_HERE" to run in local demo mode, where
 * everything is stored in this browser only.
 * ---------------------------------------------------------------- */
window.Q = window.Q || {};

(function (Q) {
  "use strict";

  const API_URL = "https://script.google.com/macros/s/AKfycbxHnGX-mp96zEtQfHMEJ96etK_G4jaiy_mauNGfgQxytCrCbevmq-EfH8dltKP05Z_tCw/exec";

  const TOKEN_KEY   = "qian_token";
  const DEMO_ENTRIES   = "ledger_demo_entries";
  const DEMO_BUDGETS   = "ledger_demo_budgets";
  const DEMO_POSITIONS = "ledger_demo_positions";

  const isDemoMode = !API_URL || API_URL.indexOf("PASTE_YOUR") !== -1;

  /* ------------------------ token storage ----------------------- */

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(v) {
    try { localStorage.setItem(TOKEN_KEY, v || ""); } catch (e) { /* private mode */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
  }

  /** Thrown when the backend rejects our token, so callers can show the lock. */
  function AuthError(message) {
    this.name = "AuthError";
    this.message = message || "Unauthorized";
  }
  AuthError.prototype = Object.create(Error.prototype);

  function checkAuth(data) {
    if (data && data.status === "unauthorized") throw new AuthError(data.message);
    return data;
  }

  /* --------------------- demo-mode local store ------------------ */

  function readLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || fallback); }
    catch (e) { return JSON.parse(fallback); }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  /* ---------------------------- reads --------------------------- */

  /**
   * Returns { entries, budgets, positions } — the whole dataset in one
   * round trip. Apps Script is slow enough per request that fetching
   * everything once and slicing it client-side beats three calls.
   */
  async function fetchAll() {
    if (isDemoMode) {
      return {
        entries:   readLocal(DEMO_ENTRIES, "[]"),
        budgets:   readLocal(DEMO_BUDGETS, "{}"),
        positions: readLocal(DEMO_POSITIONS, "[]")
      };
    }
    const url = API_URL + "?token=" + encodeURIComponent(getToken());
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("Failed to load data (HTTP " + res.status + ")");
    const data = checkAuth(await res.json());
    return {
      entries:   data.entries   || [],
      budgets:   data.budgets   || {},
      positions: data.positions || []
    };
  }

  /* --------------------------- writes --------------------------- */

  // text/plain dodges the CORS preflight Apps Script can't answer.
  async function post(body) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ token: getToken() }, body))
    });
    const data = checkAuth(await res.json());
    if (data.status !== "ok") throw new Error(data.message || "Unknown error");
    return data;
  }

  async function addEntry(entry) {
    if (isDemoMode) {
      const list = readLocal(DEMO_ENTRIES, "[]");
      list.push(entry);
      writeLocal(DEMO_ENTRIES, list);
      return { status: "ok" };
    }
    return post(entry);
  }

  /** catBudgets: { "Food": 300, "Transport": 100, ... } */
  async function saveBudgets(month, catBudgets) {
    if (isDemoMode) {
      const budgets = readLocal(DEMO_BUDGETS, "{}");
      budgets[month] = Object.assign({}, budgets[month] || {}, catBudgets);
      writeLocal(DEMO_BUDGETS, budgets);
      return { status: "ok" };
    }
    return post({ type: "budget", month: month, budgets: catBudgets });
  }

  /**
   * rows: [{account, type, amount, remarks}, ...]
   * Replaces the entire snapshot for `date` — a financial position is the
   * whole picture on a day, not a running log of individual edits.
   */
  async function savePositions(date, rows) {
    if (isDemoMode) {
      const all = readLocal(DEMO_POSITIONS, "[]").filter(p => p.date !== date);
      rows.forEach(r => {
        if (String(r.account || "").trim() === "") return;
        all.push({
          date: date,
          account: String(r.account).trim(),
          type: r.type === "Investments" ? "Investments" : "Savings",
          amount: Number(r.amount) || 0,
          remarks: String(r.remarks || "")
        });
      });
      writeLocal(DEMO_POSITIONS, all);
      return { status: "ok" };
    }
    return post({ type: "positions", date: date, positions: rows });
  }

  /* ------------------------- the lock UI ------------------------ */

  let lockEl = null;

  function buildLock() {
    if (lockEl) return lockEl;
    lockEl = document.createElement("div");
    lockEl.className = "lock-overlay";
    lockEl.innerHTML =
      '<form class="lock-card" autocomplete="on">' +
        '<h2>Locked</h2>' +
        '<p>This ledger is served from a public URL, so the data behind it ' +
           'needs the passphrase you set as <code>AUTH_TOKEN</code>.</p>' +
        '<label for="lock-pass">Passphrase</label>' +
        '<input type="password" id="lock-pass" name="password" ' +
               'autocomplete="current-password" required>' +
        '<button type="submit" class="stamp-btn">Unlock</button>' +
        '<div class="status-line" id="lock-status"></div>' +
      '</form>';
    document.body.appendChild(lockEl);
    return lockEl;
  }

  /**
   * Shows the passphrase prompt and resolves once the supplied value is
   * accepted by `verify` (which should re-attempt the real request).
   */
  function promptForToken(verify) {
    return new Promise(function (resolve) {
      const el = buildLock();
      el.classList.add("show");
      const form   = el.querySelector("form");
      const input  = el.querySelector("#lock-pass");
      const status = el.querySelector("#lock-status");
      input.value = "";
      setTimeout(function () { input.focus(); }, 50);

      form.onsubmit = async function (ev) {
        ev.preventDefault();
        const candidate = input.value.trim();
        if (!candidate) return;
        status.className = "status-line";
        status.textContent = "Checking…";
        setToken(candidate);
        try {
          const result = await verify();
          el.classList.remove("show");
          status.textContent = "";
          resolve(result);
        } catch (err) {
          clearToken();
          status.className = "status-line err";
          status.textContent = (err && err.name === "AuthError")
            ? "That passphrase was rejected."
            : "Could not reach the ledger: " + err.message;
          input.select();
        }
      };
    });
  }

  /**
   * The entry point every page uses. Runs `work` (normally a fetchAll),
   * and if the backend says unauthorized, shows the lock and retries
   * after the passphrase is accepted.
   */
  async function withAuth(work) {
    try {
      return await work();
    } catch (err) {
      if (err && err.name === "AuthError") return promptForToken(work);
      throw err;
    }
  }

  /** Wipes the saved passphrase and reloads — the "sign out" affordance. */
  function forget() {
    clearToken();
    location.reload();
  }

  Q.api = {
    API_URL: API_URL,
    isDemoMode: isDemoMode,
    fetchAll: fetchAll,
    addEntry: addEntry,
    saveBudgets: saveBudgets,
    savePositions: savePositions,
    withAuth: withAuth,
    forget: forget,
    hasToken: function () { return !!getToken(); }
  };
})(window.Q);
