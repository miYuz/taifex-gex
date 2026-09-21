
const SVGNS = "http://www.w3.org/2000/svg";
const el = (n, a = {}) => {
  const e = document.createElementNS(SVGNS, n);
  for (const k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, a[k]);
  return e;
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v, n = 0) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : v.toFixed(n);
const fmtSigned = (v, n = 1) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (v > 0 ? "+" : "") + v.toFixed(n);

const N = DATA.d.length;
let view = { from: Math.max(0, N - 21), to: N };   // 預設近 1 個月,別讓第一眼就是看不出東西的長圖

const KEYS = ["d", "spot", "flip", "flip_dist", "gex", "regime", "expiry", "dte", "max_pain", "max_pain_dist"];
const slice = () => {
  const o = {};
  for (const k of KEYS) o[k] = DATA[k].slice(view.from, view.to);
  return o;
};

const YEARS = (() => {
  const m = new Map();
  DATA.d.forEach((iso, i) => {
    const y = iso.slice(0, 4);
    if (!m.has(y)) m.set(y, [i, i + 1]);
    else m.get(y)[1] = i + 1;
  });
  return m;
})();

const marginsFor = (W) => ({ l: 54, r: W < 560 ? 16 : 66 });

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

function dateTicks(dates, maxN) {
  const n = dates.length;
  const want = Math.max(2, Math.min(maxN, 7));
  const step = Math.max(1, Math.round(n / want));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}
function labelFor(iso, dense) { return dense ? iso.slice(5) : iso.slice(0, 7); }

/* ---------- 主圖:現貨 vs Gamma Flip ---------- */
const SERIES = [
  { key: "spot", name: "TAIEX 現貨", color: "--spot", short: "現貨", dash: false },
  { key: "flip", name: "Gamma Flip", color: "--flip", short: "Flip", dash: true, dashArr: "5 4" },
  { key: "max_pain", name: "Max Pain", color: "--key", short: "Max Pain", dash: true, dashArr: "2 3" },
];

function drawMain(host, S) {
  host.querySelectorAll("svg").forEach((n) => n.remove());
  const W = Math.max(320, host.clientWidth);
  const PLOT_H = W < 560 ? 220 : 300;
  const M = { t: 14, b: 26, ...marginsFor(W) };
  const H = PLOT_H + M.t + M.b;
  const iw = W - M.l - M.r, ih = PLOT_H;

  const vals = [];
  for (const s of SERIES) for (const v of S[s.key]) if (v !== null) vals.push(v);
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals);
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = Math.max(0, lo0 - pad), hi = hi0 + pad;

  const n = S.d.length;
  const X = (i) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v) => M.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          role: "img", "aria-label": "現貨與 Gamma Flip 時間序列" });

  for (const t of niceTicks(lo, hi, 5)) {
    svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t),
                                 stroke: css("--grid"), "stroke-width": 1 }));
    const tx = el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end",
                            fill: css("--muted"), "font-size": 11,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = t.toLocaleString();
    svg.appendChild(tx);
  }
  svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih,
                               stroke: css("--axis"), "stroke-width": 1 }));
  const dense = n <= 90;
  for (const i of dateTicks(S.d, Math.floor(iw / 74))) {
    const tx = el("text", { x: X(i), y: M.t + ih + 17, "text-anchor": "middle",
                            fill: css("--muted"), "font-size": 11,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = labelFor(S.d[i], dense);
    svg.appendChild(tx);
  }

  const ends = [];
  for (const s of SERIES) {
    let dpath = "", open = false, lastI = -1;
    S[s.key].forEach((v, i) => {
      if (v === null) { open = false; return; }
      dpath += (open ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " ";
      open = true; lastI = i;
    });
    svg.appendChild(el("path", { d: dpath, fill: "none", stroke: css(s.color),
                                 "stroke-width": s.dash ? 1.6 : 2, "stroke-linejoin": "round",
                                 "stroke-linecap": "round",
                                 "stroke-dasharray": s.dash ? (s.dashArr || "5 4") : null }));
    if (lastI >= 0) ends.push({ s, i: lastI, v: S[s.key][lastI], y: Y(S[s.key][lastI]) });
  }

  if (M.r > 34) {
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++)
      if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    for (const e of ends) {
      svg.appendChild(el("circle", { cx: X(e.i), cy: Y(e.v), r: 3.5,
                                     fill: css(e.s.color), stroke: css("--surface"),
                                     "stroke-width": 2 }));
      const tx = el("text", { x: M.l + iw + 8, y: e.y + 4, fill: css("--ink-2"),
                              "font-size": 11.5,
                              "font-family": "ui-monospace, Consolas, monospace" });
      tx.textContent = fmt(e.v, 0);
      svg.appendChild(tx);
    }
  }

  const cross = el("line", { y1: M.t, y2: M.t + ih, stroke: css("--axis"),
                             "stroke-width": 1, opacity: 0 });
  svg.appendChild(cross);
  const dots = SERIES.map((s) => ({
    el: svg.appendChild(el("circle", { r: 4, fill: css(s.color),
                                       stroke: css("--surface"), "stroke-width": 2, opacity: 0 })),
    get: (i) => S[s.key][i],
  }));

  host.appendChild(svg);
  return { svg, X, Y, M, iw, ih, n, W, cross, dots, host };
}

/* ---------- GEX 帶正負色的面積圖 ---------- */
function drawGex(host, S) {
  host.querySelectorAll("svg").forEach((n) => n.remove());
  const W = Math.max(320, host.clientWidth);
  const PLOT_H = W < 560 ? 140 : 180;
  const M = { t: 12, b: 26, ...marginsFor(W) };
  const H = PLOT_H + M.t + M.b;
  const iw = W - M.l - M.r, ih = PLOT_H;

  const gx = S.gex;
  const vals = gx.filter((v) => v !== null);
  const mx = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals))) * 1.1 || 1;
  const n = gx.length;
  const X = (i) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v) => M.t + ih / 2 - (v / mx) * (ih / 2);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          role: "img", "aria-label": "每日總 GEX" });

  for (const t of [mx * 0.6, -mx * 0.6]) {
    svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t),
                                 stroke: css("--grid"), "stroke-width": 1 }));
    const tx = el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end",
                            fill: css("--muted"), "font-size": 11,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = (t > 0 ? "+" : "") + t.toFixed(0);
    svg.appendChild(tx);
  }

  const segs = [];
  let cur = [];
  gx.forEach((v, i) => {
    if (v === null) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push([i, v]);
  });
  if (cur.length) segs.push(cur);

  const zero = Y(0);
  const areaPath = segs.map((seg) => {
    const head = `M${X(seg[0][0]).toFixed(1)} ${zero.toFixed(1)} `;
    const body = seg.map(([i, v]) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)} `).join("");
    const tail = `L${X(seg[seg.length - 1][0]).toFixed(1)} ${zero.toFixed(1)} Z `;
    return head + body + tail;
  }).join("");

  for (const [id, color, above] of [["clipGexPos", "--gex-pos", true], ["clipGexNeg", "--gex-neg", false]]) {
    const cp = el("clipPath", { id });
    cp.appendChild(el("rect", { x: M.l, y: above ? M.t : zero,
                                width: iw, height: above ? zero - M.t : M.t + ih - zero }));
    svg.appendChild(cp);
    if (areaPath) {
      svg.appendChild(el("path", { d: areaPath, fill: css(color), opacity: 0.55,
                                   "clip-path": `url(#${id})` }));
    }
  }

  svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: zero, y2: zero,
                               stroke: css("--axis"), "stroke-width": 1 }));
  const zl = el("text", { x: M.l - 8, y: zero + 4, "text-anchor": "end",
                          fill: css("--muted"), "font-size": 11,
                          "font-family": "ui-monospace, Consolas, monospace" });
  zl.textContent = "0";
  svg.appendChild(zl);

  const dense = n <= 90;
  for (const i of dateTicks(S.d, Math.floor(iw / 74))) {
    const tx = el("text", { x: X(i), y: M.t + ih + 17, "text-anchor": "middle",
                            fill: css("--muted"), "font-size": 11,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = labelFor(S.d[i], dense);
    svg.appendChild(tx);
  }

  const cross = el("line", { y1: M.t, y2: M.t + ih, stroke: css("--axis"),
                             "stroke-width": 1, opacity: 0 });
  svg.appendChild(cross);
  const dot = svg.appendChild(el("circle", { r: 4, fill: css("--ink-2"),
                                             stroke: css("--surface"), "stroke-width": 2, opacity: 0 }));

  host.appendChild(svg);
  return { svg, X, Y, M, iw, ih, n, W, cross, host, dots: [{ el: dot, get: (i) => gx[i] }] };
}

/* ---------- 卡片 ---------- */
function drawTiles(S) {
  const i = S.d.length - 1;
  const regime = S.regime[i];
  const items = [
    { k: "Gamma Flip", c: "--flip", v: S.flip[i], fmtN: 0,
      sub: `到期 ${S.expiry[i] ?? "—"} · dte ${S.dte[i] ?? "—"}` },
    { k: "現貨", c: "--spot", v: S.spot[i], fmtN: 0, sub: S.d[i] },
    { k: "距離(現貨-Flip)", c: null, v: S.flip_dist[i], fmtN: 0, signed: true,
      sub: S.flip_dist[i] === null ? "—" : (S.flip_dist[i] >= 0 ? "在煞車區之上" : "在油門區之下") },
    { k: "Max Pain", c: "--key", v: S.max_pain[i], fmtN: 0,
      sub: S.max_pain[i] === null || S.spot[i] === null ? "—" : `${fmtSigned(S.max_pain[i] - S.spot[i], 0)} 點(相對現貨)` },
    { k: "總 GEX(億)", c: regime === "positive" ? "--gex-pos" : "--gex-neg", v: S.gex[i],
      fmtN: 1, signed: true, sub: null, pill: regime },
  ];
  document.getElementById("tiles").innerHTML = items.map((it) => `
    <div class="tile">
      <div class="k">${it.c ? `<span class="swatch" style="background:var(${it.c})"></span>` : ""}${it.k}</div>
      <div class="v">${it.v === null || it.v === undefined ? "—" : (it.signed ? fmtSigned(it.v, it.fmtN) : it.v.toLocaleString(undefined, {maximumFractionDigits: it.fmtN}))}</div>
      <div class="sub">${
        it.pill
          ? `<span class="pill ${it.pill === "positive" ? "pos" : "neg"}"><span class="dot"></span>${it.pill === "positive" ? "正 GEX · 煞車" : "負 GEX · 油門"}</span>`
          : (it.sub ?? "")
      }</div>
    </div>`).join("");
}

function drawTable(S) {
  const rows = [];
  for (let i = S.d.length - 1; i >= 0 && rows.length < 15; i--) {
    const regime = S.regime[i];
    rows.push(`<tr>
      <td>${S.d[i]}</td>
      <td>${S.spot[i] === null ? '<span class="na">—</span>' : S.spot[i].toLocaleString()}</td>
      <td>${S.flip[i] === null ? '<span class="na">—</span>' : S.flip[i].toLocaleString()}</td>
      <td>${S.flip_dist[i] === null ? '<span class="na">—</span>' : fmtSigned(S.flip_dist[i], 0)}</td>
      <td>${S.max_pain[i] === null ? '<span class="na">—</span>' : S.max_pain[i].toLocaleString()}</td>
      <td>${S.gex[i] === null ? '<span class="na">—</span>' : fmtSigned(S.gex[i], 1)}</td>
      <td><span class="badge" style="color:var(${regime === "positive" ? "--gex-pos" : "--gex-neg"})">${regime === "positive" ? "正" : "負"}</span></td>
      <td>${S.expiry[i] ?? '<span class="na">—</span>'}</td>
      <td>${S.dte[i] ?? '<span class="na">—</span>'}</td>
    </tr>`);
  }
  document.getElementById("tbody").innerHTML = rows.join("");
  document.getElementById("recentCaption").textContent =
    `區間最後 ${rows.length} 個交易日(完整資料在 data/gex_txo_daily.csv)`;
}

/* ---------- 十字線 ---------- */
function tipHTML(S, i) {
  const regime = S.regime[i];
  return `<div class="date">${S.d[i]}</div>
    <div class="row"><span class="swatch" style="background:var(--spot)"></span>現貨 <b>${fmt(S.spot[i], 0)}</b></div>
    <div class="row"><span class="swatch" style="background:var(--flip)"></span>Flip <b>${fmt(S.flip[i], 0)}</b></div>
    <div class="row">距離 <b>${fmtSigned(S.flip_dist[i], 0)}</b></div>
    <div class="row"><span class="swatch" style="background:var(--key)"></span>Max Pain <b>${fmt(S.max_pain[i], 0)}</b></div>
    <div class="row" style="margin-top:4px">
      <span class="swatch" style="background:var(${regime === "positive" ? "--gex-pos" : "--gex-neg"})"></span>
      總GEX <b>${fmtSigned(S.gex[i], 1)} 億</b></div>
    <div class="mode">到期 ${S.expiry[i] ?? "—"} · dte ${S.dte[i] ?? "—"}</div>`;
}

function bindCrosshair(charts, S) {
  const live = charts.filter(Boolean);
  const tips = live.map((c) => c.host.querySelector(".tip"));

  const hide = () => {
    live.forEach((c, k) => {
      c.cross.setAttribute("opacity", 0);
      c.dots.forEach((d) => d.el.setAttribute("opacity", 0));
      if (tips[k]) tips[k].classList.remove("on");
    });
  };

  const show = (i, activeIdx) => {
    const html = tipHTML(S, i);
    live.forEach((c, k) => {
      const px = c.X(i);
      c.cross.setAttribute("x1", px);
      c.cross.setAttribute("x2", px);
      c.cross.setAttribute("opacity", 1);
      c.dots.forEach((d) => {
        const v = d.get(i);
        if (v === null || v === undefined) { d.el.setAttribute("opacity", 0); return; }
        d.el.setAttribute("cx", px);
        d.el.setAttribute("cy", c.Y(v));
        d.el.setAttribute("opacity", 1);
      });
      const tip = tips[k];
      if (!tip) return;
      if (k !== activeIdx) { tip.classList.remove("on"); return; }
      tip.innerHTML = html;
      tip.classList.add("on");
      const scale = c.host.clientWidth / c.W;
      const tw = tip.offsetWidth;
      const left = Math.max(tw / 2 + 2, Math.min(c.host.clientWidth - tw / 2 - 2, px * scale));
      tip.style.left = left + "px";
      tip.style.top = "6px";
    });
  };

  live.forEach((c, k) => {
    const idxFrom = (clientX) => {
      const r = c.svg.getBoundingClientRect();
      const x = (clientX - r.left) * (c.W / r.width);
      const t = (x - c.M.l) / c.iw;
      return Math.max(0, Math.min(c.n - 1, Math.round(t * (c.n - 1))));
    };
    c.svg.addEventListener("pointermove", (e) => show(idxFrom(e.clientX), k));
    c.svg.addEventListener("pointerdown", (e) => show(idxFrom(e.clientX), k));
    c.svg.addEventListener("pointerleave", hide);
  });
}

/* ---------- 今日快照:各履約價 GEX(比照原始文章左上圖)---------- */
function drawStrikeBar(host, S) {
  host.querySelectorAll("svg").forEach((n) => n.remove());
  const n = S.strike.length;
  if (!n) { host.innerHTML = '<p style="color:var(--muted);font-size:13px">最新一日算不出來。</p>'; return; }

  const W = Math.max(320, host.clientWidth);
  const PLOT_H = W < 560 ? 200 : 260;
  const M = { t: 12, b: 26, ...marginsFor(W) };
  const H = PLOT_H + M.t + M.b;
  const iw = W - M.l - M.r, ih = PLOT_H;

  const loK = Math.min(...S.strike), hiK = Math.max(...S.strike);
  const kPad = (hiK - loK) * 0.03 || 100;
  const X = (k) => M.l + ((k - (loK - kPad)) / ((hiK + kPad) - (loK - kPad))) * iw;

  const vals = S.strike_gex;
  const mx = Math.max(...vals.map(Math.abs)) * 1.15 || 1;
  const Y = (v) => M.t + ih / 2 - (v / mx) * (ih / 2);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          role: "img", "aria-label": "今日各履約價 GEX" });

  for (const t of [mx * 0.6, -mx * 0.6]) {
    svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t),
                                 stroke: css("--grid"), "stroke-width": 1 }));
    const tx = el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end",
                            fill: css("--muted"), "font-size": 10.5,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = (t > 0 ? "+" : "") + t.toFixed(1);
    svg.appendChild(tx);
  }
  const zero = Y(0);
  svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: zero, y2: zero,
                               stroke: css("--axis"), "stroke-width": 1 }));

  const avgGap = n > 1 ? (hiK - loK) / (n - 1) : 100;
  const pxPerUnit = iw / ((hiK + kPad) - (loK - kPad));
  const bw = Math.max(1.5, Math.min(14, avgGap * 0.7 * pxPerUnit));
  const posC = css("--gex-pos"), negC = css("--gex-neg");

  for (let i = 0; i < n; i++) {
    const v = vals[i], x = X(S.strike[i]);
    const y = v >= 0 ? Y(v) : zero;
    svg.appendChild(el("rect", { x: x - bw / 2, y, width: bw, height: Math.max(0.5, Math.abs(Y(v) - zero)),
                                fill: v >= 0 ? posC : negC }));
  }

  if (S.spot !== null) {
    svg.appendChild(el("line", { x1: X(S.spot), x2: X(S.spot), y1: M.t, y2: M.t + ih,
                                 stroke: css("--spot"), "stroke-width": 1.4 }));
  }
  if (S.flip !== null) {
    svg.appendChild(el("line", { x1: X(S.flip), x2: X(S.flip), y1: M.t, y2: M.t + ih,
                                 stroke: css("--flip"), "stroke-width": 1.4, "stroke-dasharray": "5 4" }));
  }
  if (S.max_pain !== null && S.max_pain !== undefined) {
    svg.appendChild(el("line", { x1: X(S.max_pain), x2: X(S.max_pain), y1: M.t, y2: M.t + ih,
                                 stroke: css("--key"), "stroke-width": 1.4, "stroke-dasharray": "2 3" }));
  }

  for (const k of niceTicks(loK - kPad, hiK + kPad, Math.floor(iw / 80))) {
    const tx = el("text", { x: X(k), y: M.t + ih + 17, "text-anchor": "middle",
                            fill: css("--muted"), "font-size": 10.5,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = k.toLocaleString();
    svg.appendChild(tx);
  }

  host.appendChild(svg);

  const tip = host.querySelector(".tip");
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = (clientX - r.left) * (W / r.width);
    const k = loK - kPad + ((x - M.l) / iw) * ((hiK + kPad) - (loK - kPad));
    let best = 0, bd = Infinity;
    S.strike.forEach((sk, i) => { const d = Math.abs(sk - k); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const show = (i) => {
    if (!tip) return;
    tip.innerHTML = `<div class="date">履約價 ${S.strike[i].toLocaleString()}</div>
      <div class="row"><span class="swatch" style="background:${vals[i] >= 0 ? posC : negC}"></span>
      GEX <b>${fmtSigned(vals[i], 3)} 億</b></div>`;
    tip.classList.add("on");
    const scale = host.clientWidth / W;
    const px = X(S.strike[i]);
    const tw = tip.offsetWidth;
    const left = Math.max(tw / 2 + 2, Math.min(host.clientWidth - tw / 2 - 2, px * scale));
    tip.style.left = left + "px";
    tip.style.top = "6px";
  };
  svg.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  svg.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
  svg.addEventListener("pointerleave", () => tip && tip.classList.remove("on"));
}

/* ---------- 今日快照:GEX vs 假設價位曲線(比照原始文章左下圖)---------- */
function drawCurve(host, S) {
  host.querySelectorAll("svg").forEach((n) => n.remove());
  const n = S.curve_x.length;
  if (!n) { host.innerHTML = '<p style="color:var(--muted);font-size:13px">最新一日算不出來。</p>'; return; }

  const W = Math.max(320, host.clientWidth);
  const PLOT_H = W < 560 ? 200 : 260;
  const M = { t: 12, b: 26, ...marginsFor(W) };
  const H = PLOT_H + M.t + M.b;
  const iw = W - M.l - M.r, ih = PLOT_H;

  const loK = Math.min(...S.curve_x), hiK = Math.max(...S.curve_x);
  const X = (k) => M.l + ((k - loK) / (hiK - loK)) * iw;
  const mx = Math.max(...S.curve_gex.map(Math.abs)) * 1.1 || 1;
  const Y = (v) => M.t + ih / 2 - (v / mx) * (ih / 2);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          role: "img", "aria-label": "GEX 對假設價位曲線" });

  for (const t of [mx * 0.6, 0, -mx * 0.6]) {
    svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t),
                                 stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }));
    const tx = el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end",
                            fill: css("--muted"), "font-size": 10.5,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = (t > 0 ? "+" : "") + t.toFixed(0);
    svg.appendChild(tx);
  }
  for (const k of niceTicks(loK, hiK, Math.floor(iw / 80))) {
    const tx = el("text", { x: X(k), y: M.t + ih + 17, "text-anchor": "middle",
                            fill: css("--muted"), "font-size": 10.5,
                            "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = k.toLocaleString();
    svg.appendChild(tx);
  }

  let dpath = "";
  S.curve_x.forEach((k, i) => { dpath += (i ? "L" : "M") + X(k).toFixed(1) + " " + Y(S.curve_gex[i]).toFixed(1) + " "; });
  svg.appendChild(el("path", { d: dpath, fill: "none", stroke: css("--gex-pos"),
                               "stroke-width": 2, "stroke-linejoin": "round" }));

  if (S.spot !== null) {
    svg.appendChild(el("line", { x1: X(S.spot), x2: X(S.spot), y1: M.t, y2: M.t + ih,
                                 stroke: css("--spot"), "stroke-width": 1.4 }));
  }
  if (S.flip !== null) {
    svg.appendChild(el("line", { x1: X(S.flip), x2: X(S.flip), y1: M.t, y2: M.t + ih,
                                 stroke: css("--flip"), "stroke-width": 1.4, "stroke-dasharray": "5 4" }));
    svg.appendChild(el("circle", { cx: X(S.flip), cy: Y(0), r: 4, fill: css("--flip"),
                                   stroke: css("--surface"), "stroke-width": 2 }));
  }
  // Max Pain 點位:垂直線 + 曲線上該價位對應的 GEX 值(線性內插),
  // 讓你看到「Max Pain 落在 GEX 曲線的哪一段」——在煞車區還是油門區。
  if (S.max_pain !== null && S.max_pain !== undefined && S.max_pain >= loK && S.max_pain <= hiK) {
    let j = 1;
    while (j < n - 1 && S.curve_x[j] < S.max_pain) j++;
    const x0 = S.curve_x[j - 1], x1 = S.curve_x[j];
    const g = S.curve_gex[j - 1] + (S.curve_gex[j] - S.curve_gex[j - 1]) * ((S.max_pain - x0) / (x1 - x0 || 1));
    svg.appendChild(el("line", { x1: X(S.max_pain), x2: X(S.max_pain), y1: M.t, y2: M.t + ih,
                                 stroke: css("--key"), "stroke-width": 1.4, "stroke-dasharray": "2 3" }));
    svg.appendChild(el("circle", { cx: X(S.max_pain), cy: Y(g), r: 4.5, fill: css("--key"),
                                   stroke: css("--surface"), "stroke-width": 2 }));
  }

  host.appendChild(svg);

  const tip = host.querySelector(".tip");
  const cross = el("line", { y1: M.t, y2: M.t + ih, stroke: css("--axis"), "stroke-width": 1, opacity: 0 });
  svg.insertBefore(cross, svg.firstChild.nextSibling);
  const idxFrom = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = (clientX - r.left) * (W / r.width);
    const k = loK + ((x - M.l) / iw) * (hiK - loK);
    const t = (k - loK) / (hiK - loK) * (n - 1);
    return Math.max(0, Math.min(n - 1, Math.round(t)));
  };
  const show = (i) => {
    const px = X(S.curve_x[i]);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", 1);
    if (!tip) return;
    tip.innerHTML = `<div class="date">假設價位 ${S.curve_x[i].toLocaleString(undefined,{maximumFractionDigits:0})}</div>
      <div class="row">總GEX <b>${fmtSigned(S.curve_gex[i], 2)} 億</b></div>`;
    tip.classList.add("on");
    const scale = host.clientWidth / W;
    const tw = tip.offsetWidth;
    const left = Math.max(tw / 2 + 2, Math.min(host.clientWidth - tw / 2 - 2, px * scale));
    tip.style.left = left + "px";
    tip.style.top = "6px";
  };
  svg.addEventListener("pointermove", (e) => show(idxFrom(e.clientX)));
  svg.addEventListener("pointerdown", (e) => show(idxFrom(e.clientX)));
  svg.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); if (tip) tip.classList.remove("on"); });
}

/* ---------- 今日快照:Max Pain 到期損益曲線 ---------- */
function drawPainCurve(host, S) {
  host.querySelectorAll("svg").forEach((n) => n.remove());
  const n = (S.pain_strike || []).length;
  if (!n) { host.insertAdjacentHTML("afterbegin", '<p style="color:var(--muted);font-size:13px">最新一日算不出 Max Pain。</p>'); return; }
  host.querySelectorAll("p").forEach((p) => p.remove());

  const W = Math.max(320, host.clientWidth);
  const PLOT_H = W < 560 ? 200 : 260;
  const M = { t: 12, b: 26, ...marginsFor(W) };
  const H = PLOT_H + M.t + M.b;
  const iw = W - M.l - M.r, ih = PLOT_H;

  const loK = Math.min(...S.pain_strike), hiK = Math.max(...S.pain_strike);
  const X = (k) => M.l + ((k - loK) / (hiK - loK)) * iw;
  const mx = Math.max(...S.pain_payout) * 1.08 || 1;
  const Y = (v) => M.t + ih - (v / mx) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H,
                          role: "img", "aria-label": "Max Pain 到期損益曲線" });

  for (const t of niceTicks(0, mx, 4)) {
    svg.appendChild(el("line", { x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t),
                                 stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }));
    const tx = el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end", fill: css("--muted"),
                            "font-size": 10.5, "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = t.toFixed(0);
    svg.appendChild(tx);
  }
  for (const k of niceTicks(loK, hiK, Math.floor(iw / 80))) {
    const tx = el("text", { x: X(k), y: M.t + ih + 17, "text-anchor": "middle", fill: css("--muted"),
                            "font-size": 10.5, "font-family": "ui-monospace, Consolas, monospace" });
    tx.textContent = k.toLocaleString();
    svg.appendChild(tx);
  }

  let dpath = "";
  S.pain_strike.forEach((k, i) => { dpath += (i ? "L" : "M") + X(k).toFixed(1) + " " + Y(S.pain_payout[i]).toFixed(1) + " "; });
  svg.appendChild(el("path", { d: dpath, fill: "none", stroke: css("--key"),
                               "stroke-width": 2, "stroke-linejoin": "round" }));

  if (S.spot !== null) {
    svg.appendChild(el("line", { x1: X(S.spot), x2: X(S.spot), y1: M.t, y2: M.t + ih,
                                 stroke: css("--spot"), "stroke-width": 1.4 }));
  }
  if (S.flip !== null) {
    svg.appendChild(el("line", { x1: X(S.flip), x2: X(S.flip), y1: M.t, y2: M.t + ih,
                                 stroke: css("--flip"), "stroke-width": 1.4, "stroke-dasharray": "5 4" }));
  }
  let minIdx = 0;
  S.pain_payout.forEach((v, i) => { if (v < S.pain_payout[minIdx]) minIdx = i; });
  const mpx = X(S.pain_strike[minIdx]), mpy = Y(S.pain_payout[minIdx]);
  svg.appendChild(el("line", { x1: mpx, x2: mpx, y1: M.t, y2: M.t + ih,
                               stroke: css("--key"), "stroke-width": 1.4, "stroke-dasharray": "2 3" }));
  svg.appendChild(el("circle", { cx: mpx, cy: mpy, r: 4.5, fill: css("--key"),
                                 stroke: css("--surface"), "stroke-width": 2 }));

  host.appendChild(svg);

  const tip = host.querySelector(".tip");
  const cross = el("line", { y1: M.t, y2: M.t + ih, stroke: css("--axis"), "stroke-width": 1, opacity: 0 });
  svg.insertBefore(cross, svg.firstChild.nextSibling);
  const idxFrom = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = (clientX - r.left) * (W / r.width);
    const k = loK + ((x - M.l) / iw) * (hiK - loK);
    let best = 0, bd = Infinity;
    S.pain_strike.forEach((sk, i) => { const d = Math.abs(sk - k); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const show = (i) => {
    const px = X(S.pain_strike[i]);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", 1);
    if (!tip) return;
    tip.innerHTML = `<div class="date">假設結算價 ${S.pain_strike[i].toLocaleString()}</div>
      <div class="row">買方損益總額 <b>${S.pain_payout[i].toFixed(1)} 億</b></div>`;
    tip.classList.add("on");
    const scale = host.clientWidth / W;
    const tw = tip.offsetWidth;
    const left = Math.max(tw / 2 + 2, Math.min(host.clientWidth - tw / 2 - 2, px * scale));
    tip.style.left = left + "px";
    tip.style.top = "6px";
  };
  svg.addEventListener("pointermove", (e) => show(idxFrom(e.clientX)));
  svg.addEventListener("pointerdown", (e) => show(idxFrom(e.clientX)));
  svg.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); if (tip) tip.classList.remove("on"); });
}

/* 右邊那張卡的分頁:GEX 曲線 / Max Pain 損益。隱藏中的容器寬度是 0,
   所以只畫「目前顯示中」的那一張,切換分頁時才畫另一張。 */
let rightTab = "curve";
function renderRight() {
  if (!SNAPSHOT) return;
  const isCurve = rightTab === "curve";
  document.getElementById("plotCurve").hidden = !isCurve;
  document.getElementById("plotPain").hidden = isCurve;
  document.getElementById("segCurve").setAttribute("aria-pressed", String(isCurve));
  document.getElementById("segPain").setAttribute("aria-pressed", String(!isCurve));
  document.getElementById("rightTitle").textContent = isCurve ? "GEX vs 假設價位曲線" : "Max Pain 到期損益曲線";
  document.getElementById("rightNote").textContent = isCurve
    ? "sticky-strike:重算不同假設現貨價,IV 固定不動"
    : "買方(call+put)到期內含價值總額,依假設結算價;最低點就是 Max Pain";
  if (isCurve) drawCurve(document.getElementById("plotCurve"), SNAPSHOT);
  else drawPainCurve(document.getElementById("plotPain"), SNAPSHOT);
}
document.getElementById("segCurve").addEventListener("click", () => { rightTab = "curve"; renderRight(); });
document.getElementById("segPain").addEventListener("click", () => { rightTab = "pain"; renderRight(); });

function renderSnapshot() {
  if (!SNAPSHOT) {
    document.getElementById("strikeNote").textContent = "最新一日快照算不出來";
    return;
  }
  document.getElementById("strikeNote").textContent =
    `${SNAPSHOT.date} · 到期 ${SNAPSHOT.expiry ?? "—"} · dte ${SNAPSHOT.dte ?? "—"} · 自動抓 GEX 有效範圍`;
  drawStrikeBar(document.getElementById("plotStrike"), SNAPSHOT);
  renderRight();
}

/* ---------- Call Wall / Put Wall 表(今日各履約價 GEX 排行)---------- */
function renderWalls() {
  const callBody = document.getElementById("callWallBody");
  const putBody = document.getElementById("putWallBody");
  if (!SNAPSHOT || !SNAPSHOT.strike.length) {
    const msg = '<tr><td colspan="4" class="na">最新一日算不出來</td></tr>';
    callBody.innerHTML = msg; putBody.innerHTML = msg;
    return;
  }
  const spot = SNAPSHOT.spot;
  const rows = SNAPSHOT.strike.map((k, idx) => ({ k, gex: SNAPSHOT.strike_gex[idx] }));

  const distCell = (k) => {
    if (spot === null || spot === undefined) return "—";
    const d = k - spot;
    return `${fmtSigned(d, 0)} (${fmtSigned(d / spot * 100, 1)}%)`;
  };

  // 先照 GEX 強度選出前 5 檔(排名保留在 rank),再照履約價排列顯示——兩邊都是
  // 「離現貨近的排最上面,往外遞增」:call 都在現貨之上所以由小到大,
  // put 都在現貨之下所以由大到小。
  const calls = rows.filter((r) => r.gex > 0).sort((a, b) => b.gex - a.gex).slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 })).sort((a, b) => a.k - b.k);
  callBody.innerHTML = calls.length
    ? calls.map((r) => `<tr>
        <td>${r.rank}</td><td>${r.k.toLocaleString()}</td>
        <td style="color:var(--gex-pos)">${fmtSigned(r.gex, 2)}</td><td>${distCell(r.k)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4" class="na">今天沒有正 GEX 履約價</td></tr>';

  const puts = rows.filter((r) => r.gex < 0).sort((a, b) => a.gex - b.gex).slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 })).sort((a, b) => b.k - a.k);
  putBody.innerHTML = puts.length
    ? puts.map((r) => `<tr>
        <td>${r.rank}</td><td>${r.k.toLocaleString()}</td>
        <td style="color:var(--gex-neg)">${fmtSigned(r.gex, 2)}</td><td>${distCell(r.k)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4" class="na">今天沒有負 GEX 履約價</td></tr>';
}

/* ---------- 主流程 ---------- */
function render() {
  const S = slice();
  document.getElementById("rangeNote").textContent =
    `${S.d[0]} ~ ${S.d[S.d.length - 1]}，${S.d.length} 個交易日`;
  drawTiles(S);
  const cMain = drawMain(document.getElementById("plotMain"), S);
  const cGex = drawGex(document.getElementById("plotGex"), S);
  bindCrosshair([cMain, cGex], S);
  drawTable(S);
}

const yearRow = document.getElementById("yearRow");
for (const [y, [a, b]] of YEARS) {
  const btn = document.createElement("button");
  btn.className = "range";
  btn.dataset.from = a;
  btn.dataset.to = b;
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = y;
  yearRow.appendChild(btn);
}

function selectButton(b) {
  document.querySelectorAll("button.range").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
  if (b.dataset.from !== undefined) {
    view.from = +b.dataset.from;
    view.to = +b.dataset.to;
  } else {
    const days = +b.dataset.days;
    view.from = days === 0 ? 0 : Math.max(0, N - days);
    view.to = N;
  }
  render();
}
document.querySelectorAll("button.range").forEach((b) => b.addEventListener("click", () => selectButton(b)));

let rt;
new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(render, 90); }).observe(document.getElementById("plotMain"));
let rts;
new ResizeObserver(() => { clearTimeout(rts); rts = setTimeout(renderSnapshot, 90); }).observe(document.getElementById("plotStrike"));

const rerenderAll = () => { render(); renderSnapshot(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerenderAll);
new MutationObserver(rerenderAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

render();
renderSnapshot();
renderWalls();
