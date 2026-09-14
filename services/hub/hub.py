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
SNAP_DIR = os.environ.get("HUB_SNAP_DIR", "/data/snaps")  # static island snapshots for the region map
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
            mayor TEXT, boat TEXT, map_x REAL, map_y REAL, size TEXT, updated_at REAL )""")
        icols = {r[1] for r in c.execute("PRAGMA table_info(islands)")}
        if "size" not in icols:
            c.execute("ALTER TABLE islands ADD COLUMN size TEXT")
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
</style></head><body>
<header><span class=eyebrow>Unwatched</span><h1>The Archipelago</h1><span class=count id=count></span></header>
<div id=board></div>
<div class=hint>scroll / pinch to zoom · drag to pan · click an island to enter</div>
<div class=enter id=enter></div>
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
  xs.forEach((i,ix)=>{
    const sw=(i.size&&i.size.w)||DEFW, sh=(i.size&&i.size.h)||1800;
    const w=sw*SCALE, h=sh*SCALE; // same scale on both axes: correct aspect AND larger islands larger
    let c=POS[i.id]; if(!c){const a=-Math.PI/2+ix*2*Math.PI/Math.max(1,xs.length); c=[1000+640*Math.cos(a),620+440*Math.sin(a)];}
    const left=c[0]-w/2, top=c[1]-h/2;
    minx=Math.min(minx,left);miny=Math.min(miny,top);maxx=Math.max(maxx,left+w);maxy=Math.max(maxy,top+h);
    const el=document.createElement("div"); el.className="isle"; el.style.cssText=`left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
    el.innerHTML=`<img loading=lazy src="/snap/${encodeURIComponent(i.id)}.png?v=${Math.floor((i.lastSeen||0))}" alt="${esc(i.name)}" onerror="this.style.opacity=.25">`+
      `<div class=lbl><div class=nm>${i.pack==="capital"?"★ ":""}${esc(i.name)}</div>`+
      `<div class=meta><span class="dot ${i.live?"":"q"}"></span>${i.population||0} souls · day ${i.day||0} · ${esc(i.weather||"?")} · ${esc(KIND[i.pack]||i.pack)}</div></div>`;
    el.addEventListener("click",()=>enter(i));
    board.appendChild(el);
  });
  document.getElementById("count").textContent=xs.length+" islands · "+xs.filter(i=>i.live).length+" live";
  if(xs.length){const bw=maxx-minx,bh=maxy-miny,pad=90;const z=Math.min((innerWidth-pad*2)/bw,(innerHeight-pad*2)/bh,1.2);view.z=z;view.x=(innerWidth-bw*z)/2-minx*z;view.y=(innerHeight-bh*z)/2-miny*z+20;apply();}
}
function enter(i){ if(!i.url)return; const e=document.getElementById("enter"); e.style.opacity="1"; setTimeout(()=>location.href=i.url,400); }
let drag=null,moved=false;
addEventListener("pointerdown",e=>{if(e.target.closest("header,.hint"))return;drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};moved=false;});
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
