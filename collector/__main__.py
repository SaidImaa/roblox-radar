"""Collecteur Roblox Radar. Lancer avec : python -m collector

À chaque passage :
1. découvre les jeux dans les classements Roblox (monde, pays, appareils) et la recherche ;
2. relève les stats de tous les jeux suivis et enregistre un snapshot ;
3. recalcule pic, croissance 24 h, score et tier ;
4. envoie une alerte Discord quand un jeu monte en tier S ou A.
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from . import config, discord, roblox, scoring
from .db import Database, to_dt


def log(msg=""):
    print(msg, flush=True)


def search_keywords(now):
    """Mots-clés de recherche de ce passage : la liste complète est couverte par rotation."""
    kws, n = config.SEARCH_KEYWORDS, config.SEARCH_PER_RUN
    if not kws or n <= 0:
        return []
    groups = -(-len(kws) // n)
    start = (int(now.timestamp() // 1800) % groups) * n
    return kws[start:start + n]


def discover(errors, now):
    """Classements (monde, pays, appareils) + recherche.
    Renvoie ({universe_id: {"sources": set, "trusted": bool}}, nombre de listes lues)."""
    world, regional, search = [], [], []
    for country in config.COUNTRIES:
        for sort_id in config.TRUSTED_NEW_SORTS + config.DISCOVERY_SORTS:
            label = sort_id if country == "all" else f"{sort_id}@{country}"
            world.append((label, sort_id in config.TRUSTED_NEW_SORTS, roblox.get_sort, (sort_id, country)))
    for sort_id in config.REGIONAL_SORTS:
        trusted = sort_id in config.TRUSTED_NEW_SORTS
        for country in config.REGIONAL_COUNTRIES:
            regional.append((f"{sort_id}@{country}", trusted, roblox.get_sort, (sort_id, country)))
        for device in config.DEVICES:
            regional.append((f"{sort_id}#{device}", trusted, roblox.get_sort, (sort_id, "all", device)))
    for kw in search_keywords(now):
        args = (kw, config.SEARCH_PAGES, config.SEARCH_MIN_PLAYERS)
        search.append((f"search:{kw}", False, roblox.search_games, args))

    seen = {}
    lists = 0
    started = time.monotonic()
    for stage, calls in (("Classements monde", world), ("Pays et appareils", regional), ("Recherche", search)):
        t0 = time.monotonic()
        ok = failed = skipped = 0
        for label, trusted, fetch, args in calls:
            if time.monotonic() - started > config.DISCOVERY_BUDGET_SECONDS:
                skipped += 1
                continue
            try:
                entries = fetch(*args)
            except Exception as e:
                failed += 1
                errors.append(f"{label} : {e}")
                continue
            ok += 1
            for entry in entries:
                # Emplacement publicitaire acheté : pas une tendance organique.
                if entry.get("isSponsored"):
                    continue
                info = seen.setdefault(entry["universeId"], {"sources": set(), "trusted": False})
                info["sources"].add(label)
                info["trusted"] |= trusted
        lists += ok
        extra = f", {failed} en échec" if failed else ""
        extra += f", {skipped} sautées (budget de temps)" if skipped else ""
        log(f"  {stage} : {ok}/{len(calls)} listes en {time.monotonic() - t0:.0f} s{extra}")
    return seen, lists


def snapshots_24h_ago(db, ids, now):
    """Snapshot le plus proche d'il y a 24 h (fenêtre 22-26 h) pour chaque jeu.
    Comparer à la même heure la veille évite de confondre croissance et cycle jour/nuit."""
    target = now - timedelta(hours=24)
    rows = db.query(
        "SELECT universe_id, ts, playing, visits FROM snapshots WHERE ts >= %s AND ts <= %s",
        (now - timedelta(hours=26), now - timedelta(hours=22)),
    )
    best = {}
    for r in rows:
        uid = r["universe_id"]
        if uid not in ids:
            continue
        dist = abs((to_dt(r["ts"]) - target).total_seconds())
        if uid not in best or dist < best[uid][0]:
            best[uid] = (dist, r)
    return {uid: r for uid, (_, r) in best.items()}


def build_row(uid, d, old, info, votes, past, media, now):
    created = to_dt(d.get("created")) or now
    launched = to_dt(old.get("launched_at"))
    if launched is None:
        launched = created
        # Place réutilisée : Roblox dit "publié il y a moins de 28 jours" alors que
        # la date de création est plus ancienne. On retient l'hypothèse prudente.
        if info and info["trusted"] and created < now - timedelta(days=28):
            launched = now - timedelta(days=28)
    age_days = max(0.0, (now - launched).total_seconds() / 86400)

    playing = d.get("playing") or 0
    peak = old.get("peak_ccu") or 0
    peak_at = to_dt(old.get("peak_ccu_at"))
    if peak_at is None or playing > peak:
        peak, peak_at = playing, now
    age_at_peak = max(0.0, (peak_at - launched).total_seconds() / 86400)

    up, down = votes.get(uid, (None, None))
    like_ratio = up / (up + down) if up is not None and up + down > 0 else None

    prev = past.get(uid)
    ccu_24h_ago = prev["playing"] if prev else None
    growth = playing / ccu_24h_ago if ccu_24h_ago else None
    visits_24h = d["visits"] - prev["visits"] if prev and prev["visits"] is not None else None

    sources = set(json.loads(old["sources"])) if old.get("sources") else set()
    if info:
        sources |= info["sources"]
    last_seen = now if info else to_dt(old.get("last_seen_in_sort_at"))
    recently_seen = last_seen is not None and now - last_seen <= timedelta(days=config.STOP_TRACKING_AFTER_DAYS)

    creator = d.get("creator") or {}
    row = {
        "universe_id": uid,
        "root_place_id": d.get("rootPlaceId"),
        "name": d.get("name"),
        "description": d.get("description"),
        "creator_id": creator.get("id"),
        "creator_name": creator.get("name"),
        "creator_type": creator.get("type"),
        "genre_l1": d.get("genre_l1"),
        "genre_l2": d.get("genre_l2"),
        "max_players": d.get("maxPlayers"),
        "created_at": created,
        "launched_at": launched,
        "updated_at": to_dt(d.get("updated")),
        "first_seen_at": to_dt(old.get("first_seen_at")) or now,
        "last_seen_in_sort_at": last_seen,
        "sources": json.dumps(sorted(sources)),
        "icon_url": media["icons"].get(uid, old.get("icon_url")),
        "thumbnail_urls": json.dumps(media["thumbs"][uid]) if uid in media["thumbs"] else old.get("thumbnail_urls"),
        "media_refreshed_at": now if uid in media["refreshed"] else to_dt(old.get("media_refreshed_at")),
        "playing": playing,
        "visits": d.get("visits"),
        "favorites": d.get("favoritedCount"),
        "up_votes": up,
        "down_votes": down,
        "like_ratio": like_ratio,
        "peak_ccu": peak,
        "peak_ccu_at": peak_at,
        "ccu_24h_ago": ccu_24h_ago,
        "growth_24h": growth,
        "visits_24h": visits_24h,
        "score": scoring.compute_score(peak, age_days, growth, like_ratio),
        "tier": scoring.compute_tier(playing, peak, age_at_peak, age_days, growth),
        "alerted_tier": old.get("alerted_tier"),
        "tracking": age_days <= config.MAX_AGE_DAYS or recently_seen,
        "last_polled_at": now,
    }
    return row, age_days


def run():
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    errors = []

    if os.environ.get("GITHUB_ACTIONS") and not config.DATABASE_URL.startswith(("postgres://", "postgresql://")):
        sys.exit("Secret DATABASE_URL manquant : sans lui les données seraient perdues à la fin du job.")

    db = Database(config.DATABASE_URL)
    db.init_schema()

    # 1. Découverte
    seen, lists = discover(errors, now)
    log(f"Découverte : {len(seen)} jeux dans {lists} listes (classements monde, pays, appareils et recherche)")

    # 2. Relevé des stats
    known = {r["universe_id"]: r for r in db.query("SELECT * FROM games")}
    # Jeux déjà écartés car trop vieux : leur date de création ne change pas, inutile de les redemander.
    ignored = {r["universe_id"] for r in db.query("SELECT universe_id FROM ignored")}
    poll_ids = {uid for uid, info in seen.items() if info["trusted"] or uid not in ignored}
    poll_ids |= {uid for uid, r in known.items() if r["tracking"]}
    t0 = time.monotonic()
    details = roblox.get_games(poll_ids)
    log(f"Relevé : {len(details)}/{len(poll_ids)} jeux en {time.monotonic() - t0:.0f} s")
    if poll_ids and not details:
        errors.append("aucun jeu relevé : Roblox limite peut-être les requêtes, nouvel essai au prochain passage")

    games = {}
    too_old = []
    for uid, d in details.items():
        created = to_dt(d.get("created")) or now
        is_new = uid not in known
        # Un vieux jeu populaire (Brookhaven...) ne nous intéresse pas, sauf s'il sort d'up-and-coming.
        if is_new and not seen.get(uid, {}).get("trusted") and (now - created).days > config.MAX_AGE_DAYS:
            too_old.append((uid, created))
            continue
        games[uid] = d
    db.executemany(
        "INSERT INTO ignored (universe_id, created_at) VALUES (%s, %s) ON CONFLICT (universe_id) DO NOTHING",
        too_old,
    )
    new_ids = [uid for uid in games if uid not in known]
    log(f"Suivis : {len(games)} jeux (dont {len(new_ids)} nouveaux)")

    votes = roblox.get_votes(games)

    stale = [
        uid for uid in games
        if uid not in known
        or not known[uid]["media_refreshed_at"]
        or now - to_dt(known[uid]["media_refreshed_at"]) > timedelta(hours=config.MEDIA_REFRESH_HOURS)
    ]
    media = {"icons": {}, "thumbs": {}, "refreshed": set()}
    if stale:
        media["icons"] = roblox.get_icons(stale)
        media["thumbs"] = roblox.get_thumbnails(stale)
        # Un jeu dont les images n'ont pas pu être relevées sera retenté au prochain passage.
        media["refreshed"] = {uid for uid in stale if uid in media["icons"] and uid in media["thumbs"]}

    errors.extend(roblox.warnings)

    # 3. Snapshots, historique et score
    past = snapshots_24h_ago(db, set(games), now)
    db.executemany(
        "INSERT INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        [
            (uid, now, d.get("playing"), d.get("visits"), d.get("favoritedCount"), *votes.get(uid, (None, None)))
            for uid, d in games.items()
        ],
    )

    rows, candidates = [], []
    for uid, d in games.items():
        row, age_days = build_row(uid, d, known.get(uid, {}), seen.get(uid), votes, past, media, now)
        rows.append(row)
        if row["tier"] in config.ALERT_TIERS and scoring.is_upgrade(row["tier"], row["alerted_tier"]):
            candidates.append((row, age_days))

    # 4. Alertes : les meilleurs d'abord, le reste partira aux passages suivants.
    sent = 0
    if config.DISCORD_WEBHOOK_URL and candidates:
        candidates.sort(key=lambda c: c[0]["score"], reverse=True)
        batch = candidates[:config.MAX_ALERTS_PER_RUN]
        try:
            discord.send_alerts(config.DISCORD_WEBHOOK_URL, [{**row, "age_days": age} for row, age in batch])
            for row, _ in batch:
                row["alerted_tier"] = row["tier"]
            sent = len(batch)
        except Exception as e:
            errors.append(f"discord : {e}")

    db.upsert("games", "universe_id", rows)
    db.execute("DELETE FROM snapshots WHERE ts < %s", (now - timedelta(days=config.SNAPSHOT_RETENTION_DAYS),))
    db.execute(
        "INSERT INTO runs (ts, discovered, tracked, new_games, alerts, duration_s, errors) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (now, len(seen), len(games), len(new_ids), sent, round(time.monotonic() - started, 1),
         "\n".join(errors) or None),
    )
    db.commit()
    db.close()

    log(f"Alertes Discord : {sent} envoyées, {len(candidates) - sent} en attente")
    log("\nTop 15 (score) :")
    for r in sorted(rows, key=lambda r: r["score"], reverse=True)[:15]:
        growth = f"x{r['growth_24h']:.1f}" if r["growth_24h"] else "  - "
        log(f"  {r['tier']}  {r['score']:5.1f}  {r['playing']:>7} joueurs  pic {r['peak_ccu']:>7}  {growth:>5}  {r['name']}")
    for e in errors:
        log(f"ATTENTION {e}")
    if errors and not games:
        sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run()
