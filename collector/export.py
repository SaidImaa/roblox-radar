"""Exporte les données pour le dashboard statique : python -m collector.export [dossier]

Produit, dans site/data par défaut :
- games.json : tous les jeux suivis, avec leur courbe des 72 dernières heures ;
- h/<universe_id>.json : l'historique complet (30 jours) de chaque jeu, chargé à l'ouverture de sa fiche.
"""
import json
import os
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from . import config, scoring
from .db import Database, to_dt

HISTORY_DAYS = 30
TREND_HOURS = 72


def _iso(d):
    return d.astimezone(timezone.utc).isoformat(timespec="seconds") if d else None


def _round(x, n=4):
    return round(x, n) if x is not None else None


def _hourly(points, now):
    """Dernière valeur de chaque heure sur les TREND_HOURS dernières heures."""
    buckets = {}
    for ts, playing in points:
        hour = int((now - ts).total_seconds() // 3600)
        if hour < TREND_HOURS and playing is not None:
            buckets.setdefault(hour, playing)  # points triés du plus récent au plus ancien
    return [buckets[h] for h in sorted(buckets, reverse=True)]


def export(out_dir):
    now = datetime.now(timezone.utc)
    db = Database(config.DATABASE_URL)
    games = db.query("SELECT * FROM games WHERE tracking")
    ids = {g["universe_id"] for g in games}
    history = defaultdict(list)
    for r in db.query(
        "SELECT universe_id, ts, playing, visits FROM snapshots WHERE ts >= %s ORDER BY ts",
        (now - timedelta(days=HISTORY_DAYS),),
    ):
        if r["universe_id"] in ids:
            history[r["universe_id"]].append((to_dt(r["ts"]), r["playing"], r["visits"]))
    runs = db.query("SELECT * FROM runs ORDER BY ts DESC LIMIT 1")
    db.close()

    # Le dossier est entièrement régénéré : on ne supprime que notre propre dossier de données.
    if os.path.basename(os.path.normpath(out_dir)) == "data" and os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(os.path.join(out_dir, "h"), exist_ok=True)

    rows = []
    for g in games:
        uid = g["universe_id"]
        launched = to_dt(g["launched_at"])
        peak_at = to_dt(g["peak_ccu_at"])
        age = (now - launched).total_seconds() / 86400 if launched else None
        points = history.get(uid, [])
        components = scoring.score_components(g["peak_ccu"] or 0, age or 0, g["growth_24h"], g["like_ratio"])
        rows.append({
            "id": uid,
            "place": g["root_place_id"],
            "name": g["name"],
            "desc": (g["description"] or "")[:2000],
            "creator": g["creator_name"],
            "creatorType": g["creator_type"],
            "genre1": g["genre_l1"] or None,
            "genre2": g["genre_l2"] or None,
            "maxPlayers": g["max_players"],
            "created": _iso(to_dt(g["created_at"])),
            "launched": _iso(launched),
            "firstSeen": _iso(to_dt(g["first_seen_at"])),
            "peakAt": _iso(peak_at),
            "icon": g["icon_url"],
            "thumbs": json.loads(g["thumbnail_urls"]) if g["thumbnail_urls"] else [],
            "playing": g["playing"],
            "peak": g["peak_ccu"],
            "visits": g["visits"],
            "visits24": g["visits_24h"],
            "favorites": g["favorites"],
            "up": g["up_votes"],
            "down": g["down_votes"],
            "likes": _round(g["like_ratio"]),
            "growth": _round(g["growth_24h"], 3),
            "score": g["score"],
            "parts": {k: round(v, 1) for k, v in components.items()},
            "tier": g["tier"],
            "age": _round(age, 2),
            "ageAtPeak": _round((peak_at - launched).total_seconds() / 86400, 2) if peak_at and launched else None,
            "sources": json.loads(g["sources"]) if g["sources"] else [],
            "trend": _hourly([(ts, p) for ts, p, _ in reversed(points)], now),
        })
        with open(os.path.join(out_dir, "h", f"{uid}.json"), "w", encoding="utf-8") as f:
            json.dump({
                "t": [int(ts.timestamp()) for ts, _, _ in points],
                "p": [p for _, p, _ in points],
                "v": [v for _, _, v in points],
            }, f, separators=(",", ":"))

    last_run = None
    if runs:
        r = runs[0]
        last_run = {"ts": _iso(to_dt(r["ts"])), "discovered": r["discovered"], "tracked": r["tracked"],
                    "newGames": r["new_games"], "errors": r["errors"]}
    rows.sort(key=lambda g: g["score"] or 0, reverse=True)
    with open(os.path.join(out_dir, "games.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generatedAt": _iso(now),
            "lastRun": last_run,
            "rules": {
                "S": f"pic ≥ {scoring.S_MIN_PEAK:,} avant {scoring.S_MAX_AGE_DAYS} j".replace(",", " "),
                "A": f"pic ≥ {scoring.A_MIN_PEAK:,} avant {scoring.A_MAX_AGE_DAYS} j".replace(",", " "),
                "B": f"pic ≥ {scoring.B_MIN_PEAK:,} avant {scoring.B_MAX_AGE_DAYS} j, ou x{scoring.B_MIN_GROWTH:.0f} en 24 h".replace(",", " "),
                "C": "à surveiller",
            },
            "games": rows,
        }, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Export : {len(rows)} jeux -> {out_dir}")


if __name__ == "__main__":
    export(sys.argv[1] if len(sys.argv) > 1 else "site/data")
