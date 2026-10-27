"""Score d'explosion (0-100) et tier S/A/B/C d'un jeu."""
import math

TIER_ORDER = ["S", "A", "B", "C"]

# Tier S : a dépassé 50k joueurs simultanés avant ses 14 jours.
S_MAX_AGE_DAYS, S_MIN_PEAK = 14, 50_000
# Tier A : a dépassé 20k avant ses 28 jours.
A_MAX_AGE_DAYS, A_MIN_PEAK = 28, 20_000
# Tier B : 10k avant 28 jours, ou au moins 5k joueurs et x2 en 24 h.
B_MAX_AGE_DAYS, B_MIN_PEAK = 28, 10_000
B_MIN_PLAYING, B_MIN_GROWTH = 5_000, 2.0

# Pic à partir duquel la composante "taille" du score est au maximum.
SCORE_PEAK_CAP = 200_000
SCORE_MAX_AGE_DAYS = 60


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score_components(peak, age_days, growth_24h, like_ratio):
    """Points obtenus sur chaque critère ; leur somme est le score sur 100."""
    size = _clamp(math.log10(max(peak, 1)) / math.log10(SCORE_PEAK_CAP))
    freshness = _clamp(1 - age_days / SCORE_MAX_AGE_DAYS)
    # x0.5 en 24 h -> 0, stable -> 0.33, x2 -> 0.67, x4 et plus -> 1.
    growth = 1 / 3 if growth_24h is None else _clamp((math.log2(max(growth_24h, 1e-3)) + 1) / 3)
    quality = 0.5 if like_ratio is None else _clamp((like_ratio - 0.60) / 0.35)
    return {"size": 45 * size, "freshness": 25 * freshness, "growth": 20 * growth, "quality": 10 * quality}


def compute_score(peak, age_days, growth_24h, like_ratio):
    return round(sum(score_components(peak, age_days, growth_24h, like_ratio).values()), 1)


def compute_tier(playing, peak, age_at_peak_days, age_days, growth_24h):
    """S et A dépendent de l'âge du jeu au moment de son pic : un jeu qui a fait
    60k à 10 jours reste S ensuite, c'est la preuve que le concept accroche."""
    if age_at_peak_days <= S_MAX_AGE_DAYS and peak >= S_MIN_PEAK:
        return "S"
    if age_at_peak_days <= A_MAX_AGE_DAYS and peak >= A_MIN_PEAK:
        return "A"
    if age_at_peak_days <= B_MAX_AGE_DAYS and peak >= B_MIN_PEAK:
        return "B"
    if playing >= B_MIN_PLAYING and (growth_24h or 0) >= B_MIN_GROWTH and age_days <= SCORE_MAX_AGE_DAYS:
        return "B"
    return "C"


def is_upgrade(new_tier, old_tier):
    if old_tier not in TIER_ORDER:
        return True
    return TIER_ORDER.index(new_tier) < TIER_ORDER.index(old_tier)
