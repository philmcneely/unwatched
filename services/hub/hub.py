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
:root{--ground:#0e1620;--sea:#12354a;--sea2:#0c2436;--land:#2e3a2a;--land2:#3a4a32;--ink:#eaf1f2;--mist:#93a7b0;--kelp:#f2c14e;--ember:#E4572E;--live:#3fb984;--edge:#22303a}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--ground);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
header{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;align-items:baseline;gap:14px;padding:14px 20px;background:linear-gradient(180deg,rgba(14,22,32,.92),rgba(14,22,32,0));pointer-events:none}
header .eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:700;color:var(--kelp)}
header h1{font-size:20px;margin:0;font-weight:800}
header .count{color:var(--mist);font-size:13px;margin-left:auto;pointer-events:auto}
#wrap{position:fixed;inset:0}
svg{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
svg.drag{cursor:grabbing}
#stage{transition:transform .55s cubic-bezier(.6,.02,.2,1)}
.lane{stroke:#2b4d63;stroke-width:2;stroke-dasharray:6 8;fill:none;opacity:.55}
.mainlane{stroke:#5a6b4a;stroke-width:2;stroke-dasharray:2 9;fill:none;opacity:.5}
.rel{fill:none;stroke-width:4}
.isle{cursor:pointer}
.isle:hover .disc{stroke:var(--kelp);stroke-width:4}
.disc{fill:#193a2e;stroke:#2b5a47;stroke-width:2;transition:stroke .15s,stroke-width .15s}
.nm{font-weight:800;fill:var(--ink);text-anchor:middle}
.meta{fill:var(--mist);text-anchor:middle;font-size:19px}
.livedot{fill:var(--live)}.quietdot{fill:#5b6b73}
.mainland-lbl{fill:#9fb08a;text-anchor:middle;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
.legend{position:fixed;left:16px;bottom:14px;z-index:5;background:rgba(14,22,32,.82);border:1px solid var(--edge);border-radius:12px;padding:10px 12px;font-size:12px;color:var(--mist);max-width:min(92vw,420px)}
.legend b{color:var(--ink)}
.legend .row{display:flex;align-items:center;gap:8px;margin:3px 0;flex-wrap:wrap}
.sw{width:22px;height:0;border-top:4px solid}
.hint{position:fixed;right:16px;bottom:14px;z-index:5;color:var(--mist);font-size:12px;background:rgba(14,22,32,.7);padding:6px 10px;border-radius:10px}
.err{position:fixed;inset:0;display:grid;place-items:center;color:var(--ember)}
</style></head><body>
<header><span class=eyebrow>Unwatched</span><h1>The Archipelago</h1><span class=count id=count></span></header>
<div id=wrap><svg id=svg viewBox="0 0 1000 720" preserveAspectRatio="xMidYMid meet"><g id=stage></g></svg></div>
<div class=legend id=legend></div>
<div class=hint>scroll / pinch to zoom · drag to pan · click an island to enter</div>
<script>
const NS="http://www.w3.org/2000/svg";
const POS={capital:[500,300],island:[250,205],kestrel:[745,195],cairnhold:[780,430],vinehaven:[280,470]};
const KIND={island:"the founding town",kestrel:"a fishing isle",cairnhold:"a mining hold",vinehaven:"a vineyard",capital:"the capital"};
const WGLYPH={clear:"☀️",rain:"🌧️",storm:"⛈️",wind:"🌬️",fog:"🌫️",snow:"❄️"};
const REL={ally:"#3fb984",rival:"#f2c14e",enemy:"#E4572E"};
const stage=document.getElementById("svg").querySelector("#stage");
function el(n,a){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;}
function pos(i,idx,n){if(POS[i.id])return POS[i.id];const a=-Math.PI/2+idx*2*Math.PI/Math.max(1,n);return [500+300*Math.cos(a),330+210*Math.sin(a)];}
function esc(s){return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

async function draw(){
  let d; try{ d=await (await fetch("/world/map",{cache:"no-store"})).json(); }
  catch(e){ document.body.insertAdjacentHTML("beforeend","<div class=err>Could not reach the hub.</div>"); return; }
  const isles=(d.islands||[]); const rels=(d.relations||[]);
  const n=isles.length; const P={}; isles.forEach((i,ix)=>P[i.id]=pos(i,ix,n));
  stage.textContent="";
  // --- the mainland: the trade horizon along the foot of the sea (one now; blocs/allegiance come with v3) ---
  const land=el("path",{d:"M -40 720 L -40 640 Q 250 600 500 632 Q 780 662 1040 618 L 1040 720 Z",fill:"var(--land)",stroke:"var(--land2)","stroke-width":2});
  stage.appendChild(land);
  stage.appendChild(Object.assign(el("text",{x:500,y:690,class:"mainland-lbl","font-size":22}),{textContent:"The mainland"}));
  // export lanes: every island trades down to the mainland
  isles.forEach(i=>{const [x,y]=P[i.id]; stage.appendChild(el("line",{x1:x,y1:y,x2:x,y2:632,class:"mainlane"}));});
  // --- sea lanes between islands (from the harbors topology), de-duped ---
  const seen=new Set();
  isles.forEach(i=>(i.harbors||[]).forEach(h=>{const key=[i.id,h.id].sort().join("~"); if(seen.has(key)||!P[h.id])return; seen.add(key); const [x1,y1]=P[i.id],[x2,y2]=P[h.id]; stage.appendChild(el("line",{x1,y1,x2,y2,class:"lane"}));}));
  // --- relation edges (diplomacy), directed, colored by stance ---
  rels.forEach(r=>{ if(!P[r.from]||!P[r.to])return; const st=r.blockade?"enemy":r.stance; const col=REL[st]; if(!col&&!r.blockade&&!(r.friction>0))return;
    const [x1,y1]=P[r.from],[x2,y2]=P[r.to]; const mx=(x1+x2)/2,my=(y1+y2)/2-24;
    const path=el("path",{d:`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`,class:"rel",stroke:col||"#E4572E",opacity:.85});
    if(r.friction>0&&!r.blockade)path.setAttribute("stroke-dasharray","3 7");
    if(r.blockade){path.setAttribute("stroke-width","6");}
    stage.appendChild(path);
  });
  // --- islands ---
  isles.forEach(i=>{const [x,y]=P[i.id]; const R=30+Math.min(26,(i.population||0)*0.9);
    const g=el("g",{class:"isle"}); g.dataset.url=i.url||""; g.dataset.id=i.id;
    g.appendChild(el("circle",{cx:x,cy:y,r:R+8,fill:"#0c2b22",opacity:.6}));
    g.appendChild(el("circle",{cx:x,cy:y,r:R,class:"disc"}));
    g.appendChild(Object.assign(el("text",{x:x,y:y+3,"text-anchor":"middle","font-size":26}),{textContent:WGLYPH[i.weather]||"⚓"}));
    g.appendChild(el("circle",{cx:x+R-6,cy:y-R+6,r:6,class:i.live?"livedot":"quietdot"}));
    g.appendChild(Object.assign(el("text",{x:x,y:y+R+26,class:"nm","font-size":22}),{textContent:(i.pack==="capital"?"★ ":"")+esc(i.name)}));
    g.appendChild(Object.assign(el("text",{x:x,y:y+R+48,class:"meta"}),{textContent:(i.population||0)+" souls · day "+(i.day||0)+" · "+esc(i.weather||"?")}));
    g.appendChild(Object.assign(el("text",{x:x,y:y+R+68,class:"meta","font-size":16,"fill":"#6f8390"}),{textContent:KIND[i.pack]||i.pack}));
    g.addEventListener("click",()=>enter(i,x,y));
    stage.appendChild(g);
  });
  document.getElementById("count").textContent=n+" islands · "+isles.filter(i=>i.live).length+" live";
  renderLegend(rels);
}
function renderLegend(rels){
  const active=rels.some(r=>r.stance&&r.stance!=="neutral"||r.blockade||r.friction>0);
  document.getElementById("legend").innerHTML=
    '<div class=row><b>The region.</b>&nbsp;Islands, the sea-lanes their boats run, and the mainland they trade with.</div>'+
    '<div class=row><span class=sw style="border-color:#2b4d63;border-top-style:dashed"></span>boat route between islands</div>'+
    '<div class=row><span class=sw style="border-color:#5a6b4a;border-top-style:dashed"></span>trade to the mainland</div>'+
    (active?('<div class=row><span class=sw style="border-color:#E4572E"></span>enemy / blockade &nbsp; <span class=sw style="border-color:#f2c14e"></span>rival &nbsp; <span class=sw style="border-color:#3fb984"></span>ally &nbsp;<span style="color:#93a7b0">(dashed = leaky friction)</span></div>')
            :'<div class=row style="color:#6f8390">All islands at peace — no rivalries declared yet.</div>');
}
// zoom into an island, then enter its live world
function enter(i,x,y){
  const url=i.url; if(!url)return;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){location.href=url;return;}
  const s=3.2; stage.style.transformOrigin=(x/1000*100)+"% "+(y/720*100)+"%";
  document.getElementById("svg").style.transition="opacity .5s"; stage.style.transform="scale("+s+")";
  document.getElementById("svg").style.opacity="0";
  setTimeout(()=>location.href=url,520);
}
// pan + zoom (wheel/pinch/drag) on the viewBox
const svg=document.getElementById("svg"); let vb={x:0,y:0,w:1000,h:720};
function apply(){svg.setAttribute("viewBox",`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);}
svg.addEventListener("wheel",e=>{e.preventDefault();const r=svg.getBoundingClientRect();const mx=vb.x+(e.clientX-r.left)/r.width*vb.w;const my=vb.y+(e.clientY-r.top)/r.height*vb.h;const f=e.deltaY<0?0.88:1.14;const nw=Math.max(220,Math.min(2200,vb.w*f));const nh=nw*720/1000;vb.x=mx-(mx-vb.x)*(nw/vb.w);vb.y=my-(my-vb.y)*(nh/vb.h);vb.w=nw;vb.h=nh;apply();},{passive:false});
let drag=null;
svg.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,vx:vb.x,vy:vb.y};svg.classList.add("drag");svg.setPointerCapture(e.pointerId);});
svg.addEventListener("pointermove",e=>{if(!drag)return;const r=svg.getBoundingClientRect();vb.x=drag.vx-(e.clientX-drag.x)/r.width*vb.w;vb.y=drag.vy-(e.clientY-drag.y)/r.height*vb.h;apply();});
svg.addEventListener("pointerup",e=>{drag=null;svg.classList.remove("drag");});
draw(); setInterval(draw,15000);
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
