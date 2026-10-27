// Graphiques SVG faits main : mini-courbes et courbes temporelles avec réticule.
import { compact, fmt, showTip, moveTip, hideTip } from "./util.js";

const SIGNAL = "#c6ff3d";
const DOWN = "#ff6b6b";
let uid = 0;

/** Mini-courbe : verte si le jeu monte sur la période, rouge s'il baisse. */
export function sparkline(values, { w = 120, h = 32 } = {}) {
  const pts = (values || []).filter((v) => v != null);
  if (pts.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <title>Courbe disponible après quelques relevés</title>
      <line x1="2" y1="${h / 2}" x2="${w - 2}" y2="${h / 2}" stroke="rgba(255,255,255,.14)" stroke-width="1.5" stroke-dasharray="2 4"/>
    </svg>`;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const pad = 3;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v) => (max === min ? h / 2 : pad + (1 - (v - min) / (max - min)) * (h - pad * 2));
  const color = pts[pts.length - 1] >= pts[0] ? SIGNAL : DOWN;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${h}L${x(0).toFixed(1)},${h}Z`;
  const lx = x(pts.length - 1);
  const ly = y(pts[pts.length - 1]);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${area}" fill="${color}" fill-opacity=".09"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.6" fill="${color}"/>
  </svg>`;
}

function niceStep(max, count) {
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Graduations horaires/journalières alignées sur l'heure locale. */
function timeTicks(t0, t1, maxTicks) {
  const span = t1 - t0;
  const steps = [1, 2, 3, 6, 12, 24, 48, 72, 168].map((h) => h * 3600);
  const step = steps.find((s) => span / s <= maxTicks) || steps[steps.length - 1];
  const hours = step / 3600;
  const d = new Date(t0 * 1000);
  d.setMinutes(0, 0, 0);
  if (hours >= 24) {
    if (d.getTime() / 1000 < t0 || d.getHours() !== 0) d.setHours(24, 0, 0, 0);
  } else {
    while (d.getTime() / 1000 < t0 || d.getHours() % hours) d.setHours(d.getHours() + 1);
  }
  const ticks = [];
  while (d.getTime() / 1000 <= t1 && ticks.length < 40) {
    const label = hours >= 24 || d.getHours() === 0
      ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : `${d.getHours()}h`;
    ticks.push({ t: d.getTime() / 1000, label });
    d.setHours(d.getHours() + hours);
  }
  return ticks;
}

const timeFmt = (t) =>
  new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Courbe (aire) ou histogramme dans `el`, sur des points {t (s), v}.
 * Survol : réticule + infobulle sur le point le plus proche.
 */
export function timeChart(el, pts, { kind = "area", height = 240, unit = "joueurs", valueFmt = fmt } = {}) {
  const W = Math.max(260, el.clientWidth - 24);
  const m = { l: 46, r: 12, t: 12, b: 26 };
  const pw = W - m.l - m.r;
  const ph = height - m.t - m.b;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(t1 - t0, 1);
  const vmax = Math.max(1, ...pts.map((p) => p.v));
  const step = niceStep(vmax, 4);
  const ymax = step * Math.ceil(vmax / step);
  const x = (t) => m.l + ((t - t0) / span) * pw;
  const y = (v) => m.t + ph - (v / ymax) * ph;
  const base = m.t + ph;
  const id = `ga${++uid}`;

  let grid = "";
  for (let v = 0; v <= ymax + 1e-9; v += step) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text x="${m.l - 10}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${compact(v)}</text>`;
  }
  const xt = timeTicks(t0, t1, Math.max(2, Math.floor(pw / 90)))
    .map((tk) => `<text x="${x(tk.t)}" y="${height - 6}" text-anchor="middle">${tk.label}</text>`)
    .join("");

  let marks;
  if (kind === "bars") {
    const bw = Math.max(1.5, Math.min(14, (pw / pts.length) * 0.7));
    marks = pts.map((p) => {
      const top = y(p.v);
      return `<rect x="${(x(p.t) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, base - top).toFixed(1)}" rx="${Math.min(3, bw / 2)}" fill="${SIGNAL}" fill-opacity=".75"/>`;
    }).join("");
  } else {
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    marks = `
      <path d="${line}L${x(t1).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${SIGNAL}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  el.innerHTML = `
    <svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="Évolution des ${unit}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${SIGNAL}" stop-opacity=".2"/><stop offset="1" stop-color="${SIGNAL}" stop-opacity="0"/>
      </linearGradient></defs>
      <g class="axis">${grid}${xt}</g>
      ${marks}
      <g class="hover" style="display:none">
        <line class="crosshair" y1="${m.t}" y2="${base}"/>
        <circle r="5" fill="${SIGNAL}" stroke="#0a0e15" stroke-width="2.5"/>
      </g>
      <rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>
    </svg>`;

  const svg = el.querySelector("svg");
  const hover = svg.querySelector(".hover");
  const cross = hover.querySelector("line");
  const dot = hover.querySelector("circle");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - m.l) / pw) * span;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t < t) lo = mid; else hi = mid;
    }
    const p = Math.abs(pts[lo].t - t) < Math.abs(pts[hi].t - t) ? pts[lo] : pts[hi];
    hover.style.display = "";
    cross.setAttribute("x1", x(p.t));
    cross.setAttribute("x2", x(p.t));
    dot.setAttribute("cx", x(p.t));
    dot.setAttribute("cy", y(p.v));
    const html = `<div class="tt-time">${timeFmt(p.t)}</div><div class="tt-value">${valueFmt(p.v)} <span class="muted" style="font:500 11px var(--font-body)">${unit}</span></div>`;
    if (document.getElementById("tooltip").classList.contains("show")) {
      document.getElementById("tooltip").innerHTML = html;
      moveTip(e.clientX, e.clientY);
    } else {
      showTip(html, e.clientX, e.clientY);
    }
  });
  svg.addEventListener("pointerleave", () => {
    hover.style.display = "none";
    hideTip();
  });
}
