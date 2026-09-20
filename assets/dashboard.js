/* ------------------------------------------------------------------
 * dashboard.js — finance overview + financial-position editor.
 * ---------------------------------------------------------------- */
(function (Q) {
  "use strict";

  const U = Q.util;
  const SERIES = "#1264a3";

  /* Everything the page has loaded, in one place. */
  const S = { entries: [], budgets: {}, positions: [] };

  /* Chart render configs kept around so a resize can redraw them. */
  const charts = {};

  /* ================= derivations from raw rows ================= */

  function snapshotDates() {
    return [...new Set(S.positions.map(p => U.toISODate(p.date)).filter(Boolean))].sort();
  }

  function rowsOn(date) {
    return S.positions.filter(p => U.toISODate(p.date) === date);
  }

  function sumType(rows, type) {
    return rows.reduce((s, p) => s + (p.type === type ? Number(p.amount) || 0 : 0), 0);
  }

  function latestDate() {
    const d = snapshotDates();
    return d.length ? d[d.length - 1] : "";
  }

  /**
   * Net savings per month = the average of each snapshot's savings total
   * across that month, exactly as specified.
   *
   * Months with no snapshot are omitted rather than plotted as zero: a
   * missing reading means "I didn't check", not "the money vanished."
   * (Spending, below, is treated the opposite way — see its comment.)
   */
  function savingsSeries() {
    const byMonth = {};
    snapshotDates().forEach(function (d) {
      const m = d.slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push(sumType(rowsOn(d), "Savings"));
    });
    return Object.keys(byMonth).sort().map(function (m) {
      const vals = byMonth[m];
      return {
        key: m,
        label: U.monthShort(m),
        full: U.monthLabel(m) + (vals.length > 1 ? " · avg of " + vals.length + " snapshots" : ""),
        value: vals.reduce((a, b) => a + b, 0) / vals.length
      };
    });
  }

  /**
   * Spending per month. Here a gap month IS plotted as zero — the
   * expense tracker is used continuously, so "no entries" genuinely
   * means nothing was rung up that month.
   */
  function spendingSeries() {
    const byMonth = {};
    S.entries.forEach(function (e) {
      const m = U.monthOf(e.date);
      if (!m) return;
      byMonth[m] = (byMonth[m] || 0) + (Number(e.amount) || 0);
    });
    const keys = Object.keys(byMonth).sort();
    if (!keys.length) return [];
    const thisMonth = U.todayISO().slice(0, 7);
    const last = keys[keys.length - 1] > thisMonth ? keys[keys.length - 1] : thisMonth;
    return U.monthRange(keys[0], last).map(m => ({
      key: m, label: U.monthShort(m), full: U.monthLabel(m), value: byMonth[m] || 0
    }));
  }

  /** The change between the last two points of a series. */
  function delta(series) {
    if (series.length < 2) return null;
    const a = series[series.length - 2].value;
    const b = series[series.length - 1].value;
    return { abs: b - a, pct: a === 0 ? null : ((b - a) / Math.abs(a)) * 100, from: series[series.length - 2] };
  }

  /**
   * Renders a delta with an arrow glyph and words alongside the colour,
   * so the direction survives colour-blindness, greyscale print and
   * forced-colors mode.
   *
   * `goodWhenUp` flips the colour for spending, where a rise is not good.
   */
  function deltaHTML(d, goodWhenUp) {
    if (!d) return '<span class="delta flat">— no prior month</span>';
    const up = d.abs > 0.005, down = d.abs < -0.005;
    const cls = !up && !down ? "flat" : (up === !!goodWhenUp ? "good" : "bad");
    const glyph = up ? "▲" : down ? "▼" : "■";
    const word = up ? "up" : down ? "down" : "flat";
    const pctText = d.pct === null ? "" : " (" + Math.abs(d.pct).toFixed(1) + "%)";
    return '<span class="delta ' + cls + '">' + glyph + " " + word + " " +
           U.esc(U.money(Math.abs(d.abs))) + U.esc(pctText) +
           ' <span class="d-word">vs ' + U.esc(U.monthShort(d.from.key)) + "</span></span>";
  }

  /* ======================== overview tab ======================= */

  function renderOverview() {
    const snapDate = latestDate();
    const latestRows = snapDate ? rowsOn(snapDate) : [];
    const savings = sumType(latestRows, "Savings");
    const invest = sumType(latestRows, "Investments");

    const savSeries = savingsSeries();
    const spdSeries = spendingSeries();
    const thisMonth = U.todayISO().slice(0, 7);
    const monthSpend = S.entries.reduce(
      (s, e) => s + (U.monthOf(e.date) === thisMonth ? Number(e.amount) || 0 : 0), 0);

    /* ---- hero: net savings ---- */
    document.getElementById("kpi-savings").textContent = U.money(savings);
    document.getElementById("kpi-savings-sub").textContent = snapDate
      ? latestRows.filter(r => r.type === "Savings").length + " savings accounts · as of " + U.dateLabel(snapDate)
      : "No position recorded yet";
    document.getElementById("kpi-savings-delta").innerHTML = deltaHTML(delta(savSeries), true);

    /* ---- hero: this month's spending ---- */
    document.getElementById("kpi-spend").textContent = U.money(monthSpend);
    document.getElementById("kpi-spend-sub").textContent =
      U.monthLabel(thisMonth) + " · " + U.pct(U.monthProgressPct(thisMonth)) + " of the month elapsed";
    // The series' last point is the current, partial month, so compare
    // against it rather than recomputing.
    document.getElementById("kpi-spend-delta").innerHTML = deltaHTML(delta(spdSeries), false);

    /* ---- supporting tiles ---- */
    document.getElementById("tile-networth").textContent = U.money(savings + invest);
    document.getElementById("tile-networth-sub").textContent =
      snapDate ? "savings + investments" : "—";

    document.getElementById("tile-invest").textContent = U.money(invest);
    document.getElementById("tile-invest-sub").textContent = (savings + invest) > 0
      ? U.pct((invest / (savings + invest)) * 100) + " of net worth"
      : "—";

    const monthBudgets = S.budgets[thisMonth] || {};
    const budgetTotal = Object.values(monthBudgets).reduce((s, v) => s + (Number(v) || 0), 0);
    const budgetTile = document.getElementById("tile-budget");
    const budgetSub = document.getElementById("tile-budget-sub");
    if (budgetTotal > 0) {
      const used = (monthSpend / budgetTotal) * 100;
      budgetTile.textContent = U.pct(used);
      budgetTile.className = "t-value " + (monthSpend > budgetTotal ? "delta bad" : "");
      budgetSub.textContent = U.money(monthSpend) + " of " + U.money(budgetTotal);
    } else {
      budgetTile.textContent = "—";
      budgetTile.className = "t-value";
      budgetSub.textContent = "No budget set for " + U.monthShort(thisMonth);
    }

    /* ---- charts ---- */
    charts.savings = {
      el: document.getElementById("chart-savings"),
      opts: {
        points: savSeries, color: SERIES, height: 190,
        formatValue: U.money, formatTick: U.moneyShort,
        ariaLabel: "Net savings by month",
        emptyText: "Record a financial position to start this chart."
      }
    };
    charts.spending = {
      el: document.getElementById("chart-spending"),
      opts: {
        points: spdSeries, color: SERIES, height: 190,
        formatValue: U.money, formatTick: U.moneyShort,
        ariaLabel: "Total spending by month",
        emptyText: "No expenses recorded yet."
      }
    };
    drawCharts();

    document.getElementById("table-savings").innerHTML = Q.chart.table(savSeries, U.money);
    document.getElementById("table-spending").innerHTML = Q.chart.table(spdSeries, U.money);

    /* ---- current position breakdown ---- */
    const bd = document.getElementById("position-breakdown");
    const asOf = document.getElementById("breakdown-asof");
    if (!latestRows.length) {
      bd.innerHTML = '<div class="empty">No accounts recorded yet. Use the Update Position tab.</div>';
      asOf.textContent = "";
    } else {
      const total = savings + invest;
      const sorted = [...latestRows].sort((a, b) => b.amount - a.amount);
      // Five columns don't fit a phone, so the table scrolls inside its
      // card rather than pushing the whole page sideways.
      bd.innerHTML =
        "<div class='table-scroll'><table class='data-table'><thead><tr>" +
        "<th>Account</th><th>Type</th><th style='text-align:right'>Amount</th>" +
        "<th style='text-align:right'>Share</th><th class='col-remarks'>Remarks</th>" +
        "</tr></thead><tbody>" +
        sorted.map(r =>
          "<tr><th scope='row'>" + U.esc(r.account) +
            // On a phone the Remarks column is hidden and its text rides
            // along under the account name instead, so nothing is lost.
            (r.remarks ? "<span class='row-remarks'>" + U.esc(r.remarks) + "</span>" : "") +
          "</th>" +
          "<td style='text-align:left'>" + U.esc(r.type) + "</td>" +
          "<td>" + U.esc(U.money(r.amount)) + "</td>" +
          "<td>" + (total > 0 ? U.pct((r.amount / total) * 100) : "—") + "</td>" +
          "<td class='col-remarks' style='text-align:left'>" + U.esc(r.remarks || "—") + "</td></tr>"
        ).join("") +
        "</tbody></table></div>";
      asOf.textContent = "as of " + U.dateLabel(snapDate);
    }
  }

  function drawCharts() {
    Object.keys(charts).forEach(function (k) {
      if (charts[k] && charts[k].el) Q.chart.line(charts[k].el, charts[k].opts);
    });
  }

  /* ==================== update position tab ==================== */

  const posBody = () => document.getElementById("pos-rows");

  function blankRow() {
    return { account: "", type: "Savings", amount: "", remarks: "" };
  }

  function rowHTML(r, i) {
    return '' +
      '<div class="pos-row" data-i="' + i + '">' +
        '<div class="cell cell-account"><label for="pos-acc-' + i + '">Account</label>' +
          '<input type="text" id="pos-acc-' + i + '" data-f="account" ' +
                 'placeholder="DBS Multiplier" value="' + U.esc(r.account) + '"></div>' +
        '<div class="cell cell-type"><label for="pos-type-' + i + '">Type</label>' +
          '<select id="pos-type-' + i + '" data-f="type">' +
            '<option value="Savings"' + (r.type !== "Investments" ? " selected" : "") + '>Savings</option>' +
            '<option value="Investments"' + (r.type === "Investments" ? " selected" : "") + '>Investments</option>' +
          '</select></div>' +
        '<div class="cell cell-amount"><label for="pos-amt-' + i + '">Amount</label>' +
          '<input type="number" inputmode="decimal" step="0.01" id="pos-amt-' + i + '" ' +
                 'data-f="amount" placeholder="0.00" value="' + U.esc(r.amount) + '"></div>' +
        '<div class="cell cell-remarks"><label for="pos-rem-' + i + '">Remarks</label>' +
          '<input type="text" id="pos-rem-' + i + '" data-f="remarks" ' +
                 'placeholder="2.5% p.a." value="' + U.esc(r.remarks) + '"></div>' +
        '<div class="cell cell-del">' +
          '<button type="button" class="del-btn" data-del="' + i + '" ' +
                  'aria-label="Remove ' + U.esc(r.account || "row " + (i + 1)) + '">✕</button></div>' +
      '</div>';
  }

  function renderRows(rows) {
    posBody().innerHTML = rows.length
      ? rows.map(rowHTML).join("")
      : '<div class="empty">No accounts yet — add your first one below.</div>';
    updatePosTotals();
  }

  function readRows() {
    return [...posBody().querySelectorAll(".pos-row")].map(function (el) {
      const get = f => el.querySelector('[data-f="' + f + '"]').value;
      return {
        account: get("account").trim(),
        type: get("type"),
        amount: get("amount"),
        remarks: get("remarks").trim()
      };
    });
  }

  function updatePosTotals() {
    const rows = readRows();
    const sav = rows.reduce((s, r) => s + (r.type === "Savings" ? Number(r.amount) || 0 : 0), 0);
    const inv = rows.reduce((s, r) => s + (r.type === "Investments" ? Number(r.amount) || 0 : 0), 0);
    document.getElementById("pos-sum-savings").textContent = U.money(sav);
    document.getElementById("pos-sum-invest").textContent = U.money(inv);
    document.getElementById("pos-sum-total").textContent = U.money(sav + inv);
  }

  /**
   * Prefills the editor for `date`: the snapshot for that exact date if
   * one exists, otherwise the most recent earlier snapshot as a starting
   * template (amounts included — you usually edit a few, not all).
   */
  function loadRowsForDate(date) {
    const exact = rowsOn(date);
    if (exact.length) {
      renderRows(exact.map(r => ({
        account: r.account, type: r.type, amount: r.amount, remarks: r.remarks
      })));
      setPosNote("Editing the existing snapshot for " + U.dateLabel(date) + ". Saving replaces it.");
      return;
    }
    const earlier = snapshotDates().filter(d => d < date);
    if (earlier.length) {
      const src = earlier[earlier.length - 1];
      renderRows(rowsOn(src).map(r => ({
        account: r.account, type: r.type, amount: r.amount, remarks: r.remarks
      })));
      setPosNote("Prefilled from your " + U.dateLabel(src) + " snapshot. Adjust the amounts and save.");
      return;
    }
    renderRows([blankRow()]);
    setPosNote("New snapshot — add one row per account.");
  }

  function setPosNote(text) {
    document.getElementById("pos-note").textContent = text;
  }

  function renderSnapshotList() {
    const list = document.getElementById("snapshot-list");
    const dates = snapshotDates().reverse();
    if (!dates.length) {
      list.innerHTML = '<div class="empty">No snapshots recorded yet.</div>';
      return;
    }
    list.innerHTML = dates.map(function (d) {
      const rows = rowsOn(d);
      const sav = sumType(rows, "Savings"), inv = sumType(rows, "Investments");
      return '<div class="snapshot-row">' +
        '<span class="s-date">' + U.esc(U.dateLabel(d)) + " · " + rows.length + " accounts</span>" +
        '<span class="s-nums">' + U.esc(U.money(sav + inv)) +
          ' <button type="button" data-load="' + U.esc(d) + '">edit</button></span>' +
        "</div>";
    }).join("");
  }

  /* ========================= wiring ============================ */

  function activateTab(tab) {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelector('.tab[data-tab="' + tab + '"]').classList.add("active");
    document.getElementById("panel-" + tab).classList.add("active");
    // Charts measure their container, which is zero-wide while hidden.
    if (tab === "overview") drawCharts();
  }

  async function refresh() {
    const data = await Q.api.withAuth(Q.api.fetchAll);
    S.entries = data.entries;
    S.budgets = data.budgets;
    S.positions = data.positions;
    renderOverview();
    renderSnapshotList();
  }

  function init() {
    document.querySelectorAll(".tab").forEach(btn =>
      btn.addEventListener("click", () => activateTab(btn.dataset.tab)));

    // table-view toggles (the WCAG-clean twin of each chart).
    // Scoped to buttons that actually name a target — other link-styled
    // buttons share the class purely for looks.
    document.querySelectorAll(".table-toggle[data-target]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const target = document.getElementById(btn.dataset.target);
        const open = target.classList.toggle("show");
        btn.textContent = open ? "Hide table" : "Show table";
        btn.setAttribute("aria-expanded", String(open));
      });
    });

    const dateInput = document.getElementById("pos-date");
    dateInput.value = U.todayISO();
    dateInput.addEventListener("change", () => loadRowsForDate(dateInput.value || U.todayISO()));

    document.getElementById("add-row").addEventListener("click", function () {
      const rows = readRows();
      rows.push(blankRow());
      renderRows(rows);
      const inputs = posBody().querySelectorAll('[data-f="account"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    posBody().addEventListener("click", function (e) {
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      const rows = readRows();
      rows.splice(Number(btn.dataset.del), 1);
      renderRows(rows.length ? rows : [blankRow()]);
    });
    posBody().addEventListener("input", updatePosTotals);
    posBody().addEventListener("change", updatePosTotals);

    document.getElementById("snapshot-list").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-load]");
      if (!btn) return;
      dateInput.value = btn.dataset.load;
      loadRowsForDate(btn.dataset.load);
      dateInput.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    document.getElementById("pos-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const status = document.getElementById("pos-status");
      const date = dateInput.value || U.todayISO();
      const rows = readRows().filter(r => r.account !== "");

      if (!rows.length) {
        status.className = "status-line err";
        status.textContent = "Add at least one account with a name.";
        return;
      }
      const bad = rows.find(r => r.amount === "" || isNaN(Number(r.amount)));
      if (bad) {
        status.className = "status-line err";
        status.textContent = 'Enter an amount for "' + bad.account + '".';
        return;
      }

      status.className = "status-line";
      status.textContent = "Saving snapshot…";
      try {
        await Q.api.withAuth(() => Q.api.savePositions(date, rows));
        status.className = "status-line ok";
        status.textContent = "Saved " + rows.length + " accounts for " + U.dateLabel(date) + ".";
        await refresh();
      } catch (err) {
        status.className = "status-line err";
        status.textContent = "Could not save: " + err.message;
      }
    });

    document.getElementById("sign-out").addEventListener("click", Q.api.forget);

    window.addEventListener("resize", U.debounce(drawCharts, 150));

    if (Q.api.isDemoMode) {
      document.getElementById("config-note").innerHTML =
        'Running in <strong>local demo mode</strong> — nothing is saved beyond this browser. ' +
        'Paste your Apps Script Web App URL into <code>API_URL</code> in <code>assets/api.js</code> ' +
        'to connect the Google Sheet.';
    }

    const boot = document.getElementById("boot-status");
    refresh()
      .then(function () {
        boot.textContent = "";
        loadRowsForDate(dateInput.value);
      })
      .catch(function (err) {
        boot.className = "status-line err";
        boot.textContent = "Could not load the ledger: " + err.message;
        renderRows([blankRow()]);
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window.Q);
