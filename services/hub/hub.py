#!/usr/bin/env python3
"""
The coordinator hub — v1: registry + discovery + read-only overview.

Autonomous island peers + an OPTIONAL hub. Islands never depend on this; it only makes the
world richer. v1 does three things: it keeps a registry of islands (they self-register and
heartbeat), it serves that registry to the web (the spectator switcher / overview map), and it
serves a live overview page at /. Diplomacy, the mainland actor, military and the fugitive layer
are later phases (see docs/hub-design.md) — the map/relations/conflicts/mainland/events shapes
are already returned (empty) so the web contract is stable.

Stdlib only (http.server + sqlite3), matching fleet convention. Env:
  HUB_PORT     (default 4600)
  HUB_SECRET   shared secret; if set, POST writes require header  X-Hub: <secret>
  HUB_DB       sqlite path (default /data/hub.db)
  HUB_LIVE_SEC seconds since last heartbeat to still count an island "live" (default 360)
"""
import json, os, re, sqlite3, threading, time, html, random
import urllib.request, urllib.error
import concurrent.futures
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("HUB_PORT", "4600"))
SECRET = os.environ.get("HUB_SECRET", "")
ADMIN_TOKEN = os.environ.get("HUB_ADMIN_TOKEN", "")  # separate, stronger cred for /admin/* (game actions)
DB_PATH = os.environ.get("HUB_DB", "/data/hub.db")
SNAP_DIR = os.environ.get("HUB_SNAP_DIR", "/data/snaps")  # static island snapshots for the region map
LIVE_SEC = int(os.environ.get("HUB_LIVE_SEC", "360"))
STANCES = ("ally", "neutral", "rival", "enemy")
# Hostility is FRICTION, not a wall (docs/hub-design.md §8): even enemies leak — some cargo is
# smuggled through, some people still cross. A stance sets a default drag (0..1 = the share of
# crossings turned back / the volume lost); only an explicit `blockade` is a true hard stop.
STANCE_FRICTION = {"ally": 0.0, "neutral": 0.0, "rival": 0.35, "enemy": 0.7}

# ---- mainland-as-actor (docs/hub-design.md §12): a mood/pressure state machine that speaks
# through occasional edicts. This is FLAVOUR/INFLUENCE, never a command — islands read it and
# choose whether to honour it (exactly like a relation's friction). ----
MOODS = ("generous", "content", "neutral", "wary", "grasping", "hostile")
EDICT_TEMPLATES = (
    {"kind": "tariff", "text": "The crown raises duties on incoming trade.", "priceMultiplier": 0.85},
    {"kind": "grain", "text": "A call for grain: the mainland pays double for flour and bread.",
     "item": "bread", "priceMultiplier": 2.0},
    {"kind": "bounty", "text": "The crown posts a bounty on the region's known troublemakers.", "priceMultiplier": None},
)
MAINLAND_TICK_SEC = int(os.environ.get("HUB_MAINLAND_TICK_SEC", "120"))

_lock = threading.Lock()


def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS islands (
            id TEXT PRIMARY KEY, name TEXT, pack TEXT, url TEXT, harbors TEXT,
            last_seen REAL, day INTEGER, weather TEXT, population INTEGER,
            minted INTEGER, burned INTEGER, flour_shortage INTEGER,
            mayor TEXT, boat TEXT, map_x REAL, map_y REAL, size TEXT, updated_at REAL )""")
        icols = {r[1] for r in c.execute("PRAGMA table_info(islands)")}
        if "size" not in icols:
            c.execute("ALTER TABLE islands ADD COLUMN size TEXT")
        if "distress" not in icols:
            c.execute("ALTER TABLE islands ADD COLUMN distress INTEGER DEFAULT 0")
        c.execute("""CREATE TABLE IF NOT EXISTS relations (
            from_id TEXT, to_id TEXT, stance TEXT, friction REAL, blockade INTEGER,
            tariff REAL, updated_at REAL, PRIMARY KEY (from_id, to_id) )""")
        # migrate older dbs that had embargo/passengers_blocked instead of friction/blockade
        cols = {r[1] for r in c.execute("PRAGMA table_info(relations)")}
        if "friction" not in cols:
            c.execute("ALTER TABLE relations ADD COLUMN friction REAL DEFAULT 0")
        if "blockade" not in cols:
            c.execute("ALTER TABLE relations ADD COLUMN blockade INTEGER DEFAULT 0")
        # ---- mainland-as-actor (§12): one shared mood/pressure row + a table of edicts ----
        c.execute("""CREATE TABLE IF NOT EXISTS mainland_state (
            id TEXT PRIMARY KEY, mood TEXT, pressure REAL, updated_at REAL )""")
        c.execute("""CREATE TABLE IF NOT EXISTS mainland_edicts (
            id TEXT PRIMARY KEY, kind TEXT, text TEXT, item TEXT, price_multiplier REAL,
            source TEXT, created_at REAL, expires_at REAL, active INTEGER DEFAULT 1 )""")
        if not c.execute("SELECT 1 FROM mainland_state WHERE id='*'").fetchone():
            c.execute("INSERT INTO mainland_state (id,mood,pressure,updated_at) VALUES ('*','neutral',0.0,?)", (now(),))
        # ---- coordinated cross-island events (§11/§19 v4): region-wide happenings, hub-recorded ----
        c.execute("""CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, kind TEXT, islands TEXT, text TEXT, extra TEXT,
            created_at REAL, expires_at REAL, active INTEGER DEFAULT 1 )""")
        # ---- cross-island notoriety / fugitive tracking (§14): dossier + per-island reports ----
        c.execute("""CREATE TABLE IF NOT EXISTS people (
            id TEXT PRIMARY KEY, aliases TEXT, updated_at REAL )""")
        c.execute("""CREATE TABLE IF NOT EXISTS people_reports (
            rid INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT, island TEXT,
            notoriety REAL, fugitive INTEGER, note TEXT, at REAL )""")


def now():
    return time.time()


def island_row(r):
    live = r["last_seen"] is not None and (now() - r["last_seen"]) <= LIVE_SEC
    return {
        "id": r["id"], "name": r["name"], "pack": r["pack"], "url": r["url"],
        "harbors": json.loads(r["harbors"] or "[]"),
        "live": live, "lastSeen": r["last_seen"],
        "day": r["day"] or 0, "weather": r["weather"] or "unknown",
        "population": r["population"] or 0,
        "minted": r["minted"] or 0, "burned": r["burned"] or 0,
        "flourShortage": bool(r["flour_shortage"]),
        "distress": bool(r["distress"]) if "distress" in r.keys() else False,
        "mayor": r["mayor"],
        "boat": json.loads(r["boat"] or '{"running":false,"held":false}'),
        "size": json.loads(r["size"]) if r["size"] else None,
        "map": {"x": r["map_x"], "y": r["map_y"]} if r["map_x"] is not None else None,
    }


def all_islands():
    with db() as c:
        return [island_row(r) for r in c.execute("SELECT * FROM islands ORDER BY id")]


def upsert_island(b):
    with _lock, db() as c:
        c.execute("""INSERT INTO islands (id,name,pack,url,harbors,size,updated_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, pack=excluded.pack,
              url=excluded.url, harbors=excluded.harbors, size=excluded.size, updated_at=excluded.updated_at""",
            (b["id"], b.get("name", b["id"]), b.get("pack", ""), b.get("url", ""),
             json.dumps(b.get("harbors", [])), json.dumps(b.get("size")) if b.get("size") else None, now()))


def update_state(island_id, b):
    with _lock, db() as c:
        cur = c.execute("SELECT id FROM islands WHERE id=?", (island_id,)).fetchone()
        if not cur:  # a heartbeat can create the row too, so order of boot calls doesn't matter
            c.execute("INSERT INTO islands (id,name,harbors,updated_at) VALUES (?,?,?,?)",
                      (island_id, island_id, "[]", now()))
        c.execute("""UPDATE islands SET last_seen=?, day=?, weather=?, population=?,
              minted=?, burned=?, flour_shortage=?, distress=?, mayor=?, boat=?, updated_at=? WHERE id=?""",
            (now(), b.get("day", 0), b.get("weather", "unknown"), b.get("population", 0),
             b.get("minted", 0), b.get("burned", 0), 1 if b.get("flourShortage") else 0,
             1 if b.get("distress") else 0,
             b.get("mayor"), json.dumps(b.get("boat", {"running": False, "held": False})),
             now(), island_id))


def get_relation(frm, to):
    with db() as c:
        r = c.execute("SELECT * FROM relations WHERE from_id=? AND to_id=?", (frm, to)).fetchone()
    if not r:
        return {"stance": "neutral", "policy": {"friction": 0.0, "blockade": False, "tariff": 0.0}}
    return {"stance": r["stance"], "policy": {"friction": float(r["friction"] or 0.0),
            "blockade": bool(r["blockade"]), "tariff": float(r["tariff"] or 0.0)}}


def set_relation(frm, to, stance=None, friction=None, blockade=None, tariff=None):
    cur = get_relation(frm, to)  # start from whatever's there (or the neutral default) and layer changes
    st = stance if stance in STANCES else cur["stance"]
    # if the stance changed and no explicit friction was given, take the stance's default drag
    if friction is None:
        fr = STANCE_FRICTION[st] if (stance in STANCES and stance != cur["stance"]) else cur["policy"]["friction"]
    else:
        fr = max(0.0, min(1.0, float(friction)))
    bl = cur["policy"]["blockade"] if blockade is None else bool(blockade)
    tar = cur["policy"]["tariff"] if tariff is None else max(0.0, min(1.0, float(tariff)))
    with _lock, db() as c:
        c.execute("""INSERT INTO relations (from_id,to_id,stance,friction,blockade,tariff,updated_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(from_id,to_id) DO UPDATE SET stance=excluded.stance, friction=excluded.friction,
              blockade=excluded.blockade, tariff=excluded.tariff, updated_at=excluded.updated_at""",
            (frm, to, st, fr, 1 if bl else 0, tar, now()))
    return get_relation(frm, to)


def all_relations():
    with db() as c:
        rows = c.execute("SELECT * FROM relations ORDER BY from_id, to_id")
        return [{"from": r["from_id"], "to": r["to_id"], "stance": r["stance"],
                 "friction": float(r["friction"] or 0.0), "blockade": bool(r["blockade"]),
                 "tariff": float(r["tariff"] or 0.0)} for r in rows]


def world_map():
    # conflicts stay stable-but-empty until that later phase; mainland/events are now real.
    return {"islands": all_islands(), "relations": all_relations(), "conflicts": [],
            "mainland": get_mainland(), "events": [e for e in all_events(50) if e["active"]]}


# ---- mainland as an actor (§12): mood/pressure random-walk + occasional edicts. This is
# influence/friction only — nothing here reaches into an island; islands pull it and choose. ----
def _edict_row(r):
    return {"id": r["id"], "kind": r["kind"], "text": r["text"], "item": r["item"],
            "priceMultiplier": r["price_multiplier"], "source": r["source"],
            "createdAt": r["created_at"], "expiresAt": r["expires_at"]}


def get_mainland():
    t = now()
    with db() as c:
        row = c.execute("SELECT * FROM mainland_state WHERE id='*'").fetchone()
        edicts = [_edict_row(r) for r in c.execute(
            "SELECT * FROM mainland_edicts WHERE active=1 ORDER BY created_at DESC")
            if not r["expires_at"] or r["expires_at"] >= t]
    return {"mood": (row["mood"] if row else "neutral"),
            "pressure": float(row["pressure"] or 0.0) if row else 0.0,
            "updatedAt": row["updated_at"] if row else t,
            "edicts": edicts}


def set_mainland_mood(mood, pressure=None):
    with _lock, db() as c:
        row = c.execute("SELECT pressure FROM mainland_state WHERE id='*'").fetchone()
        pr = float(row["pressure"] or 0.0) if row and pressure is None else pressure
        pr = max(0.0, min(1.0, float(pr if pr is not None else 0.0)))
        c.execute("""INSERT INTO mainland_state (id,mood,pressure,updated_at) VALUES ('*',?,?,?)
            ON CONFLICT(id) DO UPDATE SET mood=excluded.mood, pressure=excluded.pressure, updated_at=excluded.updated_at""",
            (mood, pr, now()))
    return get_mainland()


def add_edict(kind, text, item=None, price_multiplier=None, ttl_sec=None, source="admin"):
    eid = f"med{int(now()*1000)}{random.randint(100,999)}"
    expires_at = (now() + float(ttl_sec)) if ttl_sec else None
    with _lock, db() as c:
        c.execute("""INSERT INTO mainland_edicts (id,kind,text,item,price_multiplier,source,created_at,expires_at,active)
            VALUES (?,?,?,?,?,?,?,?,1)""",
            (eid, kind, text, item, price_multiplier, source, now(), expires_at))
    return eid


def retire_edict(eid):
    with _lock, db() as c:
        c.execute("UPDATE mainland_edicts SET active=0 WHERE id=?", (eid,))


def _mainland_autoshift():
    with _lock, db() as c:
        row = c.execute("SELECT * FROM mainland_state WHERE id='*'").fetchone()
        idx = MOODS.index(row["mood"]) if row and row["mood"] in MOODS else 2
        pressure = float(row["pressure"] or 0.0) if row else 0.0
        idx = max(0, min(len(MOODS) - 1, idx + random.choice((-1, 0, 0, 0, 1))))
        pressure = max(0.0, min(1.0, pressure + random.uniform(-0.08, 0.08)))
        mood = MOODS[idx]
        c.execute("""INSERT INTO mainland_state (id,mood,pressure,updated_at) VALUES ('*',?,?,?)
            ON CONFLICT(id) DO UPDATE SET mood=excluded.mood, pressure=excluded.pressure, updated_at=excluded.updated_at""",
            (mood, pressure, now()))


def mainland_loop():
    # A slow, autonomous drift so the mainland occasionally speaks on its own, in addition to
    # anything an admin/game-master triggers directly. Never crashes the hub; best-effort only.
    while True:
        time.sleep(max(20, MAINLAND_TICK_SEC))
        try:
            _mainland_autoshift()
            if random.random() < 0.35:
                tpl = random.choice(EDICT_TEMPLATES)
                add_edict(tpl["kind"], tpl["text"], item=tpl.get("item"),
                          price_multiplier=tpl.get("priceMultiplier"),
                          ttl_sec=random.randint(600, 3600), source="mainland")
        except Exception:
            pass


# ---- coordinated cross-island events (§11 / v4 phase, brought forward): region-wide happenings
# the hub records and broadcasts. Purely additive — islands read /events/:id if they choose. ----
def _event_row(r):
    islands = "all" if r["islands"] == "all" else json.loads(r["islands"] or "[]")
    expired = bool(r["expires_at"]) and r["expires_at"] < now()
    return {"id": r["id"], "kind": r["kind"], "islands": islands, "text": r["text"],
            "extra": json.loads(r["extra"] or "{}"), "createdAt": r["created_at"],
            "expiresAt": r["expires_at"], "active": bool(r["active"]) and not expired}


def add_event(kind, islands, text, extra=None, ttl_sec=None):
    eid = f"ev{int(now()*1000)}{random.randint(100,999)}"
    islands_val = "all" if islands == "all" else json.dumps(list(islands or []))
    expires_at = (now() + float(ttl_sec)) if ttl_sec else None
    with _lock, db() as c:
        c.execute("""INSERT INTO events (id,kind,islands,text,extra,created_at,expires_at,active)
            VALUES (?,?,?,?,?,?,?,1)""", (eid, kind, islands_val, text, json.dumps(extra or {}), now(), expires_at))
        row = c.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
    return _event_row(row)


def all_events(limit=50):
    with db() as c:
        rows = c.execute("SELECT * FROM events ORDER BY created_at DESC LIMIT ?", (limit,))
        return [_event_row(r) for r in rows]


def active_events_for(island_id):
    return [e for e in all_events(200) if e["active"] and (e["islands"] == "all" or island_id in e["islands"])]


def retire_event(eid):
    with _lock, db() as c:
        c.execute("UPDATE events SET active=0 WHERE id=?", (eid,))


# ---- cross-island notoriety / fugitive tracking (§14, the provocateur trail). The hub only
# INGESTS what islands choose to report and AGGREGATES it — it never computes guilt itself. ----
def report_person(person_id, island, notoriety, fugitive, note, alias=None):
    with _lock, db() as c:
        row = c.execute("SELECT aliases FROM people WHERE id=?", (person_id,)).fetchone()
        aliases = json.loads(row["aliases"]) if row else []
        if alias and alias not in aliases:
            aliases.append(alias)
        if row:
            c.execute("UPDATE people SET aliases=?, updated_at=? WHERE id=?", (json.dumps(aliases), now(), person_id))
        else:
            c.execute("INSERT INTO people (id,aliases,updated_at) VALUES (?,?,?)", (person_id, json.dumps(aliases), now()))
        c.execute("""INSERT INTO people_reports (person_id,island,notoriety,fugitive,note,at) VALUES (?,?,?,?,?,?)""",
            (person_id, island, max(0.0, min(1.0, float(notoriety or 0.0))), 1 if fugitive else 0, note or "", now()))


def person_dossier(person_id):
    with db() as c:
        prow = c.execute("SELECT * FROM people WHERE id=?", (person_id,)).fetchone()
        reports = list(c.execute("SELECT * FROM people_reports WHERE person_id=? ORDER BY at ASC", (person_id,)))
    if not prow and not reports:
        return None
    trail = [{"island": r["island"], "at": r["at"], "notoriety": r["notoriety"],
              "fugitive": bool(r["fugitive"]), "note": r["note"]} for r in reports]
    latest_per_island = {}
    for r in reports:  # ordered ASC, so the last write per island wins = the latest report
        latest_per_island[r["island"]] = r
    return {"id": person_id, "aliases": json.loads(prow["aliases"]) if prow else [],
            "score": sum(r["notoriety"] or 0.0 for r in latest_per_island.values()),
            "fugitive": any(r["fugitive"] for r in latest_per_island.values()),
            "islandsVisited": list(latest_per_island.keys()), "trail": trail}


def all_notorious(limit=20):
    with db() as c:
        ids = [r["person_id"] for r in c.execute("SELECT DISTINCT person_id FROM people_reports")]
    people = sorted((p for p in (person_dossier(pid) for pid in ids) if p), key=lambda p: p["score"], reverse=True)
    return people[:limit]


# ---- the regional gazette: each island runs its own paper (GET {url}/api/papers/latest,
# see packages/protocol Paper shape: {edition,date,weather,lead:{headline,deck,body},briefs:[{headline,body}],...}).
# The hub just aggregates the latest edition from every island it knows about, cached briefly
# since papers only turn over about once a game-day and we don't want every page load fanning
# out N http calls to the islands. ----
GAZETTE_TTL = 120
_gazette_cache = {"data": None, "at": 0}
_gazette_lock = threading.Lock()


def _fetch_paper(url, timeout=5):
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/api/papers/latest",
            headers={"Accept": "application/json", "User-Agent": "uw-hub-gazette/1"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            raw = resp.read()
        data = json.loads(raw.decode("utf-8", "replace"))
        if not isinstance(data, dict) or not data.get("lead"):
            return None  # e.g. {"error":"the first edition prints at midnight"} — no paper yet
        return data
    except Exception:
        return None  # unreachable / 404 / timeout / bad json — skip this island gracefully


def build_gazette():
    islands = [i for i in all_islands() if i.get("url")]
    results = {}
    if islands:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(islands))) as ex:
            futs = {ex.submit(_fetch_paper, i["url"]): i["id"] for i in islands}
            for fut in concurrent.futures.as_completed(futs, timeout=30):
                iid = futs[fut]
                try:
                    results[iid] = fut.result()
                except Exception:
                    results[iid] = None
    editions = []
    for i in islands:
        data = results.get(i["id"])
        if not data:
            continue
        lead = data.get("lead") or {}
        briefs = [b.get("headline", "") for b in (data.get("briefs") or [])
                  if isinstance(b, dict) and b.get("headline")][:3]
        editions.append({
            "id": i["id"], "name": i.get("name") or i["id"],
            "date": data.get("date"), "weather": data.get("weather"),
            "headline": lead.get("headline"), "deck": lead.get("deck"),
            "briefs": briefs,
        })
    return {"editions": editions, "asOf": now()}


def get_gazette():
    with _gazette_lock:
        if _gazette_cache["data"] is None or (now() - _gazette_cache["at"]) >= GAZETTE_TTL:
            _gazette_cache["data"] = build_gazette()
            _gazette_cache["at"] = now()
        return _gazette_cache["data"]


# ---- the live overview / spectator switcher page ----
PAGE = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1"><title>The Archipelago</title>
<style>
:root{--sea:#a7c5ba;--seaDeep:#6f9a95;--ink:#12302b;--live:#2f9e6d;--ember:#E4572E}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{background:radial-gradient(150% 130% at 50% 28%,var(--sea) 0%,var(--seaDeep) 100%);color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
header{position:fixed;top:0;left:0;right:0;z-index:6;display:flex;align-items:baseline;gap:12px;padding:14px 18px;pointer-events:none;text-shadow:0 1px 3px rgba(255,255,255,.55)}
.eyebrow{letter-spacing:.2em;text-transform:uppercase;font-size:11px;font-weight:800;color:#0f3a34}
h1{font-size:20px;margin:0;font-weight:800}
.count{margin-left:auto;font-size:13px;pointer-events:auto}
#board{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.isle{position:absolute;cursor:pointer;transition:filter .15s,transform .15s}
.isle:hover{filter:drop-shadow(0 8px 22px rgba(20,45,40,.4));z-index:3}
/* show the WHOLE island + its full coastline; the island fills ~81% of its aspect-matched snapshot,
   so we keep everything solid to 84% and only feather the very outer sea margin into the region sea */
.isle img{width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none;
  -webkit-mask-image:radial-gradient(ellipse 100% 100% at 50% 50%,#000 84%,transparent 99%);
  mask-image:radial-gradient(ellipse 100% 100% at 50% 50%,#000 84%,transparent 99%)}
.lbl{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);text-align:center;white-space:nowrap;pointer-events:none}
.lbl .nm{font-weight:800;font-size:19px;text-shadow:0 1px 2px rgba(247,246,243,.9)}
.lbl .meta{font-size:12px;color:#20403a;text-shadow:0 1px 2px rgba(247,246,243,.9)}
.lbl .dot{display:inline-block;width:8px;height:8px;border-radius:50%;vertical-align:middle;margin-right:5px;background:var(--live)}
.lbl .dot.q{background:#7d8f88}
.hint{position:fixed;right:14px;bottom:12px;z-index:6;font-size:12px;background:rgba(247,246,243,.72);padding:6px 10px;border-radius:10px}
.enter{position:fixed;inset:0;z-index:20;background:var(--sea);opacity:0;pointer-events:none;transition:opacity .4s}
.err{position:fixed;inset:0;display:grid;place-items:center;color:var(--ember);font-weight:700}
/* distress overlay: a clear ring + badge on any island whose row reports distress:true */
.isle.distress::after{content:"";position:absolute;inset:-7%;border-radius:50%;border:3px solid var(--ember);
  box-shadow:0 0 0 5px rgba(228,87,46,.22);pointer-events:none;animation:distressPulse 1.8s ease-in-out infinite}
@keyframes distressPulse{0%,100%{opacity:.5}50%{opacity:1}}
.isle .badge{position:absolute;top:-6px;right:2%;transform:translateY(-100%);background:var(--ember);color:#fff8f5;
  font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;box-shadow:0 2px 7px rgba(20,45,40,.4);
  white-space:nowrap;pointer-events:none;z-index:4;letter-spacing:.02em}
/* relations overlay: pan/zooms with #board since it's an absolutely-positioned child of it */
#relLayer{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:1}
/* gazette toggle + panel */
.gazBtn{pointer-events:auto;cursor:pointer;background:rgba(247,246,243,.82);border:1px solid rgba(18,48,43,.22);
  color:var(--ink);font:800 12px/1 ui-sans-serif,system-ui,sans-serif;padding:8px 14px;border-radius:999px;
  letter-spacing:.03em;box-shadow:0 2px 8px rgba(20,45,40,.18)}
.gazBtn:hover{background:#fff}
header{flex-wrap:wrap}
.panel{position:fixed;top:0;right:0;height:100%;width:min(400px,92vw);background:#f7f6f3;color:var(--ink);
  box-shadow:-10px 0 34px rgba(20,45,40,.28);z-index:15;transform:translateX(105%);transition:transform .28s ease;
  display:flex;flex-direction:column}
.panel.open{transform:translateX(0)}
.panel .gazHead{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid rgba(18,48,43,.15);
  text-shadow:none}
.panel .gazHead .eyebrow{color:#0f3a34}
.panel .gazHead h2{margin:0 0 0 2px;font-size:17px;flex:1;font-weight:800}
.panel .gazClose{cursor:pointer;background:none;border:none;font-size:22px;color:var(--ink);line-height:1;padding:2px 4px}
.panel .gazBody{overflow-y:auto;padding:6px 18px 30px}
.edition{margin:16px 0;padding-bottom:16px;border-bottom:1px dashed rgba(18,48,43,.22)}
.edition:last-child{border-bottom:none}
.edition .eName{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#0f3a34}
.edition .eDate{font-size:11px;color:#5a726c;margin-left:6px}
.edition .eHead{font-size:16px;font-weight:800;margin:5px 0 3px;line-height:1.25}
.edition .eDeck{font-size:13px;color:#3a544e;margin:0 0 7px}
.edition ul{margin:0;padding-left:18px;font-size:12.5px;color:#20403a}
.edition ul li{margin:2px 0}
.gazEmpty{color:#5a726c;font-size:13px;padding:26px 0;text-align:center}
/* mainland / events / watchlist panels (meta-game additions, same panel chrome as the gazette) */
.mlBadge{pointer-events:none;font-size:12px;font-weight:700;color:#20403a}
.moodRow{display:flex;align-items:center;gap:10px;padding:14px 18px 4px}
.moodPill{font:800 11px/1 ui-sans-serif,system-ui,sans-serif;padding:5px 10px;border-radius:999px;letter-spacing:.03em;text-transform:uppercase}
.moodPill.generous,.moodPill.content{background:rgba(47,158,109,.18);color:#1f6b4c}
.moodPill.neutral{background:rgba(125,143,136,.18);color:#3f524d}
.moodPill.wary,.moodPill.grasping{background:rgba(201,138,31,.18);color:#7a5510}
.moodPill.hostile{background:rgba(228,87,46,.18);color:#a3331a}
.edictItem,.eventItem,.wlItem{margin:14px 18px;padding-bottom:14px;border-bottom:1px dashed rgba(18,48,43,.22)}
.edictItem:last-child,.eventItem:last-child,.wlItem:last-child{border-bottom:none}
.edictItem .eTitle,.eventItem .eTitle{font-size:14px;font-weight:800;margin:0 0 3px}
.edictItem .eMeta,.eventItem .eMeta,.wlItem .wlMeta{font-size:11.5px;color:#5a726c}
.wlItem .wlName{font-size:15px;font-weight:800}
.wlItem .wlScore{float:right;font-size:12px;font-weight:800;color:#a3331a}
.wlItem .trail{font-size:12px;color:#20403a;margin-top:5px}
.wlItem .fugBadge{display:inline-block;margin-left:6px;font-size:10px;font-weight:800;color:#fff;background:var(--ember);padding:2px 6px;border-radius:999px;vertical-align:middle}
.isle .badge.wanted{right:auto;left:2%;background:#3a544e}
</style></head><body>
<header><span class=eyebrow>Unwatched</span><h1>The Archipelago</h1><span class=count id=count></span>
<span id=mlBadge class=mlBadge></span>
<button id=mainlandBtn class=gazBtn type=button>🏛 Mainland</button>
<button id=eventsBtn class=gazBtn type=button>🌍 Events</button>
<button id=watchBtn class=gazBtn type=button>🕵 Watchlist</button>
<button id=gazBtn class=gazBtn type=button>📰 Gazette</button></header>
<div id=board></div>
<div class=hint>scroll / pinch to zoom · drag to pan · click an island to enter</div>
<div class=enter id=enter></div>
<div id=gazPanel class=panel>
  <div class=gazHead><span class=eyebrow>The Regional</span><h2>Gazette</h2><button id=gazClose class=gazClose type=button aria-label=close>&times;</button></div>
  <div id=gazBody class=gazBody><div class=gazEmpty>Loading the wires…</div></div>
</div>
<div id=mainlandPanel class=panel>
  <div class=gazHead><span class=eyebrow>The Crown</span><h2>Mainland</h2><button id=mainlandClose class=gazClose type=button aria-label=close>&times;</button></div>
  <div id=mainlandBody class=gazBody><div class=gazEmpty>Loading…</div></div>
</div>
<div id=eventsPanel class=panel>
  <div class=gazHead><span class=eyebrow>The Archipelago</span><h2>Events</h2><button id=eventsClose class=gazClose type=button aria-label=close>&times;</button></div>
  <div id=eventsBody class=gazBody><div class=gazEmpty>Loading…</div></div>
</div>
<div id=watchPanel class=panel>
  <div class=gazHead><span class=eyebrow>Most</span><h2>Watchlist</h2><button id=watchClose class=gazClose type=button aria-label=close>&times;</button></div>
  <div id=watchBody class=gazBody><div class=gazEmpty>Loading…</div></div>
</div>
<script>
const POS={capital:[1000,600],island:[430,360],kestrel:[1560,360],cairnhold:[1640,900],vinehaven:[500,960]};
const KIND={island:"the founding town",kestrel:"a fishing isle",cairnhold:"a mining hold",vinehaven:"a vineyard",capital:"the capital"};
const SCALE=0.17, DEFW=3000;
const board=document.getElementById("board"); let view={x:0,y:0,z:1};
function apply(){board.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`;}
function esc(s){return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
async function build(){
  let d; try{ d=await (await fetch("/world/islands",{cache:"no-store"})).json(); }
  catch(e){ document.body.insertAdjacentHTML("beforeend","<div class=err>Could not reach the hub.</div>"); return; }
  const xs=d.islands||[]; board.innerHTML="";
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  const rects={}; // id -> tile center, in #board's own coordinate space (so overlays pan/zoom with it)
  xs.forEach((i,ix)=>{
    const sw=(i.size&&i.size.w)||DEFW, sh=(i.size&&i.size.h)||1800;
    const w=sw*SCALE, h=sh*SCALE; // same scale on both axes: correct aspect AND larger islands larger
    let c=POS[i.id]; if(!c){const a=-Math.PI/2+ix*2*Math.PI/Math.max(1,xs.length); c=[1000+640*Math.cos(a),620+440*Math.sin(a)];}
    const left=c[0]-w/2, top=c[1]-h/2;
    minx=Math.min(minx,left);miny=Math.min(miny,top);maxx=Math.max(maxx,left+w);maxy=Math.max(maxy,top+h);
    rects[i.id]={cx:left+w/2,cy:top+h/2,left,top,w,h};
    const el=document.createElement("div"); el.className="isle"+(i.distress?" distress":""); el.dataset.iid=i.id; el.style.cssText=`left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
    el.innerHTML=`<img loading=lazy src="/snap/${encodeURIComponent(i.id)}.png?v=${Math.floor((i.lastSeen||0))}" alt="${esc(i.name)}" onerror="this.style.opacity=.25">`+
      (i.distress?`<div class=badge>&#9888; needs food</div>`:``)+
      `<div class=lbl><div class=nm>${i.pack==="capital"?"★ ":""}${esc(i.name)}</div>`+
      `<div class=meta><span class="dot ${i.live?"":"q"}"></span>${i.population||0} souls · day ${i.day||0} · ${esc(i.weather||"?")} · ${esc(KIND[i.pack]||i.pack)}</div></div>`;
    el.addEventListener("click",()=>enter(i));
    board.appendChild(el);
  });
  document.getElementById("count").textContent=xs.length+" islands · "+xs.filter(i=>i.live).length+" live";
  if(xs.length){const bw=maxx-minx,bh=maxy-miny,pad=90;const z=Math.min((innerWidth-pad*2)/bw,(innerHeight-pad*2)/bh,1.2);view.z=z;view.x=(innerWidth-bw*z)/2-minx*z;view.y=(innerHeight-bh*z)/2-miny*z+20;apply();}
  if(xs.length) drawRelations(rects,Math.max(0,maxx),Math.max(0,maxy));
  drawNotorious();
}
async function drawNotorious(){
  // best-effort overlay: mark the last-known island of anyone on the watchlist — additive, never
  // blocks tile rendering if the endpoint is slow/unreachable.
  let d; try{ d=await (await fetch("/people/notorious",{cache:"no-store"})).json(); }catch(e){ return; }
  (d.people||[]).forEach(p=>{
    if(!p.trail||!p.trail.length) return;
    const last=p.trail[p.trail.length-1];
    const el=board.querySelector(`.isle[data-iid="${CSS.escape(last.island)}"]`);
    if(!el) return;
    const b=document.createElement("div"); b.className="badge wanted";
    b.textContent=(p.fugitive?"🕵 wanted: ":"⚠ notorious: ")+esc((p.aliases&&p.aliases[0])||p.id);
    el.appendChild(b);
  });
}
async function drawRelations(rects,boardW,boardH){
  let m; try{ m=await (await fetch("/world/map",{cache:"no-store"})).json(); }
  catch(e){ return; } // no relations layer if /world/map is unreachable — the tiles still work fine
  const rels=(m.relations||[]).filter(r=>r.stance!=="neutral"||r.blockade||r.friction>0);
  const ns="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg"); svg.id="relLayer";
  svg.setAttribute("width",Math.ceil(boardW)); svg.setAttribute("height",Math.ceil(boardH));
  rels.forEach(r=>{
    const a=rects[r.from], b=rects[r.to]; if(!a||!b) return;
    const color=(r.blockade||r.stance==="enemy")?"#c1401f":r.stance==="rival"?"#c98a1f":r.stance==="ally"?"#2f9e6d":"#7d8f88";
    const line=document.createElementNS(ns,"line");
    line.setAttribute("x1",a.cx); line.setAttribute("y1",a.cy); line.setAttribute("x2",b.cx); line.setAttribute("y2",b.cy);
    line.setAttribute("stroke",color); line.setAttribute("stroke-width",r.blockade?4:2.5);
    line.setAttribute("stroke-linecap","round"); line.setAttribute("opacity","0.85");
    if(r.friction>0) line.setAttribute("stroke-dasharray","9 7");
    svg.appendChild(line);
  });
  // sits under the isle tiles (inserted first) but still inside #board, so it pans/zooms with it
  board.insertBefore(svg,board.firstChild);
}
function enter(i){ if(!i.url)return; const e=document.getElementById("enter"); e.style.opacity="1"; setTimeout(()=>location.href=i.url,400); }
// ---- side panels: gazette (existing) + mainland / events / watchlist (meta-game additions).
// All share the same slide-in chrome; opening one closes the others. ----
const gazPanel=document.getElementById("gazPanel"), gazBody=document.getElementById("gazBody");
const mlBadge=document.getElementById("mlBadge");
const PANELS={
  gaz:{el:gazPanel,load:loadGazette}, mainland:{el:document.getElementById("mainlandPanel"),load:loadMainland},
  events:{el:document.getElementById("eventsPanel"),load:loadEvents}, watch:{el:document.getElementById("watchPanel"),load:loadWatch},
};
function closePanels(){ Object.values(PANELS).forEach(p=>p.el.classList.remove("open")); }
function openPanel(key){ closePanels(); PANELS[key].el.classList.add("open"); PANELS[key].load(); }
async function loadGazette(){
  gazBody.innerHTML="<div class=gazEmpty>Loading the wires…</div>";
  let d; try{ d=await (await fetch("/world/gazette",{cache:"no-store"})).json(); }
  catch(e){ gazBody.innerHTML="<div class=gazEmpty>Could not reach the gazette.</div>"; return; }
  const eds=d.editions||[];
  if(!eds.length){ gazBody.innerHTML="<div class=gazEmpty>No editions on the wire yet.</div>"; return; }
  gazBody.innerHTML=eds.map(e=>`<div class=edition>`+
    `<div><span class=eName>${esc(e.name)}</span><span class=eDate>${esc(e.date||"")}${e.weather?" · "+esc(e.weather):""}</span></div>`+
    (e.headline?`<div class=eHead>${esc(e.headline)}</div>`:``)+
    (e.deck?`<div class=eDeck>${esc(e.deck)}</div>`:``)+
    ((e.briefs&&e.briefs.length)?`<ul>${e.briefs.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>`:``)+
    `</div>`).join("");
}
async function loadMainland(){
  const body=document.getElementById("mainlandBody");
  body.innerHTML="<div class=gazEmpty>Reading the crown's dispatches…</div>";
  let d; try{ d=await (await fetch("/world/mainland",{cache:"no-store"})).json(); }
  catch(e){ body.innerHTML="<div class=gazEmpty>Could not reach the mainland.</div>"; return; }
  mlBadge.textContent="🏛 Mainland: "+(d.mood||"neutral");
  const edicts=d.edicts||[];
  let out=`<div class=moodRow><span class="moodPill ${esc(d.mood)}">${esc(d.mood)}</span><span class=eMeta>pressure ${Math.round((d.pressure||0)*100)}%</span></div>`;
  out+=edicts.length?edicts.map(e=>`<div class=edictItem><div class=eTitle>${esc(e.text)}</div>`+
    `<div class=eMeta>${esc(e.kind)}${e.item?" · "+esc(e.item):""}${e.priceMultiplier!=null?" · ×"+e.priceMultiplier:""}${e.source?" · "+esc(e.source):""}</div></div>`).join("")
    :`<div class=gazEmpty>No active edicts.</div>`;
  body.innerHTML=out;
}
async function loadEvents(){
  const body=document.getElementById("eventsBody");
  body.innerHTML="<div class=gazEmpty>Checking the wires…</div>";
  let d; try{ d=await (await fetch("/world/events",{cache:"no-store"})).json(); }
  catch(e){ body.innerHTML="<div class=gazEmpty>Could not reach the hub.</div>"; return; }
  const evs=d.events||[];
  if(!evs.length){ body.innerHTML="<div class=gazEmpty>No events on record.</div>"; return; }
  body.innerHTML=evs.map(e=>{
    const when=e.createdAt?new Date(e.createdAt*1000).toLocaleString():"";
    const where=e.islands==="all"?"all islands":(e.islands||[]).join(", ");
    return `<div class=eventItem><div class=eTitle>${e.active?"":"⏹ "}${esc(e.text)}</div>`+
      `<div class=eMeta>${esc(e.kind)} · ${esc(where)} · ${esc(when)}${e.active?"":" · ended"}</div></div>`;
  }).join("");
}
async function loadWatch(){
  const body=document.getElementById("watchBody");
  body.innerHTML="<div class=gazEmpty>Checking the dossiers…</div>";
  let d; try{ d=await (await fetch("/people/notorious",{cache:"no-store"})).json(); }
  catch(e){ body.innerHTML="<div class=gazEmpty>Could not reach the hub.</div>"; return; }
  const ppl=d.people||[];
  if(!ppl.length){ body.innerHTML="<div class=gazEmpty>No one's made a name for themself yet.</div>"; return; }
  body.innerHTML=ppl.map(p=>{
    const trail=(p.trail||[]).map(t=>esc(t.island)).join(" → ");
    return `<div class=wlItem><div class=wlName>${esc((p.aliases&&p.aliases[0])||p.id)}`+
      (p.fugitive?`<span class=fugBadge>fugitive</span>`:``)+`<span class=wlScore>${(p.score||0).toFixed(2)}</span></div>`+
      `<div class=wlMeta>${esc(p.id)} · ${(p.islandsVisited||[]).length} island(s)</div>`+
      (trail?`<div class=trail>${trail}</div>`:``)+`</div>`;
  }).join("");
}
document.getElementById("gazBtn").addEventListener("click",e=>{e.stopPropagation();openPanel("gaz");});
document.getElementById("gazClose").addEventListener("click",e=>{e.stopPropagation();closePanels();});
document.getElementById("mainlandBtn").addEventListener("click",e=>{e.stopPropagation();openPanel("mainland");});
document.getElementById("mainlandClose").addEventListener("click",e=>{e.stopPropagation();closePanels();});
document.getElementById("eventsBtn").addEventListener("click",e=>{e.stopPropagation();openPanel("events");});
document.getElementById("eventsClose").addEventListener("click",e=>{e.stopPropagation();closePanels();});
document.getElementById("watchBtn").addEventListener("click",e=>{e.stopPropagation();openPanel("watch");});
document.getElementById("watchClose").addEventListener("click",e=>{e.stopPropagation();closePanels();});
loadMainland(); setInterval(loadMainland,60000); // ambient header badge, independent of the panel
let drag=null,moved=false;
addEventListener("pointerdown",e=>{if(e.target.closest("header,.hint,.panel"))return;drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};moved=false;});
addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;view.x=drag.vx+dx;view.y=drag.vy+dy;apply();});
addEventListener("pointerup",()=>{setTimeout(()=>drag=null,0);});
addEventListener("click",e=>{if(moved)e.stopPropagation();},true);
addEventListener("wheel",e=>{e.preventDefault();const f=e.deltaY<0?1.12:0.9;const nz=Math.max(0.15,Math.min(3,view.z*f));view.x=e.clientX-(e.clientX-view.x)*(nz/view.z);view.y=e.clientY-(e.clientY-view.y)*(nz/view.z);view.z=nz;apply();},{passive:false});
build();
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    server_version = "uw-hub/1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _authed(self):
        return (not SECRET) or self.headers.get("X-Hub") == SECRET

    def _body(self):
        n = int(self.headers.get("Content-Length", "0") or "0")
        return json.loads(self.rfile.read(n) or "{}") if n else {}

    def do_GET(self):
        p = self.path.split("?", 1)[0].rstrip("/") or "/"
        if p == "/" or p == "":
            return self._send(200, PAGE, "text/html; charset=utf-8")
        if p == "/health":
            return self._send(200, {"ok": True, "service": "uw-hub", "islands": len(all_islands())})
        m = re.match(r"^/snap/([A-Za-z0-9_-]+)\.png$", p)  # static island snapshot for the region map
        if m:
            fp = os.path.join(SNAP_DIR, m.group(1) + ".png")
            if os.path.isfile(fp):
                with open(fp, "rb") as fh:
                    body = fh.read()
                self.send_response(200); self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=300")
                self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
            return self._send(404, {"error": "no snapshot yet"})
        if p == "/world/islands":
            return self._send(200, {"islands": all_islands()})
        if p == "/world/map":
            return self._send(200, world_map())
        if p == "/world/gazette":
            return self._send(200, get_gazette())
        if p == "/world/mainland":
            return self._send(200, get_mainland())
        if p == "/world/events":
            return self._send(200, {"events": all_events(50)})
        m = re.match(r"^/events/([^/]+)$", p)  # what THIS island should see, per §11 (islands opt in)
        if m:
            return self._send(200, {"events": active_events_for(m.group(1))})
        if p == "/people/notorious":
            return self._send(200, {"people": all_notorious(20)})
        m = re.match(r"^/people/([^/]+)$", p)
        if m:
            person = person_dossier(m.group(1))
            return self._send(200, person) if person else self._send(404, {"error": "no such person"})
        m = re.match(r"^/world/islands/([^/]+)$", p)
        if m:
            iid = m.group(1)
            row = next((i for i in all_islands() if i["id"] == iid), None)
            return self._send(200, row) if row else self._send(404, {"error": "no such island"})
        m = re.match(r"^/relations/([^/]+)/([^/]+)$", p)
        if m:
            rel = get_relation(m.group(1), m.group(2))
            rel["asOf"] = int(now()); rel["ttl"] = 60
            return self._send(200, rel)
        return self._send(404, {"error": "not found"})

    def do_HEAD(self):
        self.do_GET()

    def _admin_ok(self):
        return bool(ADMIN_TOKEN) and self.headers.get("X-Hub-Admin") == ADMIN_TOKEN

    def do_POST(self):
        p = self.path.split("?", 1)[0].rstrip("/")
        try:
            b = self._body()
        except Exception:
            return self._send(400, {"error": "bad json"})

        # ---- admin / game actions (§16): a separate, stronger credential, never an island's secret ----
        if p.startswith("/admin/"):
            if not self._admin_ok():
                return self._send(403, {"error": "admin disabled or bad X-Hub-Admin token"})
            if p == "/admin/embargo":  # {from,to,on} — hostility as heavy FRICTION (leaky), not a wall
                if not b.get("from") or not b.get("to"):
                    return self._send(400, {"error": "from and to required"})
                on = bool(b.get("on", True))
                st = "enemy" if on else "neutral"
                return self._send(200, {"ok": True, "relation": set_relation(b["from"], b["to"], stance=st, friction=STANCE_FRICTION[st], blockade=False)})
            if p == "/admin/blockade":  # {from,to,on} — a true hard stop (nothing crosses)
                if not b.get("from") or not b.get("to"):
                    return self._send(400, {"error": "from and to required"})
                return self._send(200, {"ok": True, "relation": set_relation(b["from"], b["to"], blockade=bool(b.get("on", True)))})
            if p == "/admin/tariff":  # {from,to,rate}
                if not b.get("from") or not b.get("to"):
                    return self._send(400, {"error": "from and to required"})
                return self._send(200, {"ok": True, "relation": set_relation(b["from"], b["to"], tariff=b.get("rate", 0))})
            # ---- mainland as an actor (§12) — influence/friction only, never a command ----
            if p == "/admin/mainland/mood":  # {mood, pressure?}
                if b.get("mood") not in MOODS:
                    return self._send(400, {"error": f"mood must be one of {list(MOODS)}"})
                return self._send(200, {"ok": True, "mainland": set_mainland_mood(b["mood"], b.get("pressure"))})
            if p == "/admin/mainland/edict":  # {kind,text,item?,priceMultiplier?,ttlSec?}
                if not b.get("text"):
                    return self._send(400, {"error": "text required"})
                add_edict(b.get("kind", "edict"), b["text"], item=b.get("item"),
                          price_multiplier=b.get("priceMultiplier"), ttl_sec=b.get("ttlSec"), source="admin")
                return self._send(200, {"ok": True, "mainland": get_mainland()})
            if p == "/admin/mainland/edict/retire":  # {id}
                if not b.get("id"):
                    return self._send(400, {"error": "id required"})
                retire_edict(b["id"])
                return self._send(200, {"ok": True, "mainland": get_mainland()})
            # ---- coordinated cross-island events (§11) ----
            if p == "/admin/event":  # {kind,text,islands:[...]|"all",weather?,season?,ttlSec?,extra?}
                if not b.get("kind") or not b.get("text"):
                    return self._send(400, {"error": "kind and text required"})
                extra = dict(b.get("extra") or {})
                for k in ("weather", "season"):
                    if k in b:
                        extra[k] = b[k]
                ev = add_event(b["kind"], b.get("islands", "all"), b["text"], extra=extra, ttl_sec=b.get("ttlSec"))
                return self._send(200, {"ok": True, "event": ev})
            if p == "/admin/event/retire":  # {id}
                if not b.get("id"):
                    return self._send(400, {"error": "id required"})
                retire_event(b["id"])
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

        # ---- island-authenticated writes ----
        if not self._authed():
            return self._send(403, {"error": "bad or missing X-Hub secret"})
        if p == "/islands":
            if not b.get("id"):
                return self._send(400, {"error": "id required"})
            upsert_island(b)
            return self._send(200, {"ok": True})
        m = re.match(r"^/islands/([^/]+)/state$", p)
        if m:
            update_state(m.group(1), b)
            return self._send(200, {"ok": True})
        # ---- cross-island notoriety ingestion (§14): an island reports what IT perceived.
        # The hub never computes guilt; it only stores and aggregates what's reported. ----
        m = re.match(r"^/people/([^/]+)/report$", p)
        if m:
            if not b.get("island"):
                return self._send(400, {"error": "island required"})
            report_person(m.group(1), b["island"], b.get("notoriety", 0), bool(b.get("fugitive")),
                          b.get("note", ""), b.get("alias"))
            return self._send(200, {"ok": True, "person": person_dossier(m.group(1))})
        return self._send(404, {"error": "not found"})

    def do_PUT(self):
        p = self.path.split("?", 1)[0].rstrip("/")
        if not self._admin_ok():
            return self._send(403, {"error": "admin disabled or bad X-Hub-Admin token"})
        try:
            b = self._body()
        except Exception:
            return self._send(400, {"error": "bad json"})
        m = re.match(r"^/admin/relations/([^/]+)/([^/]+)$", p)  # {stance, policy:{friction,blockade,tariff}}
        if m:
            pol = b.get("policy", {})
            rel = set_relation(m.group(1), m.group(2), stance=b.get("stance"),
                               friction=pol.get("friction"), blockade=pol.get("blockade"),
                               tariff=pol.get("tariff"))
            return self._send(200, {"ok": True, "relation": rel})
        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    init_db()
    threading.Thread(target=mainland_loop, daemon=True).start()
    print(f"[uw-hub] listening on :{PORT}  db={DB_PATH}  auth={'on' if SECRET else 'off'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
