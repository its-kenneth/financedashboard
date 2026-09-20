/* ------------------------------------------------------------------
 * ledger.js — the expense tracker (index.html).
 *
 * Same behaviour as the original single-file version; the API layer,
 * date/money helpers and passphrase gate now come from the shared
 * modules so the dashboard can't drift out of sync with it.
 * ---------------------------------------------------------------- */
(function (Q) {
  "use strict";

  const U = Q.util;
  const CATEGORIES = ["Food", "Transport", "Groceries", "Entertainment", "Shopping", "Other"];

  const load = () => Q.api.withAuth(Q.api.fetchAll);

  /* ---------------------------- Tabs --------------------------- */
  function activateTab(tab) {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelector('.tab[data-tab="' + tab + '"]').classList.add("active");
    document.getElementById("panel-" + tab).classList.add("active");
    if (tab === "report") renderReport();
    if (tab === "budget") loadBudgetTab();
  }

  /* ------------------------- Entry form ------------------------ */
  function initEntryForm() {
    const dateInput = document.getElementById("f-date");
    dateInput.value = U.todayISO();

    const catSelect = document.getElementById("f-category");
    const catCustom = document.getElementById("f-category-custom");
    catSelect.addEventListener("change", function () {
      catCustom.style.display = catSelect.value === "__custom" ? "block" : "none";
    });

    document.getElementById("entry-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const statusEl = document.getElementById("status");
      const item = document.getElementById("f-item").value.trim();
      const amount = parseFloat(document.getElementById("f-amount").value);
      const category = catSelect.value === "__custom"
        ? (catCustom.value.trim() || "Other") : catSelect.value;
      const date = dateInput.value || U.todayISO();

      if (!item) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Enter what the item was.";
        return;
      }
      if (!amount || amount <= 0) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Enter an amount greater than zero.";
        return;
      }

      statusEl.className = "status-line";
      statusEl.textContent = "Posting to expenditure book…";

      try {
        await Q.api.withAuth(() => Q.api.addEntry({ date, amount, category, item }));
        statusEl.className = "status-line ok";
        statusEl.textContent = "Entered " + U.money(amount) + " for " + item + ".";
        document.getElementById("f-item").value = "";
        document.getElementById("f-amount").value = "";
        await renderRecent();
      } catch (err) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Could not save: " + err.message;
      }
    });
  }

  /* ----------------------- Recent entries ---------------------- */
  async function renderRecent() {
    const listEl = document.getElementById("recent-list");
    try {
      const { entries } = await load();
      if (entries.length === 0) {
        listEl.innerHTML = '<div class="empty">No entries yet. Ring up your first one above.</div>';
        return;
      }
      const sorted = entries
        .map(en => Object.assign({}, en, { _iso: U.toISODate(en.date) }))
        .sort((a, b) => b._iso.localeCompare(a._iso))
        .slice(0, 8);
      listEl.innerHTML = sorted.map(en =>
        '<div class="entry-row">' +
          '<span class="e-date">' + U.esc(en._iso) + "</span>" +
          '<span class="e-mid">' +
            '<span class="e-item">' + U.esc(en.item || "(no item)") + "</span>" +
            '<span class="e-cat">' + U.esc(en.category) + "</span>" +
          "</span>" +
          '<span class="e-amt">' + U.esc(U.money(en.amount)) + "</span>" +
        "</div>"
      ).join("");
    } catch (err) {
      listEl.innerHTML = '<div class="empty">Could not load entries: ' + U.esc(err.message) + "</div>";
    }
  }

  /* ----------------------- Monthly report ---------------------- */
  async function renderReport() {
    const monthSelect = document.getElementById("month-select");
    const totalEl = document.getElementById("month-total");
    const breakdownEl = document.getElementById("category-breakdown");
    const overallBudgetEl = document.getElementById("overall-budget-block");
    const progressEl = document.getElementById("month-progress-block");

    let entries, budgets;
    try {
      ({ entries, budgets } = await load());
    } catch (err) {
      breakdownEl.innerHTML = '<div class="empty">Could not load entries: ' + U.esc(err.message) + "</div>";
      overallBudgetEl.innerHTML = "";
      progressEl.innerHTML = "";
      return;
    }

    if (entries.length === 0) {
      monthSelect.innerHTML = "";
      totalEl.textContent = U.money(0);
      breakdownEl.innerHTML = '<div class="empty">No entries yet.</div>';
      overallBudgetEl.innerHTML = "";
      progressEl.innerHTML = "";
      return;
    }

    const previousSelection = monthSelect.value;
    const months = [...new Set(entries.map(e => U.monthOf(e.date)).filter(Boolean))].sort().reverse();
    const currentMonth = U.todayISO().slice(0, 7);
    const selected = previousSelection && months.includes(previousSelection)
      ? previousSelection
      : (months.includes(currentMonth) ? currentMonth : months[0]);

    monthSelect.innerHTML = months.map(m =>
      '<option value="' + m + '"' + (m === selected ? " selected" : "") + ">" + U.monthLabel(m) + "</option>"
    ).join("");
    monthSelect.onchange = renderReport;

    const inMonth = entries.filter(e => U.monthOf(e.date) === selected);
    const total = inMonth.reduce((s, e) => s + Number(e.amount), 0);
    totalEl.textContent = U.money(total);

    // --- % of month elapsed ---
    const progress = U.monthProgressPct(selected);
    progressEl.innerHTML =
      '<div class="s-row"><span>Month Elapsed</span><span class="s-amt">' + U.pct(progress) + "</span></div>" +
      '<div class="s-bar-track"><div class="s-bar-fill progress" style="width:' + progress.toFixed(1) + '%"></div></div>';

    // --- overall budget vs spend ---
    const monthBudgets = (budgets && budgets[selected]) || {};
    const overallBudget = Object.values(monthBudgets).reduce((s, v) => s + (Number(v) || 0), 0);

    if (overallBudget > 0) {
      const spentPct = (total / overallBudget) * 100;
      const over = total > overallBudget;
      overallBudgetEl.innerHTML =
        '<div class="s-row"><span>Budget for ' + U.monthLabel(selected) + '</span>' +
          '<span class="s-amt">' + U.money(overallBudget) + "</span></div>" +
        '<div class="s-row"><span>% of Budget Spent</span>' +
          '<span class="s-amt ' + (over ? "over" : "under") + '">' + U.pct(spentPct) + "</span></div>" +
        '<div class="s-bar-track"><div class="s-bar-fill spend" style="width:' +
          Math.min(100, spentPct).toFixed(1) + '%"></div></div>';
    } else {
      overallBudgetEl.innerHTML =
        '<div class="no-budget">No budget set for ' + U.monthLabel(selected) +
        '. <a class="set-link" id="go-set-budget">Set one</a>.</div>';
      const link = document.getElementById("go-set-budget");
      if (link) link.addEventListener("click", function () {
        activateTab("budget");
        setTimeout(function () {
          const sel = document.getElementById("b-month");
          if (sel && [...sel.options].some(o => o.value === selected)) sel.value = selected;
          prefillBudgetCategoryInputs();
        }, 0);
      });
    }

    // --- per-category breakdown ---
    const byCat = {};
    inMonth.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });

    // Only show a category if it has spending this month, a budget set
    // for this month, or both — skip categories with neither.
    const allCatNames = [...new Set([...CATEGORIES, ...Object.keys(byCat)])]
      .filter(cat => (byCat[cat] || 0) > 0 || (monthBudgets[cat] !== undefined && monthBudgets[cat] > 0));
    const catList = allCatNames.map(cat => [cat, byCat[cat] || 0]).sort((a, b) => b[1] - a[1]);
    const max = catList.length && catList[0][1] > 0 ? catList[0][1] : 1;

    breakdownEl.innerHTML = catList.length === 0
      ? '<div class="empty">No spending or budgets for ' + U.monthLabel(selected) + ".</div>"
      : catList.map(function (pair) {
          const cat = pair[0], amt = pair[1];
          const catBudget = monthBudgets[cat];
          let amtLine;
          if (catBudget !== undefined && catBudget > 0) {
            const catPct = (amt / catBudget) * 100;
            amtLine = U.money(amt) + ' <span class="cat-pct ' + (amt > catBudget ? "over" : "") +
                      '">· ' + U.pct(catPct) + " of budget</span>";
          } else {
            amtLine = U.money(amt) + ' <span class="cat-pct muted">· no budget set</span>';
          }

          const catEntries = inMonth
            .filter(e => e.category === cat)
            .map(e => Object.assign({}, e, { _iso: U.toISODate(e.date) }))
            .sort((a, b) => b._iso.localeCompare(a._iso));

          const expensesHtml = catEntries.length
            ? catEntries.map(e =>
                '<div class="entry-row">' +
                  '<span class="e-date">' + U.esc(e._iso) + "</span>" +
                  '<span class="e-mid"><span class="e-item">' + U.esc(e.item || "(no item)") + "</span></span>" +
                  '<span class="e-amt">' + U.esc(U.money(e.amount)) + "</span>" +
                "</div>"
              ).join("")
            : '<div class="empty">No expenses in ' + U.monthLabel(selected) + ".</div>";

          return '<details class="cat-row"><summary>' +
            '<div class="cat-head"><span class="cat-name">' + U.esc(cat) + "</span>" +
            '<span class="cat-amt">' + amtLine + "</span></div>" +
            '<div class="cat-bar-track"><div class="cat-bar-fill" style="width:' +
              (amt / max * 100).toFixed(1) + '%"></div></div>' +
            '</summary><div class="cat-expenses">' + expensesHtml + "</div></details>";
        }).join("");
  }

  /* ------------------------- Budget tab ------------------------ */
  let cachedBudgets = {};

  function prefillBudgetCategoryInputs() {
    const month = document.getElementById("b-month").value;
    const monthBudgets = cachedBudgets[month] || {};
    CATEGORIES.forEach(function (cat) {
      const input = document.getElementById("b-cat-" + cat);
      input.value = monthBudgets[cat] !== undefined ? monthBudgets[cat] : "";
    });
  }

  async function loadBudgetTab() {
    const monthSelect = document.getElementById("b-month");
    const previousSelection = monthSelect.value;

    let entries, budgets;
    try {
      ({ entries, budgets } = await load());
    } catch (err) {
      document.getElementById("budget-history").innerHTML =
        '<div class="empty">Could not load budgets: ' + U.esc(err.message) + "</div>";
      return;
    }
    cachedBudgets = budgets || {};

    // Month options: a year back to a few months ahead, plus any month that
    // already has entries or budgets, so nothing is ever out of range.
    const generated = [];
    for (let i = -12; i <= 6; i++) generated.push(U.monthKeyFromOffset(i));
    const fromData = [
      ...Object.keys(cachedBudgets),
      ...entries.map(e => U.monthOf(e.date)).filter(Boolean)
    ];
    const allMonths = [...new Set([...generated, ...fromData])].sort().reverse();

    const currentMonth = U.todayISO().slice(0, 7);
    const selected = previousSelection && allMonths.includes(previousSelection)
      ? previousSelection : currentMonth;
    monthSelect.innerHTML = allMonths.map(m =>
      '<option value="' + m + '"' + (m === selected ? " selected" : "") + ">" + U.monthLabel(m) + "</option>"
    ).join("");

    prefillBudgetCategoryInputs();
    renderBudgetHistory();
  }

  function renderBudgetHistory() {
    const historyEl = document.getElementById("budget-history");
    const months = Object.keys(cachedBudgets).sort().reverse();
    if (months.length === 0) {
      historyEl.innerHTML = '<div class="empty">No budgets set yet.</div>';
      return;
    }
    historyEl.innerHTML = months.map(function (m) {
      const cats = cachedBudgets[m];
      const rows = Object.entries(cats).map(([cat, amt]) =>
        '<div class="budget-row"><span>' + U.esc(cat) + "</span><span>" + U.esc(U.money(amt)) + "</span></div>"
      ).join("");
      const total = Object.values(cats).reduce((s, v) => s + (Number(v) || 0), 0);
      return '<div class="budget-month-group"><h4>' + U.monthLabel(m) + " · " +
             U.money(total) + " total</h4>" + rows + "</div>";
    }).join("");
  }

  function initBudgetTab() {
    const budgetFieldsEl = document.getElementById("budget-cat-fields");
    budgetFieldsEl.innerHTML = CATEGORIES.map(cat =>
      '<div class="budget-cat-row">' +
        '<label for="b-cat-' + cat + '">' + cat + "</label>" +
        '<input type="number" step="0.01" min="0" id="b-cat-' + cat +
          '" class="b-cat-input" data-cat="' + cat + '" placeholder="0.00">' +
      "</div>"
    ).join("");

    document.getElementById("b-month").addEventListener("change", prefillBudgetCategoryInputs);

    document.getElementById("budget-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const statusEl = document.getElementById("budget-status");
      const month = document.getElementById("b-month").value;

      if (!month) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Choose a month.";
        return;
      }

      const catBudgets = {};
      let hasValue = false;
      CATEGORIES.forEach(function (cat) {
        const raw = document.getElementById("b-cat-" + cat).value;
        if (raw !== "") {
          const n = parseFloat(raw);
          if (!isNaN(n) && n >= 0) { catBudgets[cat] = n; hasValue = true; }
        }
      });

      if (!hasValue) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Enter a budget for at least one category.";
        return;
      }

      statusEl.className = "status-line";
      statusEl.textContent = "Saving…";

      try {
        await Q.api.withAuth(() => Q.api.saveBudgets(month, catBudgets));
        statusEl.className = "status-line ok";
        statusEl.textContent = "Budgets saved for " + U.monthLabel(month) + ".";
        await loadBudgetTab();
      } catch (err) {
        statusEl.className = "status-line err";
        statusEl.textContent = "Could not save: " + err.message;
      }
    });
  }

  /* --------------------------- Boot ---------------------------- */
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".tab").forEach(btn =>
      btn.addEventListener("click", () => activateTab(btn.dataset.tab)));

    initEntryForm();
    initBudgetTab();

    document.getElementById("config-note").innerHTML = Q.api.isDemoMode
      ? 'Running in <strong>local demo mode</strong> — entries are saved only in this browser ' +
        '(<code>localStorage</code>). Deploy <code>Code.gs</code> as a Google Apps Script Web App ' +
        'and paste the URL into <code>API_URL</code> in <code>assets/api.js</code>.'
      : "Connected to your Google Sheet via Apps Script.";

    renderRecent();
  });
})(window.Q);
