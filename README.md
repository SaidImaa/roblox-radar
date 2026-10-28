# Roblox Radar

Repère en continu les jeux Roblox récents qui explosent (pics de joueurs, croissance sur 24 h)
et les classe en tiers S / A / B / C. 100 % gratuit : GitHub Actions + Supabase + Discord,
et un dashboard web publié sur GitHub Pages.

## Fonctionnement

Toutes les 30 minutes, `python -m collector` :

1. découvre les jeux par trois voies :
   - les classements mondiaux de roblox.com/charts (`up-and-coming`, `top-trending`, `top-playing-now`
     et les tendances par genre) ;
   - les versions par pays (12 pays) et par appareil (PC, téléphones, tablette, console)
     d'Up-and-Coming et Top Trending, où beaucoup de jeux percent d'abord ;
   - la recherche Roblox par mots-clés (jeux à 1 000+ joueurs), 10 mots-clés par passage en rotation,
     comme filet de sécurité : les classements s'arrêtent vers le 100e jeu. Roblox la refuse depuis
     les machines de GitHub (HTTP 429), elle n'est donc active qu'en local (`SEARCH_PER_RUN=0` dans le workflow) ;
2. garde tous les jeux d'**Up-and-Coming** (publiés il y a moins de 28 jours) et, ailleurs,
   seulement ceux de moins de 60 jours ;
3. relève joueurs, visites, favoris, likes, icône et captures, et enregistre un snapshot ;
4. calcule le pic, la croissance par rapport à la veille à la même heure, un score sur 100 et un tier ;
5. poste une alerte Discord quand un jeu passe en tier S ou A (10 au maximum par passage) ;
6. exporte les données (`python -m collector.export`) et republie le dashboard sur GitHub Pages.

| Tier | Règle (modifiable dans `collector/scoring.py`) |
|---|---|
| S | pic ≥ 50 000 joueurs atteint avant 14 jours |
| A | pic ≥ 20 000 atteint avant 28 jours |
| B | pic ≥ 10 000 avant 28 jours, ou ≥ 5 000 joueurs et x2 en 24 h |
| C | à surveiller |

Les autres réglages (classements, pays, appareils, mots-clés, âge maximum, alertes) sont dans `collector/config.py`
et peuvent être surchargés par variables d'environnement.

## Tester en local

```bash
pip install -r requirements.txt
python -m collector            # collecte -> data/radar.db (SQLite) sans DATABASE_URL
python -m collector.export     # écrit site/data/
python -m http.server 8000 --directory site
```

Puis ouvrir http://localhost:8000.

## Mise en ligne (une fois)

### 1. Supabase (base de données)
1. Créer un compte sur https://supabase.com puis un projet (offre Free). Noter le mot de passe de la base.
2. Bouton **Connect** en haut du projet → onglet **Connection string** → **Session pooler**.
   Copier l'URI `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`
   et remplacer `[YOUR-PASSWORD]` par le mot de passe.
   (Le pooler est nécessaire : les machines GitHub ne parlent qu'en IPv4.)
3. Rien d'autre à faire : les tables sont créées au premier passage.

### 2. Discord (alertes)
Sur ton serveur : Paramètres du salon → **Intégrations** → **Webhooks** → Nouveau webhook → **Copier l'URL**.

### 3. GitHub (collecte automatique et dashboard)
1. Créer un dépôt **public** (minutes GitHub Actions illimitées) et y pousser ce dossier.
2. **Settings → Secrets and variables → Actions → New repository secret** :
   - `DATABASE_URL` = l'URI Supabase de l'étape 1
   - `DISCORD_WEBHOOK_URL` = l'URL du webhook (facultatif)
3. **Settings → Pages → Build and deployment → Source : GitHub Actions**.
4. Onglet **Actions** → « Collecte Roblox » → **Run workflow** pour un premier passage immédiat.
   Ensuite il tourne tout seul toutes les 30 minutes.

Le dashboard est alors en ligne sur `https://<ton-pseudo>.github.io/<nom-du-depot>/`, mis à jour
à chaque collecte. Les secrets ne sont jamais visibles dans le dépôt public ; le dashboard, lui,
est public (il ne contient que des données publiques de Roblox).

## Le dashboard

Un site statique (HTML, CSS, JavaScript, sans framework) dans `site/` :

- **Radar** : la carte animée des jeux suivis (centre = les plus récents, taille = joueurs,
  couleur = tier, secteur = genre), le signal n°1, les chiffres clés, les explosions en cours,
  les derniers jeux détectés et les plus fortes hausses sur 24 h.
- **Tier list** : les jeux rangés en S / A / B / C ; survol = chiffres, clic = fiche.
- **Classement** : tableau triable par colonne, filtrable par tier, avec la courbe des 72 dernières heures.
- **Tendances** : les sous-genres qui attirent le plus de joueurs et les mots-clés qui reviennent
  dans les noms ; un clic filtre le classement.
- **Fiche jeu** : stats, courbes des joueurs (24 h / 7 j / 30 j) et des visites, détail du score,
  captures, description, lien Roblox. Chaque fiche a son lien (`#jeu-<id>`).

Recherche (touche `/`), âge, joueurs connectés (1 000+ par défaut) et genre filtrent toutes les pages. La page se met à jour
toute seule quand de nouvelles données sont publiées.

## À savoir

- L'historique commence au premier passage : la croissance sur 24 h apparaît au bout d'un jour.
- Les endpoints `explore-api` sont ceux de roblox.com/charts, non documentés : s'ils changent,
  seul `collector/roblox.py` est à adapter.
- GitHub peut décaler les tâches planifiées de quelques minutes, et les met en pause après
  60 jours sans activité sur le dépôt (un e-mail prévient ; il suffit de les réactiver).
- Supabase Free met en pause les projets inactifs pendant 7 jours ; la collecte toutes les
  30 minutes le maintient actif.
- Les snapshots de plus de 60 jours sont supprimés pour rester sous les 500 Mo gratuits.
