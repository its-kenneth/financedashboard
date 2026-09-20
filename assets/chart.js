/* ------------------------------------------------------------------
 * chart.js — a small dependency-free SVG line chart.
 *
 * Hand-rolled rather than pulled from a CDN for three reasons: the
 * ledger-paper look needs full control of stroke weights and type, a
 * chart library is ~60kB over the wire for one chart shape, and a
 * public page with no third-party script tags has a smaller blast
 * radius if that third party is ever compromised.
 *
 * Single series only, by design — the two dashboard charts live on
 * separate cards, so each is titled rather than legended, and neither
 * needs a categorical palette.
 * ---------------------------------------------------------------- */
window.Q = window.Q || {};

(function (Q) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PAD = { top: 22, right: 14, bottom: 24, left: 54 };

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) {
        node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  /** Human-friendly axis ticks covering [lo, hi] — 1/2/5 × 10^n steps. */
  function niceTicks(lo, hi, target) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / (target || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) {
      out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
  }

  /**
   * Renders a line chart into `container` (which must be position:relative).
   *
   * opts = {
   *   points:      [{ key, label, value }, ...]   // ordered oldest -> newest
   *   color:       "#1264a3"
   *   height:      180
   *   formatValue: fn(number) -> string           // tooltip + endpoint label
   *   formatTick:  fn(number) -> string           // y-axis ticks
   *   emptyText:   "No data yet."
   * }
   */
  function line(container, opts) {
    const points      = (opts.points || []).filter(p => isFinite(p.value));
    const color       = opts.color || "#1264a3";
    const height      = opts.height || 180;
    const formatValue = opts.formatValue || String;
    const formatTick  = opts.formatTick || formatValue;

    container.innerHTML = "";

    if (points.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.textContent = opts.emptyText || "Not enough history to chart yet.";
      container.appendChild(empty);
      return;
    }

    const width = Math.max(240, container.clientWidth || 320);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    /* ---------------------- scales ---------------------- */
    const values = points.map(p => p.value);
    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    let pad = (max - min) * 0.15;
    if (pad === 0) pad = Math.abs(max) * 0.1 || 1;
    let lo = min - pad;
    let hi = max + pad;
    if (min >= 0 && lo < 0) lo = 0;   // don't invent a negative axis

    const x = i => points.length === 1
      ? PAD.left + plotW / 2
      : PAD.left + (i / (points.length - 1)) * plotW;
    const y = v => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

    const svg = el("svg", {
      width: width, height: height,
      viewBox: "0 0 " + width + " " + height,
      class: "line-chart", tabindex: "0", role: "img",
      "aria-label": opts.ariaLabel || "Line chart"
    });

    /* --------------------- gridlines -------------------- */
    // Solid hairlines one shade off the surface — never dashed, which
    // would read as "threshold" rather than "grid".
    niceTicks(lo, hi, 4).forEach(function (t) {
      const ty = y(t);
      if (ty < PAD.top - 1 || ty > PAD.top + plotH + 1) return;
      svg.appendChild(el("line", {
        x1: PAD.left, x2: PAD.left + plotW, y1: ty, y2: ty, class: "grid-line"
      }));
      const label = el("text", {
        x: PAD.left - 8, y: ty + 3.5, class: "axis-text", "text-anchor": "end"
      });
      label.textContent = formatTick(t);
      svg.appendChild(label);
    });

    /* ------------------- area + line -------------------- */
    const linePath = points.map((p, i) => (i ? "L" : "M") + x(i) + " " + y(p.value)).join(" ");

    if (points.length > 1) {
      const baseY = PAD.top + plotH;
      svg.appendChild(el("path", {
        d: linePath + " L" + x(points.length - 1) + " " + baseY + " L" + x(0) + " " + baseY + " Z",
        fill: color, "fill-opacity": "0.10", stroke: "none"
      }));
    }

    svg.appendChild(el("path", {
      d: linePath, fill: "none", stroke: color, "stroke-width": "2",
      "stroke-linejoin": "round", "stroke-linecap": "round"
    }));

    /* --------------------- markers ---------------------- */
    // Every point when the series is short enough to stay legible;
    // otherwise only the endpoint, and hover fills in the rest.
    const showAll = points.length <= 14;
    points.forEach(function (p, i) {
      const last = i === points.length - 1;
      if (!showAll && !last) return;
      svg.appendChild(el("circle", {
        cx: x(i), cy: y(p.value), r: last ? 4.5 : 4,
        fill: color, stroke: "var(--paper)", "stroke-width": "2"
      }));
    });

    /* ------------- selective endpoint label ------------- */
    const lastI = points.length - 1;
    const lastX = x(lastI), lastY = y(points[lastI].value);
    const above = lastY - 15 > PAD.top;
    const endLabel = el("text", {
      x: Math.min(lastX, PAD.left + plotW),
      y: above ? lastY - 15 : lastY + 21,
      class: "endpoint-label",
      "text-anchor": lastX > PAD.left + plotW - 40 ? "end" : "middle"
    });
    endLabel.textContent = formatValue(points[lastI].value);
    svg.appendChild(endLabel);

    /* -------------------- x-axis labels ----------------- */
    // Thin the labels out rather than letting them collide.
    const maxLabels = Math.max(2, Math.floor(plotW / 42));
    const stride = Math.ceil(points.length / maxLabels);
    points.forEach(function (p, i) {
      if (i % stride !== 0 && i !== lastI) return;
      if (i !== lastI && lastI - i < stride * 0.6) return; // avoid crowding the last tick
      const t = el("text", {
        x: x(i), y: PAD.top + plotH + 16, class: "axis-text",
        "text-anchor": i === 0 && points.length > 1 ? "start"
                     : i === lastI && points.length > 1 ? "end" : "middle"
      });
      t.textContent = p.label;
      svg.appendChild(t);
    });

    /* ---------------- hover / focus layer --------------- */
    const crosshair = el("line", {
      y1: PAD.top, y2: PAD.top + plotH, class: "crosshair", visibility: "hidden"
    });
    const halo = el("circle", {
      r: 5.5, fill: color, stroke: "var(--paper)", "stroke-width": "2",
      visibility: "hidden"
    });
    svg.appendChild(crosshair);
    svg.appendChild(halo);

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("role", "status");
    container.appendChild(tip);

    let active = -1;

    function show(i) {
      if (i < 0 || i >= points.length) return;
      active = i;
      const px = x(i), py = y(points[i].value);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      halo.setAttribute("cx", px);
      halo.setAttribute("cy", py);
      halo.setAttribute("visibility", "visible");
      tip.innerHTML = '<span class="tip-label">' + Q.util.esc(points[i].full || points[i].label) +
                      '</span><span class="tip-value">' + Q.util.esc(formatValue(points[i].value)) + "</span>";
      tip.classList.add("show");
      // Keep the tooltip inside the card rather than letting it clip.
      const tw = tip.offsetWidth || 120;
      let left = px - tw / 2;
      left = Math.max(4, Math.min(left, width - tw - 4));
      tip.style.left = left + "px";
      tip.style.top = Math.max(0, py - tip.offsetHeight - 12) + "px";
    }

    function hide() {
      active = -1;
      crosshair.setAttribute("visibility", "hidden");
      halo.setAttribute("visibility", "hidden");
      tip.classList.remove("show");
    }

    function nearestIndex(clientX) {
      const rect = svg.getBoundingClientRect();
      const rel = (clientX - rect.left) * (width / rect.width);
      if (points.length === 1) return 0;
      const ratio = (rel - PAD.left) / plotW;
      return Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    }

    // One generous hit area over the whole plot beats per-point targets:
    // a 9px marker is impossible to land on with a thumb.
    const hit = el("rect", {
      x: PAD.left - 6, y: PAD.top - 6,
      width: plotW + 12, height: plotH + 12,
      fill: "transparent", style: "cursor:crosshair"
    });
    svg.appendChild(hit);

    hit.addEventListener("pointermove", e => show(nearestIndex(e.clientX)));
    hit.addEventListener("pointerdown", e => show(nearestIndex(e.clientX)));
    hit.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const start = active === -1 ? (e.key === "ArrowRight" ? -1 : points.length) : active;
        show(Math.max(0, Math.min(points.length - 1, start + (e.key === "ArrowRight" ? 1 : -1))));
      } else if (e.key === "Escape") {
        hide();
      }
    });

    container.appendChild(svg);
  }

  /**
   * The WCAG-clean twin of a chart: every plotted value as text.
   * Tooltips enhance, they never gate access to a number.
   */
  function table(points, formatValue) {
    if (!points || !points.length) return '<div class="empty">No data.</div>';
    const rows = points.map(p =>
      "<tr><th scope='row'>" + Q.util.esc(p.full || p.label) + "</th><td>" +
      Q.util.esc((formatValue || String)(p.value)) + "</td></tr>"
    ).join("");
    return "<table class='data-table'><tbody>" + rows + "</tbody></table>";
  }

  Q.chart = { line: line, table: table };
})(window.Q);
