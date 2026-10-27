// Radar — application : données, filtres, pages et fiche jeu.
import {
  $, $$, fmt, compact, esc, bg, ago, ageLabel, dateLabel, pct, growthHTML, tierChip,
  TIER_NAMES, genreOf, genreFr, sourceLabel, showTip, moveTip, hideTip, gameTip,
} from "./util.js";
import { sparkline, timeChart } from "./charts.js";
import { radarSVG } from "./radar.js";

const TABS = ["radar", "tiers", "classement", "tendances"];
const TIERS = ["S", "A", "B", "C"];
const DEFAULT_FILTERS = { q: "", age: 60, min: 0, genre: "" };
const REFRESH_MS = 5 * 60 * 1000;

const state = {
  data: null,
  byId: new Map(),
  tab: "radar",
  filters: { ...DEFAULT_FILTERS },
  sort: { key: "score", dir: -1 },
  tier: "",
  openId: null,
  history: null,
  range: 168,
};

const view = $("#view");
const drawer = $("#drawer");
const drawerBody = $("#drawer-body");

try {
  Object.assign(state.filters, JSON.parse(localStorage.getItem("radar.filters") || "{}"));
} catch { /* stockage indisponible : filtres par défaut */ }

// ---------------------------------------------------------------- données

// Mots trop génériques pour décrire un concept.
const STOPWORDS = new Set(("the a an of to in and or my your for on with be is it as at by from all find get vs you me can dont no up out " +
  "le la les de des du un une et upd update updated new beta alpha release released free ugc x2 x3 x5 2x 3x event game roblox v2 2 3 ii per simulator obby").split(" "));

function keywords(name) {
  const cleaned = (name || "").toLowerCase().replace(/[[({].*?[\])}]/g, " ");
  const singular = (t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  return new Set((cleaned.match(/\+1|[a-z0-9][a-z0-9']+/g) || []).map(singular).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

function prepare(data) {
  const now = Date.now();
  // Les jeux relevés dès le tout premier passage du radar ne sont pas des "découvertes".
  const bootstrap = Math.min(...data.games.map((g) => new Date(g.firstSeen).getTime()));
  for (const g of data.games) {
    const seen = new Date(g.firstSeen).getTime();
    g.genre = genreOf(g);
    g.kw = keywords(g.name);
    g.isNew = now - seen < 24 * 3600e3 && seen - bootstrap > 2 * 3600e3;
    g.search = `${g.name} ${g.creator || ""} ${g.genre} ${g.genre1 || ""}`.toLowerCase();
  }
  state.data = data;
  state.byId = new Map(data.games.map((g) => [g.id, g]));
}

async function load() {
  const res = await fetch(`data/games.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function filtered() {
  const { q, age, min, genre } = state.filters;
  const needle = q.trim().toLowerCase();
  return state.data.games.filter((g) =>
    (age >= 60 || (g.age ?? 999) <= age) &&
    (g.peak ?? 0) >= min &&
    (!genre || g.genre === genre) &&
    (!needle || g.search.includes(needle)));
}

// ---------------------------------------------------------------- composants

const openAttrs = (g) => `data-open="${g.id}" role="button" tabindex="0"`;
const thumb = (g) => g.thumbs?.[0] || g.icon;

function gameCard(g) {
  return `
    <div class="gcard" ${openAttrs(g)} style="--c:var(--t-${g.tier})">
      <div class="gcard-media" ${bg(thumb(g))}>${tierChip(g.tier, true)}<span class="age">${ageLabel(g.age)}</span></div>
      <div class="gcard-body"><div class="icon" ${bg(g.icon)}></div>
        <div><h3>${esc(g.name)}</h3><p>${esc(g.genre)} · ${esc(g.creator || "?")}</p></div>
      </div>
      <div class="gcard-stats">
        <div><b>${compact(g.playing)}</b><span class="label">joueurs · ${growthHTML(g.growth)}</span></div>
        ${sparkline(g.trend, { w: 110, h: 34 })}
      </div>
    </div>`;
}

function rowItem(g, right) {
  return `<li><button class="row-btn" data-open="${g.id}">
    <div class="icon" ${bg(g.icon)}></div>
    <div style="min-width:0">
      <div class="title">${esc(g.name)}</div>
      <div class="meta">${tierChip(g.tier)}<span>${esc(g.genre)}</span>${g.isNew ? '<span class="new-badge">nouveau</span>' : ""}</div>
    </div>
    <div class="right">${right}</div>
  </button></li>`;
}

const empty = (title, text) => `<div class="empty"><b>${title}</b><span>${text}</span></div>`;

function noResult() {
  return `<div class="state"><h1>Aucun jeu ne correspond</h1><p>Élargis l'âge, baisse le pic minimum ou efface la recherche.</p>
    <p><button class="btn" data-reset>Réinitialiser les filtres</button></p></div>`;
}

// ---------------------------------------------------------------- page Radar

function viewRadar(list) {
  if (!list.length) return noResult();
  const top = list[0];
  const count = (t) => list.filter((g) => g.tier === t).length;
  const hot = list.filter((g) => g.tier === "S" || g.tier === "A");
  const cards = hot.length ? hot : list.slice(0, 8);
  const recent = [...list].sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen)).slice(0, 6);
  const risers = list.filter((g) => g.growth != null).sort((a, b) => b.growth - a.growth).slice(0, 6);
  const players = list.reduce((n, g) => n + (g.playing || 0), 0);
  const fresh = list.filter((g) => g.isNew).length;

  return `
    <section class="hero">
      <div class="panel radar-panel">
        <div class="panel-head">
          <span class="label">Carte des signaux · ${fmt(list.length)} jeux</span>
          <div class="legend">${TIERS.map((t) => `<span style="--c:var(--t-${t})"><i></i>${TIER_NAMES[t]}</span>`).join("")}</div>
        </div>
        <div class="radar-wrap"><div class="radar-sweep"></div>${radarSVG(list)}</div>
        <p class="radar-hint">Centre = jeux les plus récents · taille = joueurs connectés · secteur = genre</p>
      </div>
      <div class="hero-side">
        <div class="intro">
          <span class="eyebrow">${fmt(list.length)} jeux sous surveillance</span>
          <h1>Les jeux Roblox qui <em>décollent</em>, repérés avant tout le monde.</h1>
        </div>
        <div class="featured" ${openAttrs(top)} style="--c:var(--t-${top.tier})">
          <div class="featured-bg" ${bg(thumb(top))}></div>
          <div class="featured-top"><span class="featured-tag"><b>Signal n°1</b> · score ${Math.round(top.score)}</span>${tierChip(top.tier, true)}</div>
          <div class="featured-body">
            <div class="icon" ${bg(top.icon)}></div>
            <div style="min-width:0"><h3>${esc(top.name)}</h3>
              <div class="featured-meta"><span>${esc(top.genre)}</span><span>·</span><span>sorti il y a ${ageLabel(top.age)}</span>${growthHTML(top.growth)}</div>
            </div>
            <div class="featured-stat"><b>${fmt(top.playing)}</b><span class="label">joueurs en ce moment</span></div>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi hot"><span class="label">Explosions</span><b>${count("S")}</b><span class="sub">tier S en cours</span></div>
          <div class="kpi"><span class="label">Décollages</span><b>${count("A")}</b><span class="sub">tier A en cours</span></div>
          <div class="kpi"><span class="label">Nouveaux signaux</span><b>${fresh}</b><span class="sub">repérés depuis 24 h</span></div>
          <div class="kpi"><span class="label">Joueurs</span><b>${compact(players)}</b><span class="sub">connectés sur les jeux suivis</span></div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div><h2>${hot.length ? "Explosions en cours" : "Meilleurs scores"}</h2>
          <p>${hot.length ? "Tiers S et A : plus de 20 000 joueurs simultanés en moins de 4 semaines." : "Aucun jeu S ou A avec ces filtres : voici les meilleurs scores."}</p></div>
        <a class="link" href="#tiers">Tier list complète <span>→</span></a>
      </div>
      <div class="cards-row">${cards.map(gameCard).join("")}</div>
    </section>

    <section class="two-col">
      <div class="panel panel-pad">
        <h2 class="panel-title">Derniers signaux détectés</h2>
        <p class="panel-sub">Les jeux que le radar vient d'ajouter à sa surveillance.</p>
        <ul class="list">${recent.map((g) => rowItem(g, `<b>${compact(g.playing)}</b><span class="muted" style="font-size:12px">${ago(g.firstSeen)}</span>`)).join("")}</ul>
      </div>
      <div class="panel panel-pad">
        <h2 class="panel-title">Plus fortes hausses sur 24 h</h2>
        <p class="panel-sub">Joueurs maintenant comparés à hier à la même heure.</p>
        ${risers.length
          ? `<ul class="list">${risers.map((g) => rowItem(g, `${growthHTML(g.growth)}<span class="muted" style="display:block;font-size:12px">${compact(g.playing)} joueurs</span>`)).join("")}</ul>`
          : empty("Bientôt disponible", "La comparaison avec la veille apparaît après 24 h de relevés.")}
      </div>
    </section>`;
}

// ---------------------------------------------------------------- page Tier list

function viewTiers(list) {
  if (!list.length) return noResult();
  const rules = state.data.rules || {};
  const lane = (t) => {
    const items = list.filter((g) => g.tier === t);
    const limit = t === "C" ? 39 : Infinity;
    const shown = items.slice(0, limit);
    const tiles = shown.map((g) => `
      <button class="tile" data-open="${g.id}" data-game-tip="${g.id}">
        <div class="tile-img" ${bg(g.icon)}>${g.isNew ? '<span class="new-badge">new</span>' : ""}</div>
        <div class="tile-name">${esc(g.name)}</div>
        <div class="tile-stat">${compact(g.playing)} · ${ageLabel(g.age)}</div>
      </button>`).join("");
    const more = items.length > shown.length
      ? `<button class="lane-more" data-goto="classement" data-tier="${t}">+${items.length - shown.length}<br>voir tout</button>` : "";
    return `
      <div class="lane lane-${t}">
        <div class="lane-head">
          <span class="lane-count">${items.length}</span>
          <span class="lane-letter">${t}</span>
          <div><div class="lane-name">${TIER_NAMES[t]}</div><div class="lane-rule">${esc(rules[t] || "")}</div></div>
        </div>
        <div class="lane-items">${tiles || '<span class="lane-empty">Aucun jeu dans ce tier pour l\'instant.</span>'}${more}</div>
      </div>`;
  };
  return `
    <div class="page-head"><div>
      <span class="label">Classement par chaleur</span>
      <h1>Tier list</h1>
      <p>Chaque jeu est placé selon le pic de joueurs qu'il a atteint et l'âge qu'il avait à ce moment-là. Survole une icône pour ses chiffres, clique pour sa fiche.</p>
    </div></div>
    <div class="lanes">${TIERS.map(lane).join("")}</div>`;
}

// ---------------------------------------------------------------- page Classement

const COLUMNS = [
  { key: "playing", label: "Joueurs" },
  { key: "peak", label: "Pic" },
  { key: "growth", label: "24 h" },
  { key: "trend", label: "72 h", sortable: false, cls: "hide-sm" },
  { key: "age", label: "Âge", dir: 1 },
  { key: "likes", label: "Likes", cls: "hide-sm" },
  { key: "visits24", label: "Visites 24 h", cls: "hide-sm" },
  { key: "score", label: "Score" },
];

function viewClassement(list) {
  const rows = (state.tier ? list.filter((g) => g.tier === state.tier) : list).slice();
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  });
  const head = COLUMNS.map((c) => {
    const sortable = c.sortable !== false;
    const sorted = sortable && key === c.key;
    return `<th class="${c.cls || ""} ${sortable ? "sortable" : ""} ${sorted ? "sorted" : ""}" ${sortable ? `data-sort="${c.key}"` : ""} ${sorted ? `data-dir="${dir < 0 ? "↓" : "↑"}"` : ""}>${c.label}</th>`;
  }).join("");
  const body = rows.map((g, i) => `
    <tr data-open="${g.id}">
      <td class="l pos">${String(i + 1).padStart(2, "0")}</td>
      <td class="l"><div class="game-cell"><div class="icon" ${bg(g.icon)}></div>
        <div><div class="game-name"><span>${esc(g.name)}</span>${g.isNew ? '<span class="new-badge">new</span>' : ""}</div>
        <div class="game-sub">${esc(g.genre)} · ${esc(g.creator || "?")}</div></div></div></td>
      <td>${tierChip(g.tier)}</td>
      <td><span class="num">${fmt(g.playing)}</span></td>
      <td><span class="num">${fmt(g.peak)}</span></td>
      <td>${growthHTML(g.growth)}</td>
      <td class="hide-sm">${sparkline(g.trend, { w: 104, h: 28 })}</td>
      <td><span class="num">${ageLabel(g.age)}</span></td>
      <td class="hide-sm"><span class="num">${pct(g.likes)}</span></td>
      <td class="hide-sm"><span class="num">${g.visits24 != null ? compact(g.visits24) : "—"}</span></td>
      <td><span class="scorebar"><i style="--w:${Math.round(g.score)}%"></i><span class="num">${Math.round(g.score)}</span></span></td>
    </tr>`).join("");
  const seg = ["", ...TIERS].map((t) => `<button data-tier-filter="${t}" class="${state.tier === t ? "on" : ""}">${t || "Tous"}</button>`).join("");

  return `
    <div class="page-head"><div>
      <span class="label">Tous les jeux suivis</span>
      <h1>Classement</h1>
      <p>Trie par colonne, filtre par tier, clique sur une ligne pour ouvrir la fiche complète.</p>
    </div></div>
    <div class="toolbar">
      <div class="seg"><span class="seg-label">Tier</span>${seg}</div>
      <span class="label">${fmt(rows.length)} jeux</span>
    </div>
    <div class="panel">${rows.length
      ? `<div class="table-wrap"><table class="rank"><thead><tr><th class="l">#</th><th class="l">Jeu</th><th>Tier</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : `<div class="panel-pad">${empty("Aucun jeu", "Aucun jeu ne correspond à ces filtres.")}</div>`}</div>`;
}

// ---------------------------------------------------------------- page Tendances

function viewTendances(list) {
  if (!list.length) return noResult();
  const total = list.reduce((n, g) => n + (g.playing || 0), 0) || 1;

  const byGenre = new Map();
  for (const g of list) {
    const e = byGenre.get(g.genre) || { name: g.genre, l1: g.genre1, games: [], players: 0, hot: 0 };
    e.games.push(g);
    e.players += g.playing || 0;
    e.hot += g.tier !== "C" ? 1 : 0;
    byGenre.set(g.genre, e);
  }
  const genres = [...byGenre.values()].sort((a, b) => b.players - a.players);
  const maxG = genres[0]?.players || 1;

  const byKw = new Map();
  for (const g of list) {
    for (const k of g.kw) {
      const e = byKw.get(k) || { kw: k, games: [], players: 0, hot: 0 };
      e.games.push(g);
      e.players += g.playing || 0;
      e.hot += g.tier !== "C" ? 1 : 0;
      byKw.set(k, e);
    }
  }
  const kws = [...byKw.values()].filter((k) => k.games.length >= 2).sort((a, b) => b.players - a.players).slice(0, 32);
  const maxK = kws[0]?.players || 1;

  const topG = genres[0];
  const hotG = [...genres].sort((a, b) => b.hot - a.hot || b.players - a.players)[0];
  const topK = kws[0];
  let insight = `Le sous-genre <strong>${esc(topG.name)}</strong> concentre <strong>${Math.round((topG.players / total) * 100)} %</strong> des joueurs des jeux affichés`;
  insight += hotG && hotG !== topG && hotG.hot > 1 ? `, et <strong>${esc(hotG.name)}</strong> aligne le plus de jeux chauds (${hotG.hot}).` : ".";
  if (topK) insight += ` Mot-clé qui revient le plus : <strong>« ${esc(topK.kw)} »</strong>, dans ${topK.games.length} jeux pour ${compact(topK.players)} joueurs.`;

  const genreRows = genres.slice(0, 12).map((e, i) => {
    const top3 = [...e.games].sort((a, b) => b.score - a.score).slice(0, 3);
    return `<li><button class="genre-row" data-genre="${esc(e.name)}">
      <span class="rk">${String(i + 1).padStart(2, "0")}</span>
      <div style="min-width:0">
        <div class="g-name">${esc(e.name)} <small>${esc(genreFr(e.l1))} · ${e.games.length} jeu${e.games.length > 1 ? "x" : ""}${e.hot ? ` · ${e.hot} chaud${e.hot > 1 ? "s" : ""}` : ""}</small></div>
        <div class="g-bar"><i style="--w:${Math.max(2, (e.players / maxG) * 100).toFixed(1)}%"></i></div>
      </div>
      <div class="g-right"><div class="stack">${top3.map((g) => `<span ${bg(g.icon)} title="${esc(g.name)}"></span>`).join("")}</div><b>${compact(e.players)}</b></div>
    </button></li>`;
  }).join("");

  const cloud = kws.map((k) => {
    const size = 13 + 12 * Math.sqrt(k.players / maxK);
    const names = k.games.slice(0, 4).map((g) => g.name).join(" · ");
    return `<button class="kw ${k.hot >= 2 ? "hot" : ""}" data-kw="${esc(k.kw)}" style="font-size:${size.toFixed(1)}px" title="${esc(names)}">${esc(k.kw)}<sup>${k.games.length}</sup></button>`;
  }).join("");

  return `
    <div class="page-head"><div>
      <span class="label">Concepts et styles</span>
      <h1>Tendances</h1>
      <p>Ce qui revient parmi les jeux qui montent. Un concept présent dans plusieurs jeux en même temps, c'est une vague à prendre.</p>
    </div></div>
    <div class="insight"><div class="insight-icon">✦</div><p>${insight}</p></div>
    <section class="trend-grid">
      <div class="panel panel-pad">
        <h2 class="panel-title">Sous-genres qui attirent</h2>
        <p class="panel-sub">Joueurs connectés cumulés · clique pour voir les jeux.</p>
        <ul class="genre-list">${genreRows}</ul>
      </div>
      <div class="panel panel-pad">
        <h2 class="panel-title">Mots-clés qui reviennent</h2>
        <p class="panel-sub">Présents dans au moins deux noms de jeux · taille = joueurs · <span style="color:var(--t-S)">●</span> = plusieurs jeux chauds.</p>
        ${kws.length ? `<div class="cloud">${cloud}</div>` : empty("Pas encore de motif", "Aucun mot n'apparaît dans plusieurs jeux avec ces filtres.")}
      </div>
    </section>`;
}

// ---------------------------------------------------------------- fiche jeu

const WHY = [
  ["size", "Taille du pic", 45, "Pic de joueurs simultanés (200 000 = maximum)"],
  ["freshness", "Fraîcheur", 25, "Plus le jeu est récent, plus il marque de points"],
  ["growth", "Croissance 24 h", 20, "Joueurs maintenant comparés à hier à la même heure"],
  ["quality", "Qualité (likes)", 10, "Pourcentage de votes positifs"],
];

function drawerHTML(g) {
  const url = `https://www.roblox.com/games/${g.place}`;
  const stat = (label, value, sub = "", cls = "") =>
    `<div class="stat"><span class="label">${label}</span><b>${value}</b>${sub ? `<span class="sub ${cls}">${sub}</span>` : ""}</div>`;
  const growthPct = g.growth != null ? `${g.growth >= 1 ? "+" : ""}${Math.round((g.growth - 1) * 100)} % vs hier` : "comparaison dans 24 h";
  const why = WHY.map(([k, label, max, hint]) => {
    const v = g.parts?.[k] ?? 0;
    return `<div class="why-row" title="${hint}"><span>${label}</span><div class="why-bar"><i style="--w:${((v / max) * 100).toFixed(0)}%"></i></div><b>${v.toFixed(0)} <small>/ ${max}</small></b></div>`;
  }).join("");
  return `
    <div class="d-hero" ${bg(thumb(g))}><button class="d-close" data-close aria-label="Fermer la fiche">✕</button></div>
    <div class="d-head">
      <div class="icon" ${bg(g.icon)}></div>
      <div style="min-width:0">
        <div class="d-tags">${tierChip(g.tier, true)}${g.isNew ? '<span class="new-badge">nouveau</span>' : ""}${g.genre1 ? `<span class="chip">${esc(g.genre1)}</span>` : ""}${g.genre2 ? `<span class="chip">${esc(g.genre2)}</span>` : ""}</div>
        <h2>${esc(g.name)}</h2>
        <div class="d-by">par <b>${esc(g.creator || "?")}</b> · sorti il y a ${ageLabel(g.age)}</div>
      </div>
    </div>
    <div class="d-actions">
      <a class="btn btn-signal" href="${url}" target="_blank" rel="noopener">Ouvrir sur Roblox ↗</a>
      <button class="btn" data-copy="${url}">Copier le lien</button>
    </div>
    <div class="d-section"><div class="stats">
      ${stat("Joueurs", fmt(g.playing), growthPct, g.growth > 1.05 ? "up" : "")}
      ${stat("Pic observé", fmt(g.peak), g.ageAtPeak != null ? `atteint à ${ageLabel(g.ageAtPeak)}` : "")}
      ${stat("Visites", compact(g.visits), g.visits24 != null ? `+${compact(g.visits24)} en 24 h` : "")}
      ${stat("Likes", pct(g.likes), g.up != null ? `${compact(g.up)} pour · ${compact(g.down)} contre` : "")}
      ${stat("Score", `${Math.round(g.score)}<span class="muted" style="font-size:13px"> /100</span>`, TIER_NAMES[g.tier])}
      ${stat("Favoris", compact(g.favorites))}
      ${stat("Âge", ageLabel(g.age), `sorti le ${dateLabel(g.launched)}`)}
      ${stat("Joueurs / serveur", fmt(g.maxPlayers))}
    </div></div>
    <div class="d-section">
      <h3>Joueurs simultanés
        <span class="mini-seg" id="range">${[[24, "24 h"], [168, "7 j"], [720, "30 j"]].map(([h, l]) => `<button data-range="${h}" class="${state.range === h ? "on" : ""}">${l}</button>`).join("")}</span>
      </h3>
      <div class="chart-box" id="chart-players"><div class="chart-empty">Chargement de l'historique…</div></div>
    </div>
    <div class="d-section"><h3>Nouvelles visites par heure</h3><div class="chart-box" id="chart-visits"><div class="chart-empty">Chargement…</div></div></div>
    <div class="d-section"><h3>Pourquoi ce score ? <span class="label">${Math.round(g.score)} / 100</span></h3><div class="why">${why}</div></div>
    ${g.thumbs?.length ? `<div class="d-section"><h3>Captures</h3><div class="gallery">${g.thumbs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener" ${bg(u)} aria-label="Capture d'écran"></a>`).join("")}</div></div>` : ""}
    <div class="d-section"><h3>Description</h3><p class="desc" id="desc">${esc(g.desc || "Pas de description.")}</p><button class="more-btn" id="more" hidden>Lire la suite</button></div>
    <div class="d-section"><h3>Repères</h3><div class="facts">
      <div class="fact"><span>Sorti le</span><b>${dateLabel(g.launched)}</b></div>
      <div class="fact"><span>Repéré par le radar</span><b>${dateLabel(g.firstSeen, true)}</b></div>
      <div class="fact"><span>Pic atteint le</span><b>${dateLabel(g.peakAt, true)}</b></div>
      <div class="fact"><span>Créateur</span><b>${esc(g.creator || "?")}${g.creatorType === "Group" ? " (groupe)" : ""}</b></div>
      <div class="fact" style="grid-column:1/-1"><span>Vu dans</span><b>${g.sources.map(sourceLabel).map(esc).join(" · ") || "—"}</b></div>
    </div></div>`;
}

function renderCharts() {
  const g = state.byId.get(state.openId);
  const h = state.history;
  const players = $("#chart-players");
  const visits = $("#chart-visits");
  if (!g || !players) return;
  if (!h) return;
  const since = Date.now() / 1000 - state.range * 3600;
  const pts = h.t.map((t, i) => ({ t, v: h.p[i] })).filter((p) => p.t >= since && p.v != null);
  const followed = ago(g.firstSeen).replace("il y a ", "");
  const wait = `<div class="chart-empty">Le radar suit ce jeu depuis ${followed}.<br>La courbe se dessine à chaque relevé, toutes les 30 minutes.</div>`;
  if (pts.length >= 2) timeChart(players, pts, { unit: "joueurs" });
  else players.innerHTML = wait;

  const vpts = [];
  for (let i = 1; i < h.t.length; i++) {
    const dt = (h.t[i] - h.t[i - 1]) / 3600;
    if (h.t[i] >= since && dt > 0 && h.v[i] != null && h.v[i - 1] != null) {
      vpts.push({ t: h.t[i], v: Math.max(0, (h.v[i] - h.v[i - 1]) / dt) });
    }
  }
  if (vpts.length >= 2) timeChart(visits, vpts, { kind: "bars", height: 180, unit: "visites / h", valueFmt: (v) => fmt(v) });
  else visits.innerHTML = wait;
}

async function openGame(id) {
  const g = state.byId.get(id);
  if (!g) { location.hash = state.tab; return; }
  const sameGame = state.openId === id && drawer.classList.contains("open");
  state.openId = id;
  if (!sameGame) {
    state.history = null;
    drawerBody.innerHTML = drawerHTML(g);
    drawer.querySelector(".drawer-panel").scrollTop = 0;
    const desc = $("#desc");
    if (desc.scrollHeight > desc.clientHeight + 8) { desc.classList.add("clamped"); $("#more").hidden = false; }
  }
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("locked");
  hideTip();
  if (!sameGame) $(".d-close", drawer).focus({ preventScroll: true });
  try {
    const res = await fetch(`data/h/${id}.json`, { cache: "no-store" });
    if (state.openId !== id) return;
    state.history = res.ok ? await res.json() : { t: [], p: [], v: [] };
  } catch {
    state.history = { t: [], p: [], v: [] };
  }
  renderCharts();
}

function closeDrawer() {
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("locked");
  state.openId = null;
  hideTip();
}

// ---------------------------------------------------------------- rendu & navigation

function renderFilters() {
  const f = state.filters;
  $("#f-search").value !== f.q && ($("#f-search").value = f.q);
  $$("#f-age button").forEach((b) => b.classList.toggle("on", +b.dataset.v === f.age));
  $$("#f-min button").forEach((b) => b.classList.toggle("on", +b.dataset.v === f.min));
  $("#f-genre").value = f.genre;
  $("#f-reset").hidden = JSON.stringify(f) === JSON.stringify(DEFAULT_FILTERS);
  try { localStorage.setItem("radar.filters", JSON.stringify(f)); } catch { /* ignoré */ }
}

function fillGenres() {
  const counts = new Map();
  for (const g of state.data.games) counts.set(g.genre, (counts.get(g.genre) || 0) + 1);
  const opts = [...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `<option value="${esc(n)}">${esc(n)} (${c})</option>`);
  $("#f-genre").innerHTML = `<option value="">Tous les genres</option>${opts.join("")}`;
  if (state.filters.genre && !counts.has(state.filters.genre)) state.filters.genre = "";
}

function render({ animate = false } = {}) {
  if (!state.data) return;
  $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === state.tab));
  renderFilters();
  const list = filtered();
  const views = { radar: viewRadar, tiers: viewTiers, classement: viewClassement, tendances: viewTendances };
  view.classList.toggle("animate", animate);
  view.innerHTML = views[state.tab](list);
  document.title = `${{ radar: "Radar", tiers: "Tier list", classement: "Classement", tendances: "Tendances" }[state.tab]} · Radar Roblox`;
}

function updateLive() {
  const d = state.data;
  if (!d) return;
  const ts = d.lastRun?.ts || d.generatedAt;
  const minutes = (Date.now() - new Date(ts).getTime()) / 60000;
  const live = $("#live");
  live.classList.toggle("ok", minutes < 50);
  live.classList.toggle("stale", minutes >= 50);
  $("#live-text").innerHTML = minutes < 50 ? `<span class="live-word">En direct · </span>${ago(ts)}` : `<span class="live-word">Dernier relevé </span>${ago(ts)}`;
  $("#footer-gen").textContent = `Données générées le ${dateLabel(d.generatedAt, true)}`;
}

function route() {
  const hash = decodeURIComponent(location.hash.slice(1)) || "radar";
  const m = hash.match(/^jeu-(\d+)$/);
  if (m) {
    if (!view.dataset.ready) {
      view.dataset.ready = "1";
      render({ animate: true });
    }
    openGame(Number(m[1]));
    return;
  }
  closeDrawer();
  const tab = TABS.includes(hash) ? hash : "radar";
  if (tab !== state.tab || !view.dataset.ready) {
    state.tab = tab;
    view.dataset.ready = "1";
    render({ animate: true });
    window.scrollTo({ top: 0 });
  }
}

function setFilters(patch, { tab } = {}) {
  Object.assign(state.filters, patch);
  if (tab && tab !== state.tab) location.hash = tab;
  else render();
}

// ---------------------------------------------------------------- événements

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close]")) { location.hash = state.tab; return; }
  const copy = t.closest("[data-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
      copy.textContent = "Lien copié ✓";
      setTimeout(() => { copy.textContent = "Copier le lien"; }, 1600);
    });
    return;
  }
  const open = t.closest("[data-open]");
  if (open) { location.hash = `jeu-${open.dataset.open}`; return; }
  const sort = t.closest("[data-sort]");
  if (sort) {
    const key = sort.dataset.sort;
    const col = COLUMNS.find((c) => c.key === key);
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: col?.dir || -1 };
    render();
    return;
  }
  const tf = t.closest("[data-tier-filter]");
  if (tf) { state.tier = tf.dataset.tierFilter; render(); return; }
  const go = t.closest("[data-goto]");
  if (go) { state.tier = go.dataset.tier || ""; location.hash = go.dataset.goto; return; }
  const genre = t.closest("[data-genre]");
  if (genre) { state.tier = ""; setFilters({ genre: genre.dataset.genre }, { tab: "classement" }); return; }
  const kw = t.closest("[data-kw]");
  if (kw) { state.tier = ""; setFilters({ q: kw.dataset.kw }, { tab: "classement" }); return; }
  if (t.closest("[data-reset]") || t.closest("#f-reset")) { state.tier = ""; setFilters({ ...DEFAULT_FILTERS }); return; }
  const range = t.closest("[data-range]");
  if (range) {
    state.range = Number(range.dataset.range);
    $$("#range button").forEach((b) => b.classList.toggle("on", b === range));
    renderCharts();
    return;
  }
  if (t.closest("#more")) { $("#desc").classList.add("open"); $("#more").hidden = true; }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) { location.hash = state.tab; return; }
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("#f-search").focus(); return; }
  const open = e.target.closest?.("[data-open][role=button]");
  if (open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = `jeu-${open.dataset.open}`; }
});

// Infobulles des jeux (souris uniquement : au toucher, le clic ouvre directement la fiche).
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const el = e.target.closest?.("[data-game-tip]");
  if (!el) return;
  const g = state.byId.get(Number(el.dataset.gameTip));
  if (g) showTip(gameTip(g), e.clientX, e.clientY);
});
document.addEventListener("pointermove", (e) => {
  if (e.target.closest?.("[data-game-tip]")) moveTip(e.clientX, e.clientY);
});
document.addEventListener("pointerout", (e) => {
  const el = e.target.closest?.("[data-game-tip]");
  if (el && !el.contains(e.relatedTarget)) hideTip();
});

let searchTimer;
$("#f-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setFilters({ q: e.target.value }), 140);
});
$("#f-age").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setFilters({ age: Number(b.dataset.v) }); });
$("#f-min").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setFilters({ min: Number(b.dataset.v) }); });
$("#f-genre").addEventListener("change", (e) => setFilters({ genre: e.target.value }));
window.addEventListener("hashchange", route);

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.openId && state.history) renderCharts(); }, 120);
}).observe(drawer.querySelector(".drawer-panel"));

// ---------------------------------------------------------------- démarrage

function skeleton() {
  view.innerHTML = `
    <section class="hero"><div class="skeleton" style="aspect-ratio:1;max-height:640px"></div>
      <div class="hero-side"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:250px"></div><div class="skeleton" style="height:180px"></div></div></section>`;
}

async function start() {
  skeleton();
  try {
    prepare(await load());
  } catch {
    view.innerHTML = `<div class="state"><span class="label">Aucune donnée</span><h1>Le radar n'a encore rien relevé</h1>
      <p>Lance une collecte puis un export : <code>python -m collector</code> puis <code>python -m collector.export</code>, et recharge la page.</p></div>`;
    $("#live-text").textContent = "Hors ligne";
    return;
  }
  fillGenres();
  updateLive();
  route();
  setInterval(updateLive, 30000);
  setInterval(async () => {
    try {
      const data = await load();
      if (data.generatedAt !== state.data.generatedAt) {
        prepare(data);
        fillGenres();
        updateLive();
        render();
      }
    } catch { /* on réessaiera au prochain tour */ }
  }, REFRESH_MS);
}

start();
