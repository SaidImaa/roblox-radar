"""Client pour les API publiques de Roblox (aucune clé nécessaire).

Les endpoints explore-api sont ceux qu'utilise roblox.com/charts : ils ne sont pas
documentés officiellement et peuvent changer. Tout ce qui en dépend est ici.
"""
import time
import uuid
from collections import Counter
from urllib.parse import urlparse

import requests

EXPLORE_SORT_URL = "https://apis.roblox.com/explore-api/v1/get-sort-content"
GAMES_URL = "https://games.roblox.com/v1/games"
VOTES_URL = "https://games.roblox.com/v1/games/votes"
ICONS_URL = "https://thumbnails.roblox.com/v1/games/icons"
THUMBNAILS_URL = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails"
SEARCH_URL = "https://apis.roblox.com/search-api/omni-search"

_session = requests.Session()
_session.headers["User-Agent"] = "roblox-radar/1.0"
_session_id = str(uuid.uuid4())

RETRYABLE = {429, 500, 502, 503, 504}
MIN_INTERVAL = 0.35  # secondes entre deux requêtes, pour rester sous les limites de Roblox

# Les listes de découverte (classements, recherche) ne sont pas indispensables : appels courts,
# et un service qui échoue QUICK_STRIKES fois est mis en pause pour le reste du passage.
QUICK_STRIKES = 3

# Paquets de jeux qui n'ont pas pu être relevés pendant ce passage (le reste continue).
warnings = []
_last_request = 0.0
_strikes = Counter()


def _get(url, params, retries=6, quick=False):
    global _last_request
    host = urlparse(url).netloc
    if quick and _strikes[host] >= QUICK_STRIKES:
        raise RuntimeError(f"{host} en pause pour ce passage (trop d'échecs)")
    if quick:
        retries = 2
    error = None
    for attempt in range(retries):
        wait = MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        delay = 4 if quick else min(60, 3 * 2 ** attempt)
        try:
            r = _session.get(url, params=params, timeout=10 if quick else 20)
        except requests.RequestException as e:
            error = e
        else:
            if r.status_code == 200:
                return r.json()
            if r.status_code not in RETRYABLE:
                r.raise_for_status()
            error = RuntimeError(f"HTTP {r.status_code} sur {url}")
            # Roblox indique parfois combien de temps attendre avant de réessayer.
            retry_after = r.headers.get("Retry-After", "")
            if retry_after.isdigit() and not quick:
                delay = min(120, int(retry_after) + 1)
        if attempt < retries - 1:
            time.sleep(delay)
    if quick:
        _strikes[host] += 1
    raise error


def _chunks(items, size):
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _batched(url, ids, size, params=None):
    """Interroge `url` par paquets d'universeIds ; un paquet en échec est sauté, pas tout le passage."""
    for chunk in _chunks(ids, size):
        try:
            yield _get(url, {"universeIds": ",".join(map(str, chunk)), **(params or {})})
        except Exception as e:
            warnings.append(f"{len(chunk)} jeux non relevés ({url.split('/v1/')[-1]}) : {e}")


def get_sort(sort_id, country="all", device="all"):
    """Jeux d'un classement : universeId, name, playerCount, totalUpVotes, genreL1..."""
    data = _get(EXPLORE_SORT_URL, {
        "sessionId": _session_id,
        "sortId": sort_id,
        "device": device,
        "country": country,
    }, quick=True)
    return data.get("games") or []


def search_games(query, pages=4, min_players=0):
    """Jeux renvoyés par la recherche Roblox (paginée, non documentée elle aussi)."""
    out = []
    token = None
    for _ in range(pages):
        params = {"searchQuery": query, "sessionId": _session_id, "pageType": "all"}
        if token:
            params["pageToken"] = token
        data = _get(SEARCH_URL, params, quick=True)
        for group in data.get("searchResults", []):
            if group.get("contentGroupType") != "Game":
                continue
            out += [g for g in group.get("contents", []) if g.get("playerCount", 0) >= min_players]
        token = data.get("nextPageToken")
        if not token:
            break
    return out


def get_games(universe_ids):
    """Détails par universeId : playing, visits, created, creator, genre_l1/l2..."""
    wanted = set(universe_ids)
    out = {}
    for data in _batched(GAMES_URL, universe_ids, 50):
        # Roblox renvoie parfois une entrée vide (id 0) pour un jeu supprimé ou modéré.
        for g in data.get("data", []):
            if g.get("id") in wanted:
                out[g["id"]] = g
    return out


def get_votes(universe_ids):
    out = {}
    for data in _batched(VOTES_URL, universe_ids, 50):
        for v in data.get("data", []):
            out[v["id"]] = (v.get("upVotes", 0), v.get("downVotes", 0))
    return out


def get_icons(universe_ids):
    out = {}
    params = {"size": "512x512", "format": "Png", "isCircular": "false"}
    for data in _batched(ICONS_URL, universe_ids, 100, params):
        for item in data.get("data", []):
            if item.get("state") == "Completed":
                out[item["targetId"]] = item["imageUrl"]
    return out


def get_thumbnails(universe_ids, per_game=3):
    out = {}
    params = {"countPerUniverse": per_game, "defaults": "true", "size": "768x432", "format": "Png", "isCircular": "false"}
    for data in _batched(THUMBNAILS_URL, universe_ids, 25, params):
        for item in data.get("data", []):
            urls = [t["imageUrl"] for t in item.get("thumbnails", []) if t.get("state") == "Completed"]
            out[item["universeId"]] = urls
    return out
