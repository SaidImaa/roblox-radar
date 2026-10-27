// Formatage, petits composants HTML et infobulle partagée.

const nf = new Intl.NumberFormat("fr-FR");

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const fmt = (n) => (n == null || Number.isNaN(n) ? "—" : nf.format(Math.round(n)));

export function compact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const short = (v, unit) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${unit}`;
  if (abs >= 1e9) return short(n / 1e9, "Md");
  if (abs >= 1e6) return short(n / 1e6, "M");
  if (abs >= 1e4) return short(n / 1e3, "k");
  return fmt(n);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const bg = (url) => (url ? `style="background-image:url('${esc(url)}')"` : "");

export function ago(iso) {
  if (!iso) return "—";
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${Math.round(min)} min`;
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
  return `il y a ${Math.round(min / 1440)} j`;
}

export function ageLabel(days) {
  if (days == null) return "—";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  return `${Math.round(days)} j`;
}

export const dateLabel = (iso, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "numeric", month: "long", year: withTime ? undefined : "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "—";

export const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)} %`);

export function growthHTML(g) {
  if (g == null) return `<span class="growth none" title="Disponible après 24 h de suivi">—</span>`;
  const p = (g - 1) * 100;
  const cls = p >= 5 ? "up" : p <= -5 ? "down" : "flat";
  const arrow = cls === "up" ? "↑" : cls === "down" ? "↓" : "→";
  const label = g >= 2 ? `x${g.toFixed(1).replace(".", ",")}` : `${p > 0 ? "+" : ""}${Math.round(p)} %`;
  return `<span class="growth ${cls}" title="Joueurs maintenant comparés à hier à la même heure">${arrow} ${label}</span>`;
}

export const TIER_NAMES = { S: "Explosion", A: "Décollage", B: "En montée", C: "Sous surveillance" };
export const tierChip = (t, withName = false) =>
  `<span class="tier tier-${t}">${t}${withName ? ` <small>${TIER_NAMES[t]}</small>` : ""}</span>`;

export const genreOf = (g) => g.genre2 || g.genre1 || "Non classé";

const GENRE_FR = {
  "Obby & Platformer": "Obby", "Roleplay & Avatar Sim": "Roleplay", Simulation: "Simulation",
  Action: "Action", Adventure: "Aventure", Survival: "Survie", Strategy: "Stratégie", Shooter: "Shooter",
  "Party & Casual": "Party", "Sports & Racing": "Sport & course", Entertainment: "Divertissement",
  Puzzle: "Puzzle", RPG: "RPG", Social: "Social", Education: "Éducation", Shopping: "Shopping",
  "Utility & Other": "Autres",
};
export const genreFr = (g) => GENRE_FR[g] || g || "Autres";

export function sourceLabel(s) {
  const [id, country] = s.split("@");
  const names = { "up-and-coming": "Up-and-Coming", "top-trending": "Top Trending", "top-playing-now": "Top Playing Now" };
  let label = names[id];
  if (!label && id.startsWith("trending-in-")) {
    label = "Tendance " + id.slice(12).replace(/-and-/g, " & ").replace(/-/g, " ");
  }
  return (label || id) + (country ? ` (${country.toUpperCase()})` : "");
}

// ---------- Infobulle ----------
const tip = document.getElementById("tooltip");

export function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add("show");
  moveTip(x, y);
}

export function moveTip(x, y) {
  const r = tip.getBoundingClientRect();
  let left = x + 16;
  let top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top + r.height > innerHeight - 8) top = y - r.height - 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

export const hideTip = () => tip.classList.remove("show");

export function gameTip(g) {
  return `
    <div class="tt-head"><div class="icon" ${bg(g.icon)}></div>
      <div><div class="tt-name">${esc(g.name)}</div><div style="margin-top:4px">${tierChip(g.tier, true)}</div></div>
    </div>
    <div class="tt-grid">
      <span>Joueurs</span><b>${fmt(g.playing)}</b>
      <span>Pic</span><b>${fmt(g.peak)}</b>
      <span>Âge</span><b>${ageLabel(g.age)}</b>
      <span>24 h</span><b>${growthHTML(g.growth)}</b>
    </div>`;
}
