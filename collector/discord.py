"""Alertes Discord via webhook (gratuit, aucun bot à héberger)."""
import time

import requests

TIER_COLORS = {"S": 0xFF4D4F, "A": 0xFA8C16, "B": 0xFADB14, "C": 0x8C8C8C}


def _n(x):
    return f"{int(x):,}".replace(",", " ") if x is not None else "?"


def _embed(g):
    growth = f"x{g['growth_24h']:.1f}" if g.get("growth_24h") else "—"
    likes = f"{g['like_ratio'] * 100:.0f} %" if g.get("like_ratio") is not None else "—"
    genre = " / ".join(x for x in (g.get("genre_l1"), g.get("genre_l2")) if x) or "—"
    embed = {
        "title": f"[{g['tier']}] {g['name']}",
        "url": f"https://www.roblox.com/games/{g['root_place_id']}",
        "description": (g.get("description") or "")[:250],
        "color": TIER_COLORS.get(g["tier"], 0),
        "fields": [
            {"name": "Joueurs", "value": _n(g["playing"]), "inline": True},
            {"name": "Pic", "value": _n(g["peak_ccu"]), "inline": True},
            {"name": "Âge", "value": f"{g['age_days']:.0f} j", "inline": True},
            {"name": "Croissance 24 h", "value": growth, "inline": True},
            {"name": "Likes", "value": likes, "inline": True},
            {"name": "Score", "value": f"{g['score']:.0f}/100", "inline": True},
            {"name": "Genre", "value": genre, "inline": False},
        ],
        "footer": {"text": f"Roblox Radar · {g.get('creator_name') or ''}"},
    }
    if g.get("icon_url"):
        embed["thumbnail"] = {"url": g["icon_url"]}
    return embed


def send_alerts(webhook_url, games):
    """Envoie les jeux par paquets de 10 (limite d'embeds par message Discord)."""
    for i in range(0, len(games), 10):
        payload = {"username": "Roblox Radar", "embeds": [_embed(g) for g in games[i:i + 10]]}
        r = requests.post(webhook_url, json=payload, timeout=20)
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 2)))
            r = requests.post(webhook_url, json=payload, timeout=20)
        r.raise_for_status()
