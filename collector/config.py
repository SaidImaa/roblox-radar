"""Réglages du collecteur. Tout peut être surchargé par variable d'environnement."""
import os


def _list(name, default):
    raw = os.environ.get(name)
    return [x.strip() for x in raw.split(",") if x.strip()] if raw else default


# Supabase : URI "Session pooler" (postgresql://...). En local, une base SQLite suffit.
DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:///data/radar.db"
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")

# Classements de roblox.com/charts.
# "up-and-coming" = jeux publiés il y a moins de 28 jours, triés par croissance :
# on suit tout ce qui y apparaît, quel que soit l'âge du jeu.
TRUSTED_NEW_SORTS = _list("TRUSTED_NEW_SORTS", ["up-and-coming"])
# Les autres classements servent à la découverte, mais seuls les jeux jeunes sont gardés.
DISCOVERY_SORTS = _list("DISCOVERY_SORTS", [
    "top-trending",
    "top-playing-now",
    "trending-in-simulation",
    "trending-in-obby-and-platformer",
    "trending-in-roleplay-and-avatar-sim",
    "trending-in-action",
    "trending-in-survival",
    "trending-in-strategy",
    "trending-in-shooter",
    "trending-in-adventure",
    "trending-in-party-and-casual",
    "trending-in-sports-and-racing",
    "trending-in-entertainment",
    "trending-in-puzzle",
    "trending-in-rpg",
])
# "all" = monde entier : tous les classements ci-dessus sont lus dans leur version mondiale.
COUNTRIES = _list("COUNTRIES", ["all"])

# Beaucoup de jeux percent d'abord dans un pays ou sur un type d'appareil avant le classement mondial.
# Pour ceux-là, on lit aussi les versions par pays et par appareil de ces classements.
REGIONAL_SORTS = _list("REGIONAL_SORTS", ["up-and-coming", "top-trending"])
REGIONAL_COUNTRIES = _list("REGIONAL_COUNTRIES", ["us", "br", "ph", "id", "mx", "fr", "de", "gb", "tr", "th", "vn", "es"])
DEVICES = _list("DEVICES", ["computer", "high_end_phone", "low_end_phone", "high_end_tablet", "console"])

# Filet de sécurité : la recherche Roblox descend bien plus bas que les classements (~100 jeux).
# Chaque passage lance SEARCH_PER_RUN mots-clés et tourne sur la liste complète (un tour toutes les 2 h).
SEARCH_KEYWORDS = _list("SEARCH_KEYWORDS", [
    "simulator", "tycoon", "obby", "steal", "brainrot", "grow", "evolution", "+1", "escape", "horror",
    "anime", "fight", "rng", "tower", "survive", "pet", "egg", "car", "roleplay", "battle",
    "merge", "clicker", "hatch", "farm", "fish", "zombie", "ragdoll", "tsunami", "garden", "incremental",
    "hide", "run", "story", "prison", "school", "build", "craft", "defense", "pvp", "squid",
])
SEARCH_PER_RUN = int(os.environ.get("SEARCH_PER_RUN", 10))
SEARCH_PAGES = int(os.environ.get("SEARCH_PAGES", 4))
# La recherche renvoie énormément de petits jeux : on ne garde que ceux qui ont déjà des joueurs.
SEARCH_MIN_PLAYERS = int(os.environ.get("SEARCH_MIN_PLAYERS", 1000))

MAX_AGE_DAYS = int(os.environ.get("MAX_AGE_DAYS", 60))
# Un jeu trop vieux qui n'apparaît plus dans aucun classement depuis N jours n'est plus suivi.
STOP_TRACKING_AFTER_DAYS = int(os.environ.get("STOP_TRACKING_AFTER_DAYS", 3))
SNAPSHOT_RETENTION_DAYS = int(os.environ.get("SNAPSHOT_RETENTION_DAYS", 60))
# Les icônes et captures sont rafraîchies au plus une fois par jour.
MEDIA_REFRESH_HOURS = int(os.environ.get("MEDIA_REFRESH_HOURS", 24))

ALERT_TIERS = _list("ALERT_TIERS", ["S", "A"])
MAX_ALERTS_PER_RUN = int(os.environ.get("MAX_ALERTS_PER_RUN", 10))
