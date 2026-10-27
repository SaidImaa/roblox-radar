"""Accès base de données : Postgres (Supabase) en production, SQLite en local.

Le SQL reste volontairement simple pour fonctionner sur les deux moteurs ;
les calculs (pics, croissance, score) sont faits en Python.
"""
import os
import sqlite3
from datetime import datetime, timezone

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS games (
        universe_id BIGINT PRIMARY KEY,
        root_place_id BIGINT,
        name TEXT,
        description TEXT,
        creator_id BIGINT,
        creator_name TEXT,
        creator_type TEXT,
        genre_l1 TEXT,
        genre_l2 TEXT,
        max_players INTEGER,
        created_at TIMESTAMPTZ,
        launched_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ,
        first_seen_at TIMESTAMPTZ,
        last_seen_in_sort_at TIMESTAMPTZ,
        sources TEXT,
        icon_url TEXT,
        thumbnail_urls TEXT,
        media_refreshed_at TIMESTAMPTZ,
        playing INTEGER,
        visits BIGINT,
        favorites BIGINT,
        up_votes BIGINT,
        down_votes BIGINT,
        like_ratio DOUBLE PRECISION,
        peak_ccu INTEGER,
        peak_ccu_at TIMESTAMPTZ,
        ccu_24h_ago INTEGER,
        growth_24h DOUBLE PRECISION,
        visits_24h BIGINT,
        score DOUBLE PRECISION,
        tier TEXT,
        alerted_tier TEXT,
        tracking BOOLEAN DEFAULT TRUE,
        last_polled_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS snapshots (
        universe_id BIGINT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        playing INTEGER,
        visits BIGINT,
        favorites BIGINT,
        up_votes BIGINT,
        down_votes BIGINT,
        PRIMARY KEY (universe_id, ts)
    )
    """,
    "CREATE INDEX IF NOT EXISTS snapshots_ts_idx ON snapshots (ts)",
    """
    CREATE TABLE IF NOT EXISTS runs (
        ts TIMESTAMPTZ PRIMARY KEY,
        discovered INTEGER,
        tracked INTEGER,
        new_games INTEGER,
        alerts INTEGER,
        duration_s DOUBLE PRECISION,
        errors TEXT
    )
    """,
]

# Sur Supabase, les tables du schéma public sont exposées par l'API REST :
# activer RLS (sans règle) bloque cet accès, le collecteur s'y connecte directement.
POSTGRES_ONLY = [
    "ALTER TABLE games ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE runs ENABLE ROW LEVEL SECURITY",
]


def _sqlite_ts(d):
    # Format fixe en UTC pour que les comparaisons de texte suivent l'ordre chronologique.
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")


sqlite3.register_adapter(datetime, _sqlite_ts)


def to_dt(value):
    """Normalise une date venant de la base ou de l'API Roblox en datetime UTC."""
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


class Database:
    def __init__(self, url):
        if url.startswith(("postgres://", "postgresql://")):
            import psycopg
            # prepare_threshold=None : compatible avec le pooler de Supabase.
            self.conn = psycopg.connect(url, prepare_threshold=None)
            self.kind = "postgres"
        else:
            path = url.removeprefix("sqlite:///")
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            self.conn = sqlite3.connect(path)
            self.kind = "sqlite"

    def _sql(self, sql):
        return sql.replace("%s", "?") if self.kind == "sqlite" else sql

    def execute(self, sql, params=()):
        cur = self.conn.cursor()
        cur.execute(self._sql(sql), params)
        return cur

    def executemany(self, sql, rows):
        if rows:
            self.conn.cursor().executemany(self._sql(sql), rows)

    def query(self, sql, params=()):
        cur = self.execute(sql, params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def init_schema(self):
        for stmt in SCHEMA:
            self.execute(stmt)
        if self.kind == "postgres":
            for stmt in POSTGRES_ONLY:
                self.execute(stmt)
        self.commit()

    def upsert(self, table, key, rows):
        """INSERT ... ON CONFLICT DO UPDATE sur la liste de dicts `rows` (mêmes clés)."""
        if not rows:
            return
        cols = list(rows[0])
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != key)
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
            f"ON CONFLICT ({key}) DO UPDATE SET {updates}"
        )
        self.executemany(sql, [tuple(r[c] for c in cols) for r in rows])

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()
