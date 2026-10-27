// La carte radar : chaque jeu est un point.
// Distance au centre = âge (le centre, c'est "tout neuf"), secteur = genre,
// taille = joueurs connectés, couleur = tier. Le balayage fait "pinger" chaque point à son passage.
import { esc, genreFr } from "./util.js";

const SIZE = 600;
const C = SIZE / 2;
const R = 240; // doit correspondre au balayage CSS (.radar-sweep : 10 % -> 90 %)
const MAX_AGE = 60;
const RINGS = [3, 7, 14, 28, 60];
export const SWEEP_SECONDS = 8;

const rAge = (a) => R * Math.sqrt(Math.min(Math.max(a ?? MAX_AGE, 0.25), MAX_AGE) / MAX_AGE);
const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};

function rand(id, salt) {
  let h = 2166136261 ^ salt;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Secteurs par grand genre, largeur proportionnelle (adoucie) au nombre de jeux. */
function sectors(games) {
  const counts = new Map();
  for (const g of games) counts.set(g.genre1 || "Autres", (counts.get(g.genre1 || "Autres") || 0) + 1);
  let list = [...counts].sort((a, b) => b[1] - a[1]);
  if (list.length > 10) {
    const rest = list.slice(9).reduce((n, [, c]) => n + c, 0);
    list = [...list.slice(0, 9), ["Autres", rest]];
  }
  const weights = list.map(([, c]) => Math.max(c ** 0.55, 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let start = 0;
  const out = new Map();
  list.forEach(([name], i) => {
    const width = (weights[i] / total) * 360;
    out.set(name, { name, start, width });
    start += width;
  });
  return out;
}

export function radarSVG(games) {
  const secs = sectors(games);
  const sectorOf = (g) => secs.get(g.genre1 || "Autres") || secs.get("Autres") || [...secs.values()][0];

  let ticks = "";
  for (let d = 0; d < 360; d += 5) {
    const [x1, y1] = polar(d, R - (d % 30 === 0 ? 9 : 4));
    const [x2, y2] = polar(d, R);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(198,255,61,${d % 30 === 0 ? 0.4 : 0.18})"/>`;
  }

  const rings = RINGS.map((a) => `<circle class="radar-ring${a === MAX_AGE ? " outer" : ""}" cx="${C}" cy="${C}" r="${rAge(a)}"/>`).join("");
  const ringLabels = RINGS.slice(0, -1)
    .map((a) => `<text class="radar-ring-label" x="${C + 5}" y="${C - rAge(a) - 4}">${a} j</text>`)
    .join("");

  let spokes = "";
  let labels = "";
  if (secs.size > 1) {
    for (const s of secs.values()) {
      const [x, y] = polar(s.start, R);
      spokes += `<line class="radar-spoke" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`;
    }
  }
  for (const s of secs.values()) {
    const mid = s.start + s.width / 2;
    const [x, y] = polar(mid, R + 16);
    const sin = Math.sin((mid * Math.PI) / 180);
    const cos = Math.cos((mid * Math.PI) / 180);
    const anchor = sin > 0.25 ? "start" : sin < -0.25 ? "end" : "middle";
    const base = cos > 0.6 ? "auto" : cos < -0.6 ? "hanging" : "middle";
    labels += `<text class="radar-genre" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${base}">${esc(genreFr(s.name))}</text>`;
  }

  const blips = games
    .map((g) => {
      const s = sectorOf(g);
      const angle = s.start + (0.12 + 0.76 * rand(g.id, 1)) * s.width;
      const r = Math.min(R - 4, rAge(g.age) + (rand(g.id, 2) - 0.5) * 8);
      const size = Math.min(12, Math.max(2.4, 2.2 + 1.9 * (Math.log10(Math.max(g.playing || 0, 10)) - 1))) * (g.tier === "C" ? 0.8 : 1);
      const [x, y] = polar(angle, r);
      const delay = (angle / 360) * SWEEP_SECONDS - SWEEP_SECONDS;
      return { g, x, y, size, delay };
    })
    .sort((a, b) => b.size - a.size)
    .map(({ g, x, y, size, delay }) => `
      <g class="blip${g.tier === "C" ? " cold" : ""}" style="--c:var(--t-${g.tier});--delay:${delay.toFixed(2)}s" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"
         data-open="${g.id}" data-game-tip="${g.id}" tabindex="0" role="button" aria-label="${esc(g.name)}">
        ${g.tier === "S" || g.tier === "A" ? `<circle class="glow" r="${(size * 2).toFixed(1)}"/>` : ""}
        <circle class="halo" r="${size.toFixed(1)}"/>
        <circle class="dot" r="${size.toFixed(1)}"/>
      </g>`)
    .join("");

  return `
    <svg viewBox="0 0 ${SIZE} ${SIZE}" aria-label="Carte radar des jeux suivis">
      <defs>
        <radialGradient id="radar-fill"><stop offset="0" stop-color="#c6ff3d" stop-opacity=".07"/><stop offset="1" stop-color="#c6ff3d" stop-opacity="0"/></radialGradient>
      </defs>
      <circle cx="${C}" cy="${C}" r="${R}" fill="url(#radar-fill)"/>
      ${spokes}${rings}${ticks}
      <line x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}" stroke="rgba(198,255,61,.08)"/>
      <line x1="${C}" y1="${C - R}" x2="${C}" y2="${C + R}" stroke="rgba(198,255,61,.08)"/>
      ${ringLabels}${labels}
      <circle cx="${C}" cy="${C}" r="3" fill="#c6ff3d"/>
      ${blips}
    </svg>`;
}
