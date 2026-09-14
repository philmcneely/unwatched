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
import json, os, re, sqlite3, threading, time, html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("HUB_PORT", "4600"))
SECRET = os.environ.get("HUB_SECRET", "")
ADMIN_TOKEN = os.environ.get("HUB_ADMIN_TOKEN", "")  # separate, stronger cred for /admin/* (game actions)
DB_PATH = os.environ.get("HUB_DB", "/data/hub.db")
LIVE_SEC = int(os.environ.get("HUB_LIVE_SEC", "360"))
STANCES = ("ally", "neutral", "rival", "enemy")
# Hostility is FRICTION, not a wall (docs/hub-design.md §8): even enemies leak — some cargo is
# smuggled through, some people still cross. A stance sets a default drag (0..1 = the share of
# crossings turned back / the volume lost); only an explicit `blockade` is a true hard stop.
STANCE_FRICTION = {"ally": 0.0, "neutral": 0.0, "rival": 0.35, "enemy": 0.7}

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
            mayor TEXT, boat TEXT, map_x REAL, map_y REAL, updated_at REAL )""")
        c.execute("""CREATE TABLE IF NOT EXISTS relations (
            from_id TEXT, to_id TEXT, stance TEXT, friction REAL, blockade INTEGER,
            tariff REAL, updated_at REAL, PRIMARY KEY (from_id, to_id) )""")
        # migrate older dbs that had embargo/passengers_blocked instead of friction/blockade
        cols = {r[1] for r in c.execute("PRAGMA table_info(relations)")}
        if "friction" not in cols:
            c.execute("ALTER TABLE relations ADD COLUMN friction REAL DEFAULT 0")
        if "blockade" not in cols:
            c.execute("ALTER TABLE relations ADD COLUMN blockade INTEGER DEFAULT 0")


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
        "mayor": r["mayor"],
        "boat": json.loads(r["boat"] or '{"running":false,"held":false}'),
        "map": {"x": r["map_x"], "y": r["map_y"]} if r["map_x"] is not None else None,
    }


def all_islands():
    with db() as c:
        return [island_row(r) for r in c.execute("SELECT * FROM islands ORDER BY id")]


def upsert_island(b):
    with _lock, db() as c:
        c.execute("""INSERT INTO islands (id,name,pack,url,harbors,updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, pack=excluded.pack,
              url=excluded.url, harbors=excluded.harbors, updated_at=excluded.updated_at""",
            (b["id"], b.get("name", b["id"]), b.get("pack", ""), b.get("url", ""),
             json.dumps(b.get("harbors", [])), now()))


def update_state(island_id, b):
    with _lock, db() as c:
        cur = c.execute("SELECT id FROM islands WHERE id=?", (island_id,)).fetchone()
        if not cur:  # a heartbeat can create the row too, so order of boot calls doesn't matter
            c.execute("INSERT INTO islands (id,name,harbors,updated_at) VALUES (?,?,?,?)",
                      (island_id, island_id, "[]", now()))
        c.execute("""UPDATE islands SET last_seen=?, day=?, weather=?, population=?,
              minted=?, burned=?, flour_shortage=?, mayor=?, boat=?, updated_at=? WHERE id=?""",
            (now(), b.get("day", 0), b.get("weather", "unknown"), b.get("population", 0),
             b.get("minted", 0), b.get("burned", 0), 1 if b.get("flourShortage") else 0,
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
    # v1: islands + relations are real; conflicts/mainland/events stay stable-but-empty until later phases.
    return {"islands": all_islands(), "relations": all_relations(), "conflicts": [],
            "mainland": {"mood": "neutral", "edicts": []}, "events": []}


# ---- the live overview / spectator switcher page ----
PAGE = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1"><title>The Archipelago</title>
<style>
:root{--ground:#14161a;--panel:#1b1f27;--edge:#2a3038;--ink:#f2efe6;--mist:#9aa3af;--kelp:#f2c14e;--ember:#E4572E;--live:#3fb984}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(120% 90% at 50% -10%,#1d2530 0%,var(--ground) 60%);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}
.wrap{max-width:1000px;margin:0 auto;padding:56px 20px 72px}
.eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:12px;font-weight:700;color:var(--kelp)}
h1{font-size:clamp(34px,6vw,56px);margin:.15em 0 .1em;font-weight:800;letter-spacing:-.01em}
.lede{color:var(--mist);max-width:60ch;margin:0 0 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
a.card{display:block;text-decoration:none;color:inherit;background:linear-gradient(180deg,var(--panel),#171b22);border:1px solid var(--edge);border-radius:16px;padding:18px 20px;transition:border-color .15s,transform .15s}
a.card:hover{border-color:var(--kelp);transform:translateY(-2px)}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
h2{font-size:22px;margin:0}
.badge{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:#2a3038;color:var(--mist)}
.badge.live{background:rgba(63,185,132,.16);color:var(--live)}
.stats{display:flex;gap:16px;color:var(--mist);font-size:13px;margin-top:10px;flex-wrap:wrap}
.stats b{color:var(--ink);font-weight:700}
.kind{color:var(--mist);font-size:13px;margin:6px 0 0}
.go{color:var(--kelp);font-weight:700;font-size:14px;margin-top:12px;display:inline-block}
footer{margin-top:40px;color:var(--mist);font-size:13px;border-top:1px solid var(--edge);padding-top:18px}
.err{color:var(--ember)}
</style></head><body><div class=wrap>
<div class=eyebrow>Unwatched · the archipelago</div>
<h1>The Archipelago</h1>
<p class=lede>Islands, each its own living town, cross-wired by boats. Pick one to watch — this list is live from the hub, so new islands appear the moment they come up.</p>
<div class=grid id=grid><p class=mist>Loading the archipelago…</p></div>
<footer id=foot></footer>
</div><script>
const KIND={island:"the founding town",kestrel:"a fishing isle",cairnhold:"a mining hold",vinehaven:"a vineyard",capital:"the capital"};
async function load(){
  try{
    const r=await fetch('/world/islands',{cache:'no-store'}); const d=await r.json();
    const xs=(d.islands||[]).slice().sort((a,b)=>(b.pack==='capital')-(a.pack==='capital')||a.id.localeCompare(b.id));
    const g=document.getElementById('grid');
    if(!xs.length){g.innerHTML='<p class=err>No islands have registered yet.</p>';return;}
    g.innerHTML=xs.map(function(i){
      const live=i.live?'<span class="badge live">live</span>':'<span class=badge>quiet</span>';
      const cap=i.pack==='capital';
      return '<a class=card href="'+(i.url||'#')+'">'
        +'<div class=top><h2>'+esc(i.name)+'</h2>'+live+'</div>'
        +'<p class=kind>'+(cap?'★ ':'')+(KIND[i.pack]||i.pack)+'</p>'
        +'<div class=stats><span><b>'+i.population+'</b> souls</span><span>day <b>'+i.day+'</b></span><span>'+esc(i.weather)+'</span></div>'
        +'<span class=go>Watch '+esc(i.name)+' →</span></a>';
    }).join('');
    const liveN=xs.filter(function(i){return i.live}).length;
    document.getElementById('foot').textContent=xs.length+' islands registered · '+liveN+' live. Separate from the original unwatched.draconis.io.';
  }catch(e){document.getElementById('grid').innerHTML='<p class=err>Could not reach the hub.</p>';}
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]});}
load(); setInterval(load,15000);
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
        if p == "/world/islands":
            return self._send(200, {"islands": all_islands()})
        if p == "/world/map":
            return self._send(200, world_map())
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
    print(f"[uw-hub] listening on :{PORT}  db={DB_PATH}  auth={'on' if SECRET else 'off'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
