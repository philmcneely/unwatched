# The Coordinator Hub — design

Status: design only. Nothing here is built yet except the first seam (`GET /api/island`, see
§5), which is landing now. This document is the plan a future engineer builds the rest from.

## 1. Overview & guiding principles

`unwatched` runs one `Town` per server process (`apps/server/src/main.ts`:
`const town = new Town({ pack: PACK, ... })`). Islands already federate **peer-to-peer over
HTTP**: an island's `onDepart` posts a passenger to a sibling's `/api/boat/arrive`, and each
morning `sailCargo()` pulls a sibling's `/api/boat/wants` and posts to its `/api/boat/cargo`.
The shared secret in `UW_BOAT_SECRET` (sent as the `X-Boat` header) authenticates those
crossings. A sibling's public state is polled from its `/api/town` (cached 60s in
`harborStats`).

The **coordinator hub** is a *new, separate, optional* service that sits above the peer mesh
and owns the things no single island can own by itself: who exists (a registry), how islands
regard each other (relations), what the mainland does as an actor, an aggregated world view,
and the resolution of inherently two-sided events (war, archipelago-wide weather). The hub is
**orchestration, not simulation** — it never runs a `Town`, never ticks a clock, never owns an
agent.

Guiding principles (these are invariants; §20 restates them as hard rules):

- **Optional and additive.** The floor is "2 islands and nothing else, no hub." That case must
  stay trivial and must never regress. Every hub feature is something the world gains, never
  something an island needs.
- **Islands never depend on the hub.** If `UW_HUB_URL` is unset, or the hub is down, or the hub
  returns garbage, each island keeps running exactly as it does today as a plain peer mesh.
  Every hub call is best-effort, time-boxed, cached, and has a defined "hub absent" fallback.
- **Islands stay authoritative over their own sim.** Clock (`this.t`/`this.day`), seed
  (`this.rng`), economy (`minted`/`burned`, `ship()`/`receive()`/`price()`), weather
  (`this.weather`, `rollWeather()`), and minds all remain island-local. The hub can *feed*
  inputs (a stance to honour, a mainland price, a "real" weather value) but the island applies
  them through its own existing machinery.
- **Build on the boat model, don't replace it.** Passengers and cargo keep flowing island →
  island directly. The hub is a directory and a policy/aggregation layer alongside that flow,
  not a broker the goods route through.

## 2. Architecture

```
                          +-----------------------------------------+
                         |          COORDINATOR HUB (optional)      |
                         |  registry · relations · mainland state   |
                         |  world/map aggregation · conflicts       |
                         |  events · (later) cross-island social    |
                         |  sqlite (or stdlib json)   :8770         |
                         +----+--------------------+-----------+----+
              register/        ^      ^      ^                 ^  world/map,
              heartbeat/       | pull | pull | pull            |  admin actions
              report-state     | stance/policy/mainland/events |
                    |          |      |      |                 |
        +-----------+----+ +---+------+--+ +-+-------------+   +------------+
        |   island A     | |  island B   | |  island C     |  |   web app  |
        | Town(pack=...) | | Town(...)   | | Town(...)     |  | apps/web   |
        |  :4000         | |  :4001      | |  :4002        |  | one "world |
        +---+--------+---+ +--+-------+--+ +---+-------+---+  |  door"     |
            |        ^        |       ^        |       ^      +-----+------+
            |        |        |       |        |       |            |
  boats: onDepart -> /api/boat/arrive  |       |       |            | spectator
  cargo: /api/boat/wants + /api/boat/cargo  (X-Boat)   |            | switcher
            +--------+--------+-------+--------+-------+            | (per-island
                 PEER-TO-PEER MESH (unchanged; works with NO hub)  |  opening view)
                                                                   v
                            direct to each island's /api/*  <------+
```

Two independent planes:

- **Peer plane (exists, mandatory floor).** Islands talk to each other for passengers and
  cargo. Nothing here needs the hub.
- **Hub plane (new, optional).** Islands push a little state to the hub and pull policy/relations
  from it; the web pulls the world view from it. Cut this plane entirely and the peer plane still
  runs.

## 3. Responsibilities — the boundary

The boundary is the whole point of the design. Keep it sharp.

### The island owns (never the hub)

- Its **clock**: `this.t`, `this.day`, `tick()`, the `loop()` in `main.ts`. Each island keeps its
  own time (and, with `UW_REAL_WORLD`, its own real-world clock/season). The hub has no clock the
  sim obeys.
- Its **RNG/seed** (`UW_SEED`, `this.rng`) and therefore all local determinism.
- Its **economy**: `minted`/`burned`, `ship()`, `receive()`, `price()`, `merchants()`,
  `tourism()`, `cart()`, `produce()`, wages, treasuries. Coins are minted/burned locally.
- Its **weather** by default (`rollWeather()` each hour in `hourly()`), unless it opts into an
  external feed (already true for `UW_REAL_WORLD`; the hub can be a second such feed — see §11).
- Its **agents/minds**: personas, needs, memory, letters, reflection, the brain router.
- **Authority over whether to honour hub inputs.** The island *pulls* a stance or a price and
  *chooses* to apply it locally. The hub cannot reach into a `Town`.

### The hub owns (no island can)

- The **registry / directory**: the authoritative list of islands (id, name, pack, url, harbors,
  liveness). This is the one thing genuinely global.
- **Inter-island relations**: directed stance + policies between ordered island pairs
  (ally/neutral/rival/enemy; embargo, tariff). No single island can be the source of truth for
  "how A and B regard each other."
- **Mainland-as-actor state**: the prices the mainland pays, duties/taxes, edicts, pressure.
  Today "the mainland" is an infinite abstract buyer/seller inside each engine; the hub makes it
  one shared actor.
- **Conflicts / military**: inherently two-sided, so resolved centrally and pushed to both sides.
- **World aggregation**: the archipelago overview/map, stitched from every island's reported
  state.
- **Archipelago-wide events**: a hurricane that sweeps several islands, a shared festival/season —
  coordinated centrally, applied locally.
- **(Later) cross-island social**: letters/relationships/festivals between citizens of different
  islands — the hub is their natural home because they span islands.

Rule of thumb: **if it lives inside one `Town`, the island owns it. If it is *between* Towns or
*about all* Towns, the hub owns it — and even then the island applies the effect through its own
code.**

## 4. The island-side seam

The seam is deliberately tiny: a few env vars, one endpoint islands serve, and a short list of
best-effort hub calls. Everything is a no-op when `UW_HUB_URL` is unset.

### Proposed env

| Env | Meaning | Default / absent behaviour |
|-----|---------|----------------------------|
| `UW_HUB_URL` | Base URL of the hub, e.g. `https://hub.unwatched.world`. **The master switch.** | Unset → island runs pure peer mesh; no hub calls made. |
| `UW_ISLAND_URL` | This island's own externally reachable base URL, so the hub and siblings can call it back. | Falls back to `UW_PUBLIC_URL` (already parsed for `SITE_URL`) if unset. |
| `UW_HUB_SECRET` | Shared secret for hub↔island calls (sent as `X-Hub` header), mirroring `UW_BOAT_SECRET`/`X-Boat`. | Unset → island will still *read* public hub data but the hub should refuse state-changing pushes; keep it required for register/report. |

`UW_PACK`, `UW_TOWN_ID`, `UW_TOWN_NAME`, `UW_HARBORS`, `UW_BOAT_SECRET` are unchanged.

### What the island serves: `GET /api/island` (the first seam, landing now)

A stable, cheap discovery document. This is the one new endpoint every island exposes regardless
of whether a hub exists — it is useful to siblings and to the web even with no hub.

```jsonc
// GET /api/island   (no auth; public, like /api/town)
{
  "id": "kestrel",                       // UW_TOWN_ID
  "name": "Kestrel",                     // UW_TOWN_NAME / town.name
  "pack": "kestrel",                     // UW_PACK key (island|kestrel|cairnhold|vinehaven|capital)
  "url": "https://kestrel.unwatched.world", // UW_ISLAND_URL (self-url)
  "harbors": [                           // parsed from UW_HARBORS
    { "id": "island", "url": "https://island.unwatched.world" },
    { "id": "cairnhold", "url": "https://cairnhold.unwatched.world" }
  ]
}
```

This differs from the existing `/api/town` (which returns live sim state: clock, places, laws,
children). `/api/island` is *identity + topology only* and changes rarely, so it caches hard.

### What the island pushes to the hub (all best-effort, all no-op if `UW_HUB_URL` unset)

1. **Self-register on boot.** After the `Town` is constructed and the server is listening, if
   `UW_HUB_URL` is set, `POST {UW_HUB_URL}/islands` with the `/api/island` body plus the secret.
   Fire-and-forget with a short `AbortSignal.timeout` (mirror the 4–10s timeouts already used in
   `harborTown`/`boatTo`). Failure logs a line and is otherwise ignored.
2. **Heartbeat + report-state, periodically.** Reuse the existing hourly cadence (`hourly()` in
   `engine.ts`, or the `town.hour !== lastHour` branch in `main.ts`'s `loop()`), plus optionally a
   lightweight timer. `POST {UW_HUB_URL}/islands/:id/state` with a small snapshot (population,
   day, weather, economy totals — see §6). Best-effort; a miss just makes the hub's view slightly
   stale.

### What the island pulls from the hub (all best-effort, all cached, all with a "hub absent" fallback)

- **Stance/policy toward a specific sibling**, consulted at the two existing crossing seams:
  - Passenger crossing: inside `boatTo(passenger, to)` in `main.ts` (called by the engine's
    `onDepart`), before POSTing to the sibling's `/api/boat/arrive`.
  - Cargo crossing: inside `sailCargo()` in `main.ts`, per harbor, before/after
    `/api/boat/wants` + `/api/boat/cargo`.
  Fallback: no policy → behave exactly as today (open crossing, no tariff).
- **Mainland policy** (prices/duties/edicts), consulted where the engine currently uses the
  abstract mainland: `merchants()`, `tourism()`, `sellToMainland()`/`ship(..., "the mainland")`,
  and the export prices in the pack (`pack.exports`). Fallback: no policy → the current hard-coded
  pack export prices and infinite buyer.
- **World events** (coordinated weather/edicts), consulted hourly. Fallback: none active → the
  island rolls its own weather and runs normally.

All pulls should be cached with a short TTL exactly like `harborStats` (60s) so a hub blip or a
slow hub never stalls a tick. Reads should tolerate a stale value; the tick loop must never
`await` a hub call on the critical path without a timeout.

## 5. The hub API contract

Small HTTP+JSON service. Three audiences: islands, the web, and admin/game actions. Auth in §16.

### 5a. Endpoints islands call

```jsonc
// Register (idempotent upsert). X-Hub: <secret>
POST /islands
Body: { id, name, pack, url, harbors: [{id,url}] }   // == GET /api/island body
-> 200 { ok: true }

// Heartbeat + state report. X-Hub: <secret>
POST /islands/:id/state
Body: {
  day: 128, weather: "rain", population: 22,
  minted: 5120, burned: 4030,           // engine counters, for economy view
  flourShortage: false,
  mayor: "Ana Ilić" | null,
  boat: { running: true, held: false }
}
-> 200 { ok: true }

// Directed stance/policy this island should honour toward a sibling.
GET /relations/:from/:to            // e.g. /relations/kestrel/island
-> 200 {
  stance: "rival",                   // ally | neutral | rival | enemy
  policy: {
    embargo: false,                  // refuse this sibling's cargo/passengers
    tariff: 0.15,                    // extra fraction taxed on crossings (0 = none)
    passengersBlocked: false         // refuse people specifically (vs goods)
  },
  asOf: 1737, ttl: 60
}
// Hub absent / 404 / error -> treat as { stance:"neutral", policy:{embargo:false,tariff:0} }

// Mainland policy the island's abstract-mainland code should apply.
GET /mainland/:islandId
-> 200 {
  buys: true,                        // is the mainland buying at all
  priceMultiplier: 0.8,             // scales pack.exports[].price
  duty: 0.1,                        // fraction skimmed on mainland sales (a tax)
  edicts: [ { id:"e12", text:"Grain requisition: the crown pays half for bread.", item:"bread", priceMultiplier:0.5 } ],
  asOf: 1737, ttl: 60
}
// Hub absent -> current behaviour: infinite buyer at pack.exports prices, no duty.

// Coordinated world events active for this island right now.
GET /events/:islandId
-> 200 { events: [
  { id:"hur3", kind:"weather", weather:"storm", untilDay:130, text:"A hurricane crosses the archipelago." },
  { id:"fest1", kind:"festival", season:"summer", text:"The Founders' Festival — all islands feast." }
] , asOf:1737, ttl:60 }
// Hub absent -> no events; island rolls its own weather.

// Conflict effects the hub has resolved and this island must apply (see §10).
GET /conflicts/:islandId
-> 200 { pending: [
  { id:"war7", against:"cairnhold", effects:{ populationLoss:2, treasuryLoss:120, buildingsDamaged:["market"], note:"Cairnhold's raiders struck the market." }, resolvedAt:1720 }
] }
POST /conflicts/:id/ack   Body:{ islandId }   // island confirms it applied the effect (idempotency)
-> 200 { ok:true }
```

### 5b. Endpoints the web calls

```jsonc
// The authoritative directory — powers the spectator switcher and pickers.
GET /world/islands
-> 200 { islands: [
  { id:"island", name:"The island", pack:"island", url:"https://island.unwatched.world",
    live:true, lastSeen:1737, day:128, weather:"clear", population:20 },
  { id:"kestrel", name:"Kestrel", pack:"kestrel", url:"https://kestrel.unwatched.world",
    live:false, lastSeen:1200, day:0, weather:"unknown", population:0 }
] }

// Aggregated archipelago state for the overview map (§9).
GET /world/map
-> 200 {
  islands: [ /* summaries as above, plus positions if the hub assigns them */ ],
  relations: [ { from:"kestrel", to:"island", stance:"rival", embargo:false, tariff:0.15 } ],
  conflicts: [ { id:"war7", a:"kestrel", b:"cairnhold", state:"active", since:1710 } ],
  mainland: { mood:"grasping", edicts:[ {id:"e12", text:"..."} ] },
  events: [ { id:"hur3", kind:"weather", islands:["island","kestrel"], untilDay:130 } ]
}

// One island's summary (for a detail panel; hub's cached view, not a live proxy).
GET /world/islands/:id
-> 200 { id, name, pack, url, live, lastSeen, day, weather, population, minted, burned,
         mayor, relationsOut:[...], relationsIn:[...] }
```

### 5c. Admin / game-action endpoints (privileged; §16)

```jsonc
// Set a directed relation and its policies.
PUT /admin/relations/:from/:to     X-Hub-Admin: <token>
Body: { stance:"enemy", policy:{ embargo:true, tariff:0.25, passengersBlocked:true } }
-> 200 { ok:true }

// Convenience wrappers (thin sugar over the above).
POST /admin/embargo   Body:{ from, to, on:true }
POST /admin/tariff    Body:{ from, to, rate:0.2 }

// Mainland edicts / pressure.
PUT  /admin/mainland/:islandId  Body:{ buys, priceMultiplier, duty, edicts:[...] }
POST /admin/mainland/edict      Body:{ islands:["island","kestrel"], text, item?, priceMultiplier? }

// Initiate military action; hub resolves and queues effects for both sides (§10).
POST /admin/conflict            Body:{ a:"kestrel", b:"cairnhold", kind:"raid", strength:0.4 }
-> 200 { id:"war7", queued:["kestrel","cairnhold"] }

// Trigger an archipelago-wide weather/event.
POST /admin/event               Body:{ kind:"weather", weather:"storm", islands:["island","kestrel"], untilDay:130, text:"A hurricane..." }
POST /admin/event               Body:{ kind:"festival", islands:"all", season:"summer", text:"Founders' Festival" }
```

## 6. Data model

Sketched as TypeScript interfaces; persistence in §17. Ids reuse the island `UW_TOWN_ID`
convention (`island`, `kestrel`, `cairnhold`, `vinehaven`, `capital`).

```ts
// The registry row — mostly the /api/island document plus liveness the hub maintains.
interface IslandRecord {
  id: string;                    // UW_TOWN_ID
  name: string;                  // UW_TOWN_NAME
  pack: string;                  // UW_PACK key
  url: string;                   // UW_ISLAND_URL (self-url)
  harbors: { id: string; url: string }[];
  // liveness + last reported state (from POST /islands/:id/state)
  lastSeen: number | null;       // wall-clock ms of last heartbeat
  day: number; weather: string; population: number;
  minted: number; burned: number; flourShortage: boolean;
  mayor: string | null;
  boat: { running: boolean; held: boolean };
  // optional, hub-assigned map layout (islands don't know their archipelago position)
  map?: { x: number; y: number };
}

type Stance = "ally" | "neutral" | "rival" | "enemy";

// Directed: A→B may differ from B→A. Key is the ordered pair.
interface Relation {
  from: string; to: string;
  stance: Stance;
  policy: {
    embargo: boolean;            // refuse this sibling's cargo/passengers entirely
    tariff: number;              // 0..1 extra taxed on crossings from `from` toward `to`
    passengersBlocked: boolean;  // block people but (maybe) not goods
  };
  updatedAt: number;
}

interface MainlandState {
  islandId: string | "*";        // per-island, or "*" for a world default
  buys: boolean;                 // will the mainland buy exports at all
  priceMultiplier: number;       // scales pack.exports[].price (1 = unchanged)
  duty: number;                  // 0..1 fraction skimmed on mainland sales
  edicts: MainlandEdict[];
  mood?: string;                 // flavour for the map ("grasping", "generous")
  updatedAt: number;
}
interface MainlandEdict { id: string; text: string; item?: string; priceMultiplier?: number; untilDay?: number }

interface Conflict {
  id: string;
  a: string; b: string;          // the two islands
  kind: "raid" | "blockade" | "war";
  state: "active" | "resolved";
  since: number;
  // resolved effects, queued per-island until each acks (idempotent application)
  effects: { islandId: string; populationLoss?: number; treasuryLoss?: number;
             buildingsDamaged?: string[]; note: string; acked: boolean }[];
}

interface WorldEvent {
  id: string;
  kind: "weather" | "festival" | "edict";
  islands: string[] | "all";
  weather?: string;              // for kind:"weather"
  season?: string;               // for kind:"festival"
  text: string;
  untilDay?: number;             // engine day on the *target* island(s); see caveat in §11
  createdAt: number;
}

// Optional: an archipelago clock. Deliberately advisory only (see §11 non-goal note).
interface ArchipelagoClock { day: number; note?: string } // NOT authoritative over any Town
```

Note on the archipelago clock: each `Town` keeps its **own** `day`/`t`, and with `UW_REAL_WORLD`
its own real calendar. The hub must NOT try to be the master clock. If an `ArchipelagoClock` ever
exists it is advisory flavour for the map only; event windows should prefer wall-clock or
"N hours from now" over a shared sim-day, or accept per-island day skew.

## 7. Feature: island registry / adding islands freely

- **Hub stores:** one `IslandRecord` per island; upserted by `POST /islands` on boot and refreshed
  by `POST /islands/:id/state`.
- **Island does:** serves `GET /api/island`; on boot, if `UW_HUB_URL` set, self-registers; then
  heartbeats state. All best-effort.
- **Web does:** `GET /world/islands` to build the picker/switcher and the map.
- **End to end:** spin up a container with `UW_PACK=vinehaven UW_TOWN_ID=vinehaven
  UW_HUB_URL=... UW_ISLAND_URL=...`; on boot it registers; within one heartbeat it appears in
  `/world/islands` and on the map. No redeploy of anyone else.
- **Degrades:** no hub → there is no dynamic registry; discovery falls back to the static
  `UW_HARBORS` list each island already has, and the web falls back to a static per-island URL
  index (§11). Adding an island then means editing configs, as today.

## 8. Feature: enemies — stance / embargo / tariff

- **Hub stores:** `Relation` rows (directed pairs). Set via `PUT /admin/relations/:from/:to` or the
  `embargo`/`tariff` sugar.
- **Island pulls:** `GET /relations/:self/:sibling`, cached 60s, consulted at the crossing seams.
- **Where it applies in real code:**
  - **Passengers** — in `boatTo(passenger, to)` (`main.ts`). Before POSTing to the sibling's
    `/api/boat/arrive`: if the pulled policy has `embargo` or `passengersBlocked`, return `false`
    (the boat "did not sail"). The engine's `sail()` already handles a `false` from `onDepart`
    gracefully — it refunds the `BOAT_FARE`, keeps the citizen on the pier, and emits
    `boat.dock` ("The boat ... did not sail today"). So an embargo reuses an existing, tested code
    path; the citizen simply can't leave for a rival.
  - **Cargo** — in `sailCargo()` (`main.ts`), per harbor: if `embargo`, skip that harbor entirely
    (don't even call `/api/boat/wants`). For a **tariff**, reduce what the shipping island books
    from the crossing. Cleanest: after the sibling returns `taken`, apply the tariff to the
    quantity/price passed to `town.ship(load, h.name)` — e.g. ship fewer units or a lower price so
    the harbor/owner nets less. (`ship()` already takes the 10% harbor cut; the tariff is an
    additional, hub-driven reduction layered on top, applied by the *sending* island honouring the
    policy toward `to`.)
  - **Arrivals from a rival** — the *receiving* island can also consult
    `GET /relations/:self/:from` inside the `/api/boat/arrive` and `/api/boat/cargo` handlers and
    refuse (respond 503/403) if it embargoes the sender. Because the crossing is authenticated by
    `X-Boat` and the passenger carries `from`, the receiver knows who's knocking.
  - **Rumour/news colouring** — a rival stance can be attached as flavour: when a passenger does
    arrive from a rival, the `boat.news` the engine already emits (`arrive()` emits
    `boat.news`) can be prefixed/toned by the stance. This is optional polish, not core.
- **Degrades:** no hub → `neutral`, no embargo, no tariff — i.e. today's fully-open mesh.
  Crucially, **the two-island-no-hub floor is unaffected**: with no hub there are no relations to
  honour.

## 9. Feature: the overview map

- **Hub stores:** the `IslandRecord`s (with last-reported day/weather/population/economy),
  `Relation`s, `Conflict`s, `MainlandState`, active `WorldEvent`s. Optionally a hub-assigned
  `map.{x,y}` per island since islands have no notion of their archipelago position.
- **Island does:** nothing new beyond the heartbeat in §4 — the map is pure aggregation of what
  islands already report.
- **Web does:** `GET /world/map`, render the archipelago: island tiles sized/labelled by
  population and weather, edges for relations (colour by stance), badges for active conflicts,
  a banner for mainland mood/edicts and world events.
- **Degrades:** no hub → no aggregated map. The web can still show a static list of islands from
  its config and, per island, hit each island's own `/api/town` and `/api/towns` directly (the
  latter already aggregates the caller's own view of its harbors). It's a weaker, non-authoritative
  view, but it works.

## 10. Feature: military action

Military is inherently two-sided, so the hub resolves it centrally and pushes effects to both
islands — an island can't be trusted to compute damage it inflicts on another.

- **Admin triggers:** `POST /admin/conflict { a, b, kind, strength }`.
- **Hub resolves:** computes effects for each side (population loss, treasury loss, buildings
  damaged) into a `Conflict` with per-island `effects[]`, each `acked:false`.
- **Island pulls:** `GET /conflicts/:self` (hourly). For each unacked effect, apply it locally via
  existing engine capabilities, then `POST /conflicts/:id/ack`:
  - **Population loss** → `town.removeAgent(id, "died", note)` for N agents (the engine already
    handles death: inheritance, funerals, `burned += coins`, life-book). Choosing *which* agents
    is the island's call (e.g. lowest-trust, or random via `this.rng` for determinism).
  - **Treasury loss** → subtract from a civic/harbor treasury (mirror how `fund` does
    `council.treasury -= spec.coins; this.burned += spec.coins`).
  - **Buildings damaged** → set `place.brokenUntil = this.day + days` (the engine already models
    broken places — see `produce()` and the fire code, and the `repair` action). A damaged market
    stops producing/selling until repaired, which naturally ripples through the economy.
  - Emit a news event (reuse an `emit(...)` with a war-flavoured kind/text) so citizens react.
- **Idempotency:** effects are keyed by `Conflict.id` + islandId; the `ack` marks them applied so a
  re-pull after a restart doesn't double-apply. If the island never acks (was down), the effect
  waits — it is not lost.
- **Degrades:** no hub → no military at all (there is no central resolver, and that's fine — it's a
  meta-game feature by definition). The core sim is untouched.

## 11. Feature: coordinated weather / archipelago events

The engine **already** supports an external weather feed: `weatherSource` is `"roll"` by default,
and `UW_REAL_WORLD` flips it to `"real"` (in `apps/server/src/realworld.ts`,
`town.weatherSource = "real"` and `town.setWeather(word, note)`), after which `hourly()` keeps
whatever weather was set instead of calling `rollWeather()`. The hub reuses this exact seam.

- **Admin triggers:** `POST /admin/event { kind:"weather", weather:"storm", islands, untilDay }`.
- **Island pulls:** `GET /events/:self` hourly. If an active `weather` event applies, set
  `town.weatherSource = "real"` (borrow the existing external-feed switch) and call
  `town.setWeather(event.weather, event.text)`. When the event ends, restore
  `town.weatherSource = "roll"` so the island resumes its own dice.
  - Storms already gate everything correctly and for free: `boatRunning = !boatHeld && weather
    !== "storm"`, and `merchants()`/`tourism()`/`produce()` all check weather. A hub-driven storm
    therefore halts crossings and outdoor production across every affected island at once — a real
    archipelago hurricane — with **no new engine code**.
  - **Conflict of feeds:** an island already using `UW_REAL_WORLD` owns its sky; the hub weather
    event should either be ignored there or be an explicit override with a clear precedence rule.
    Simplest: `UW_REAL_WORLD` islands ignore hub weather (real world wins); document it.
- **Festivals / shared season:** `kind:"festival"` can set `town.seasonOverride` (already exists)
  or surface as an `occasion` the minds see. Feasts are pack-defined (`pack.feasts`), so a truly
  shared festival is best expressed as a world event the perception layer mentions, rather than
  mutating packs.
- **Degrades:** no hub → each island rolls its own weather independently (today's behaviour, and
  the intended default — weather stays per-island unless the hub coordinates it). Nothing to undo.

## 12. Feature: the mainland as a real actor

Today "the mainland" is an infinite buyer/seller abstraction inside the engine: `ship(items,
"the mainland")` mints coins, `receive()` burns them, `merchants()` sells gluts to the mainland at
`pack.exports[].price` (minting `gross`), `tourism()` mints visitor spend, and `minted`/`burned`
are the books. The hub turns that abstraction into a controllable actor by feeding *inputs* to the
same code.

- **Hub stores:** `MainlandState` per island (or `*`): `buys`, `priceMultiplier`, `duty`,
  `edicts`.
- **Island pulls:** `GET /mainland/:self`, cached 60s, consulted where mainland trade happens.
- **Where it applies in real code:**
  - **Export price** — `merchants()` and `sellToMainland()`/`ship(..., "the mainland")` currently
    use `ex.price` from `pack.exports`. Multiply by the pulled `priceMultiplier`; an edict with an
    `item` overrides that item's multiplier. A low multiplier makes exporting unprofitable
    (`merchants()` already checks `buy >= ex.price` and bails on no spread — so a hub price cut
    naturally chokes merchant exports).
  - **Mainland refuses to buy** — `buys:false` → `sellToMainland()` and the mainland leg of
    `merchants()` become no-ops. Gluts pile up, prices fall via `price()`'s supply-and-demand,
    citizens feel it. This is real economic pressure with existing mechanics.
  - **Duty/tax** — a `duty` fraction skimmed on mainland sales: reduce the `gross`/`paid` credited
    in `ship()`/`merchants()` (and add it to `burned`, since those coins leave the island). This is
    the mainland "levying a tax."
  - **Tourism** — `tourism()` mints visitor coins from the mainland; a hostile mainland edict could
    scale visitor numbers or `SPEND_EACH` down. Optional.
- **Books stay honest:** all of this flows through the same `minted`/`burned` counters, so the
  economy remains auditable and the hub never mints coins itself — it only changes the *rate/price*
  at which the island's own code mints/burns.
- **Degrades:** no hub → the current infinite buyer at pack prices, no duty. Exactly today.

## 13. Feature: cross-island social (deferred, but this is its home)

Letters, relationships, and festivals between citizens of *different* islands span islands, so the
hub is where they belong when built. Sketch:

- The passenger model already carries memory, opinions, and news across the water (`arrive()`
  seeds a newcomer's memory from `p.memories`/`p.opinions` and emits `boat.news`). Cross-island
  *letters* extend this: a letter addressed to a citizen on island B is posted to the hub, which
  routes it to B (or B pulls its inbound letters). B delivers it through the existing
  `town.sendLetter(agentId, text)` path — the same path owner letters and the hourly
  `undeliveredLetters` replay already use.
- Cross-island relationships/festivals are richer and out of scope here; noted so the hub's data
  model can grow a `letters`/`social` collection later without rearchitecting.
- **Degrades:** no hub → no cross-island letters; intra-island letters and passenger-borne memory
  are unaffected.

## 14. Provocateurs, cross-island identity, notoriety & the fugitive problem

This is the section for a whole class of play the user wants: **seeding a person with a purpose**
and watching what actually happens as they move through the archipelago. The serial killer is the
sharp case; it generalises to **provocateur / influence agents** — a unionizer who tries to
sabotage a mill into a strike, a spy, an agitator, a missionary, a tycoon, an arsonist, a
smuggler, and things like them. The hub's job is to be the *stage* for cross-island consequence
(identity, reputation, relations, the world Gazette/map), never a command console.

### 14.0 Design invariants: staying on-thesis

Everything below must obey the base game's own **six rules** (README, "The six rules"). Restated
for this feature and treated as hard constraints:

- **A purpose is a seed, not a script — and never a command.** The player creates a person and
  gives them an inclination through the only levers the game allows: the **persona**, a **secret**
  (`a.secretsKnown` / persona), **standing instructions** (`a.instructions`), and **letters**
  (`town.sendLetter`). That is influence, not control. Per the README, *owners write letters, not
  orders.* The free-willed mind may **follow it, abandon it, subvert it, lose its nerve, be
  converted to the other side, or be diverted entirely** — sent to sabotage the mill, it meets
  someone, falls in love, and never touches it. **This is the desired behaviour and the source of
  delight, not a failure mode.** A "provocateur" is therefore never a reliable weapon; it is a
  **bet on a person** whose outcome you only learn from the morning digest.
- **The hub tracks emergent consequence, it does not guarantee intent.** The hub must add *no*
  mechanism that forces, nudges, or even measures whether a seeded agent "completed its mission."
  It records **what actually happened** (perceived deeds, reported verdicts, movement), never what
  was intended. There is no "mission progress" bar. The player controls only the setup and the
  letters; the world produces the rest.
- **Physics, not morality.** The engine already allows lying, stealing, quitting, leaving — and by
  extension sabotage (make/break actions, arson via the existing fire path, quitting to trigger a
  labour gap). The hub adds no morality layer and no "evil" flag; it adds *knowledge* and
  *consequence*, both imperfect.
- **No bans, only consequences.** The operator/hub never punishes a citizen. Punishment happens
  in-world: other citizens through `accuse → hearing → verdict`, other islands through their own
  choice to refuse entry. The hub is **Interpol, not a police force** — it can share a dossier or a
  wanted notice between willing jurisdictions, but it cannot make a sovereign island act. (This is
  exactly our core invariant: islands stay authoritative; the hub only feeds inputs they choose to
  honour.)
- **Nothing is known unless perceived.** Guilt is not globally visible. An unwitnessed, unsolved
  killing is a body and a mystery, not an attributed crime. Knowledge spreads only through
  perception, rumour, letters, and *reported* verdicts.
- **The digest is the product.** The whole point of this feature is that a bet on a provocateur —
  triumph, betrayal, or the mill-saboteur who fell in love instead — **changes what an owner reads
  tomorrow.** If a hub mechanism here wouldn't surface in someone's digest or the Gazette, it's
  decoration and shouldn't be built.

### 14.1 The general pattern: seed an agent, watch the world answer

The loop for any influence agent is the same, and it is entirely emergent:

```
player seeds a person  (persona + secret + instructions + letters, via the normal owner tools)
        │
        ▼
the free mind acts of its own will  (may pursue the purpose, may divert — fall in love, settle,
        │                             lose nerve, defect; the engine is physics, not a plot)
        ▼
an event may emerge locally  (a killing; a mill sabotaged and a strike; a conversion; nothing)
        │   — perceived by whoever was there; witnesses remember; the Gazette may print it
        ▼
consequences ripple:  local law (accuse→hearing→verdict), the local economy (a broken mill
        │             stops producing via brokenUntil; wages/prices move), and —
        ▼
via the hub (if present):  the person's dossier gains a travel entry and, if a verdict was
        │                  reported, a wanted notice; the world map/Gazette reflects it;
        │                  relations between islands may shift (an island harbouring a known
        ▼                  saboteur becomes a rival of the island he wrecked)
it shows up in the digest.  The owner reads what their bet actually became.
```

Worked example — **the unionizer/saboteur**: an owner seeds a citizen whose secret is "organise
the mill hands, and if they won't listen, wreck the mill." Sent to an island with a bakery/mill,
the agent *might* work the room, foment a walkout, and quit-cascade the workforce (quitting is
allowed physics); *might* set a fire (the engine already models fire and `brokenUntil`, halting
`produce()` at that place and rippling through `cart()`/`price()`); or *might* meet a baker, fall
in love, and quietly become the most reliable hand in the shop. The origin island perceives
whatever actually happened. If a sabotage is witnessed and prosecuted, a verdict is reported to the
hub; the mill's outage shows on the world map's economy view; the owner reads it tomorrow. **Nobody
scripted which of these occurred.**

### 14.2 Identity persists cheaply; deeds do not travel

Every citizen already has a **globally-unique id**. The engine mints ids with an island prefix
precisely so a shared record can never collide (`engine.ts`: *"Letters that go into every new
citizen's id, so two islands sharing one record can never mint the same person"*;
`ag_${idPrefix}${n}`). That id is the natural, cheap key for a cross-island identity.

What crosses the water with a passenger (`passengerOf()` → `arrive()`): **persona, appearance,
owner, coins, inventory, compressed memories, opinions, standing instructions, `why`, proven
skills, and a few news headlines.** What does **not** cross: the person's **deeds**. The origin
island's event record — the killings, the fire, the theft — **stays on the origin.** So an
arriving provocateur is literally a stranger: `arrive()` seeds the memory *"I came here from
{origin} ... Nobody here knows me."* Trouble "follows" them today only because the **same persona,
secret, and instructions keep driving the same behaviour**, not because their rap sheet travels.

This is the seam the hub fills: a persistent **cross-island dossier keyed by the citizen id** —
travel history and *reported* crimes — that exists **above** the islands, since no single island
can see another's event log. Crucially the dossier records **movement and reported outcomes**, not
raw deeds and not intentions.

### 14.3 Knowledge spreads imperfectly — the slick part

The design deliberately separates two very different things the hub could know:

- **(a) Identity & movement — cheap and near-omniscient *if islands opt in*.** If islands report
  arrivals/departures (`arrive()` / the `sail()` departure both already emit events the server can
  forward), the hub can know *who sailed where and when* — a travel history per id. This is
  bookkeeping, not surveillance of the soul.
- **(b) Awareness of guilt — expensive and always partial.** Guilt is not knowable from movement.
  It requires **detection + reporting**. An unwitnessed, unsolved killing is, per "nothing is known
  unless perceived," a dead body and a mystery. Attribution comes only from:
  - **Witness memory** — the engine already records witnesses (e.g. `removeAgent` writes memories
    to those who knew the departed; deeds near a person are perceived and remembered).
  - **Rumour and news carried by the boat** — slow and patchy. `arrive()` already turns
    `p.news`/opinions into rumour; `remember(..., "rumor")` degrades as it passes.
  - **Letters** — cross-island once §13 exists.
  - **Reported verdicts** — if and only if islands opt into hub law-sharing: a conviction from the
    existing `accuse → hearing → verdict` path (the engine has `accuse`, hearings/`gather`,
    fines, and `removeAgent(..., "exiled")`) is reported to the hub, which can raise a **wanted
    notice**.

So notoriety travels at **boat/rumour speed** by default, and only jumps to **hub speed** for
islands that opted into law-sharing *and* only for **attributed** crimes.

### 14.4 Model suspicion, not a binary "killer" flag

The "trouble follows him, so he's obviously the cause" problem should be a **clue with false
positives**, not an auto-flag — that's the fun. Model a per-`(island, person)` **suspicion score**:

- **Rises** with correlation the island can actually perceive: bad events near this person, a spike
  in deaths/fires/thefts after this person arrived (the island can compute this from its own event
  record and arrival times — no hub needed), plus witness memories and rumour weight.
- **Decays** over time (like trust drifts toward indifference in `hourly()`), and can be rebuilt: a
  provocateur can lie low, change MO, and earn trust back.
- **Is imperfect:** recognition by witnesses is fuzzy (appearance/persona, not a global ID lookup),
  and an innocent who merely arrived before a bad harvest can be wrongly suspected. False positives
  are a feature.
- **Above a threshold**, suspicion feeds the **existing** machinery rather than a new punishment:
  it makes an `accuse` more likely (a suspicious citizen is who someone drags to the council), which
  runs the normal `hearing → verdict`. If convicted, *then* — and only for opted-in islands — the
  island reports the verdict to the hub, which posts a wanted notice.

The suspicion score is **island-local** (each island computes its own; it is perception, and
perception is local). The hub may *aggregate* reported suspicion for a "most wanted" view, but it
never manufactures guilt.

### 14.5 Consequences: per-person notices and cat-and-mouse

- A hub **wanted notice** is a **per-person embargo**, distinct from the per-island embargo of §8.
  An island that has opted into hub law enforcement pulls the wanted list and **may** refuse a
  flagged arrival, or arrest on arrival (deliver them straight to a hearing), or do nothing —
  island's choice. Refusal reuses the existing `onDepart===false` / `/api/boat/arrive` 503 path
  (§8): the fugitive simply can't land, or lands into custody.
- **Beatable both ways (the cat-and-mouse):**
  - *The fugitive can outrun his reputation.* Notoriety travels at boat/rumour speed; a killer who
    keeps moving fast can stay ahead of the news — **until** the hub's wanted-list (faster than
    boats) catches up, and only on islands that opted into enforcement.
  - *The world can catch him.* Opted-in islands share notices faster than he can sail.
  - *Without a hub*, reputation travels **only** by boat/rumour — looser, patchier, and the minimal
    two-island floor still works. He can lie low, rebuild trust, change his MO; witnesses
    misremember.
- **Ripples to relations and the map:** an island that knowingly harbours a convicted saboteur who
  wrecked island B may become B's **rival/enemy** (a §8 relation an admin sets, or a future
  hub rule proposes) — and that shows on the overview map (§9). Mainland (§12) and military (§10)
  are the heavier consequence engines a serious cascade can escalate into.
- **Optional flavour:** a "constable/inquisitor" persona or a hub analytic can *surface* suspicion
  for a human/game-master to consider — but it only ever surfaces; it never auto-punishes.

### 14.6 "Would the hub be aware of him?" — the explicit answer

By **default**, only through what islands **report**:

1. **Identity & movement:** yes, *if* arrival/departure reporting is on — the hub can see this id
   sailed origin → A → B → C. That's a travel history, not a conscience.
2. **Guilt:** no, unless a crime was **detected and reported**. An unsolved killing never reaches
   the hub. A **convicted** one (verdict reported by an opted-in island) becomes a wanted notice.
3. **Suspicion:** the hub can *correlate across the travel history* ("deaths spiked on every island
   right after this id arrived") to raise a **probabilistic** suspicion for a most-wanted view —
   **never proof.** This correlation is exactly the slick "trouble follows him" signal, and it can
   be wrong.

End-to-end and its degradation:

```
seed provocateur ─▶ he acts (or diverts) ─▶ island perceives deeds ─▶ [witness? accuse? verdict?]
   │                                              │                         │
   │ (owner tools only)                           │ island-local suspicion  │ opted-in → report
   ▼                                              ▼ score (no hub needed)    ▼ verdict/arrival to hub
 nothing forced                         rumour/news ride the boat      hub dossier + wanted notice
                                                   │                         │
                                                   ▼                         ▼
                                        other islands hear slowly     opted-in islands may refuse/
                                        (boat speed, patchy)          arrest on arrival (per-person
                                                                      embargo), map/Gazette update
   HUB ABSENT: the entire right column vanishes. No dossier, no wanted list, no cross-island
   correlation. Reputation travels ONLY by boat/rumour; each island suspects on its own record.
   The two-island-no-hub floor is unchanged.
```

### 14.7 Hub API & data-model additions

Consistent with §5/§6 and the peer/boat model. All island→hub reports are best-effort and no-op
without `UW_HUB_URL`; all reads are cached with a "hub absent" fallback.

```ts
// A cross-island dossier, keyed by the engine's globally-unique agent id.
interface PersonRecord {
  id: string;                         // ag_<prefix><n> — the real engine id
  aliases: string[];                  // persona names seen (they can differ if a persona is edited)
  appearance?: Record<string, unknown> | null;   // for imperfect recognition, not a global lookup
  owner: string | null;
  travel: { island: string; arrivedAt: number; departedAt?: number; why?: string | null }[];
  reportedCrimes: {                   // ONLY attributed via verdict/attributed death; never raw deeds
    island: string; kind: string; verdict: "convicted" | "cleared" | "fined" | "exiled";
    text: string; at: number;
  }[];
  wanted: { by: string[]; since: number; note: string } | null;   // islands that posted the notice
  // per-island suspicion the hub has been TOLD about (island-local scores; hub only aggregates)
  suspicion: { island: string; score: number; asOf: number }[];
}
```

```jsonc
// Island → hub reports (opt-in; all no-op without UW_HUB_URL). X-Hub: <secret>
POST /persons/:id/arrival    Body:{ island, at, from, why }         // movement in
POST /persons/:id/departure  Body:{ island, at, to, why }           // movement out
POST /persons/:id/verdict    Body:{ island, kind, verdict, text, at } // from accuse→hearing→verdict
POST /persons/:id/suspicion  Body:{ island, score, asOf }           // island's own local score
-> 200 { ok:true }

// Island ← hub reads (best-effort, cached; hub absent -> empty/none).
GET /persons/:id             -> 200 PersonRecord         // full dossier
GET /wanted                  -> 200 { wanted:[ { id, aliases, by:[...], note, since } ] }
// An opted-in island consults /wanted (or GET /persons/:id) in its /api/boat/arrive handler and
// MAY refuse (503) or arrest-on-arrival. Never forced. Hub absent -> list empty -> admit as today.

// Web / admin views.
GET  /world/wanted           -> 200 { wanted:[...] }     // the "most wanted" board
GET  /world/persons/:id      -> 200 PersonRecord         // a person's cross-island dossier panel
// Admin may post a wanted notice or clear one (privileged; §16). The hub NEVER auto-convicts.
PUT  /admin/persons/:id/wanted   Body:{ by:[...], note } | null
```

Notes that keep this on-thesis and consistent:

- The hub **stores** movement, reported verdicts, and aggregated suspicion; it **never** stores raw
  intent or a "mission" and **never** computes guilt itself. Cross-island suspicion correlation is
  a *read-time analytic* over `travel` + `reportedCrimes`, surfaced for humans, marked
  probabilistic.
- **Enforcement is always the island's choice** — the wanted list is an input honoured or ignored,
  exactly like a §8 relation. This preserves island sovereignty, our core invariant.
- **Everything degrades to nothing without the hub:** no dossier, no wanted list, no cross-island
  correlation; reputation reverts to boat/rumour only; each island still suspects and prosecutes on
  its own perceived record. The two-island floor is untouched.

## 15. Reachability & the spectator switcher

"Teleport" here means a **spectator hop only**: the human picks an island and is taken to that
island's opening view to watch, and can switch freely. It is not directing a citizen to sail
(that's the boat/passenger system). Two reachability models; which applies depends on whether a
hub is present.

### Model A — one world URL + in-app picker (natural *with* a hub)

- One public origin (e.g. `world.unwatched.world`) serves the web app. The app calls
  `GET {UW_HUB_URL}/world/islands` for the authoritative directory and shows a picker/map. Picking
  an island loads that island's opening view, pointing the app's data calls at the island's `url`
  (from the registry) or through a hub proxy.
- **Trade-offs:**
  - *CORS:* if the app calls each island's `/api/*` directly from one origin, every island must
    send permissive CORS (they already do: `app.use("/api/*", cors())`). Alternatively the hub
    *proxies* island reads so the browser only ever talks to one origin — more hub load, simpler
    browser story, and the hub can add caching.
  - *Ingress/hostnames:* one hostname for the app; islands need reachable urls (their
    `UW_ISLAND_URL`) but not necessarily their own public hostnames if the hub proxies.
  - *Tunnels:* fits the fleet's Switchboard-tunnel pattern — one tunnel for the world door, or one
    per island if proxied.
  - *Auth:* one sign-in at the world door. Note the existing per-island auth (`ownerOf`, Supabase
    JWT / `X-Owner`) is unchanged; spectating is read-only public data, so it needs no auth at all.

### Model B — five separate URLs + static index (pragmatic *without* a hub)

- Each island is its own origin (`island.unwatched.world`, `kestrel...`, etc.), each serving its
  own web app against its own server. A tiny static `index.html` links to all five.
- **Trade-offs:**
  - *CORS:* mostly avoided — each app talks to its own same-origin server. Cross-island reads (a
    switcher that peeks at siblings) still need the islands' existing `cors()`.
  - *Ingress/hostnames:* one hostname per island (five DNS records / tunnels). More moving parts,
    but each island is fully independent.
  - *Tunnels:* one tunnel per island (matches "island in its own container").
  - *Auth:* per-island sign-in as today. A spectator just opens each URL.
- The switcher degrades to a hard-coded list of island URLs (or the `UW_HARBORS`/`/api/towns` a
  given island already knows about). No hub required — this is the floor.

### Recommendation

- **No hub / minimal deployment:** Model B. It is the honest floor: five URLs, a static index,
  each island independent. Don't build a directory you don't need.
- **Hub present:** Model A, with the hub as the directory and (optionally) a read proxy. One world
  door, one picker/map, spectate anywhere. Prefer proxying island reads through the hub only if
  CORS or hostname sprawl becomes painful; otherwise direct browser→island reads (islands already
  send CORS) keep the hub thin.
- Either way, `GET /api/island` on each island is the shared primitive: Model B's static index and
  Model A's registry are both built from it.

## 16. Security / auth

- **Island↔hub:** a shared secret `UW_HUB_SECRET`, sent as `X-Hub`, exactly mirroring the existing
  `UW_BOAT_SECRET`/`X-Boat` pattern (see the boat handlers: `c.req.header("x-boat") !==
  BOAT_SECRET → 403`). Register/heartbeat/report and any island-authenticated pulls carry it. If
  unset, the hub should refuse state-changing pushes (register/report) while still allowing public
  reads — mirroring how a harbor with no `BOAT_SECRET` refuses arrivals.
- **Admin/game actions** (`/admin/*`): a *separate*, stronger credential (`X-Hub-Admin` token),
  never the same as `UW_HUB_SECRET`. Only the operator (Phil) or an authorised game-master UI may
  declare wars, set embargoes, or issue edicts. Keep it out of any island's env.
- **Web reads** (`/world/*`): public, read-only, no secret — they expose only what islands already
  publish via `/api/town`.
- **Trust boundary:** the hub is semi-trusted by islands, but islands *choose* to honour its
  inputs and clamp them (a tariff is 0..1, a price multiplier is bounded, population loss is capped
  at the island's own population). A compromised hub can grief the meta-game but must not be able to
  corrupt an island's core invariants (it can't mint coins, can't set the clock, can't force-remove
  more agents than exist). Validate every pulled value before applying, the way the boat handlers
  validate manifests with `zod`.

## 17. Persistence

The hub is small — a registry, a relations table, a mainland-state table, a conflicts table, an
events table. Follow fleet convention (like other small fleet services): **sqlite** via the
stdlib, or a plain JSON file for the very first cut. No heavy datastore. The engine already has a
`FileStore` fallback pattern (`out/town/<id>.json`) for exactly this "small, local, durable"
shape; the hub can do the same (`hub.db` or `hub.json`).

State is authoritative for *meta* only. If the hub's DB is wiped, islands keep running (they never
depended on it); relations/mainland/conflicts reset to defaults (neutral/open) and can be
re-declared. So the hub's durability requirement is "nice to have," not "data-loss-forbidden" —
unlike the islands' own records.

## 18. Failure modes

- **Hub down / absent (the big one):** every island call is best-effort with a short timeout and a
  cached fallback (the `harborStats` 60s-cache pattern). No hub → registry falls back to
  `UW_HARBORS`; relations fall back to neutral/open; mainland falls back to pack prices; weather
  falls back to `rollWeather()`; military and world events simply don't happen. **The peer mesh and
  the two-island floor are completely unaffected.** This is the invariant that must be tested.
- **Stale data:** pulls are cached with a TTL; an island may honour a slightly out-of-date stance
  or price. Acceptable — meta-game state need not be instantaneous. Never block a `tick()` on a
  live hub call.
- **Split brain / partial connectivity:** island A can reach the hub, B can't. A honours a new
  embargo, B doesn't yet. This is self-healing: B picks it up on its next successful pull. Directed
  relations make this tolerable (each island only ever needs *its own* outbound policy). Effects
  that must be symmetric (military) are queued per-island with ack, so a temporarily-disconnected
  island applies its share when it reconnects — nothing is lost, nothing double-applies.
- **Hub sends bad/hostile data:** validate and clamp every pulled value (zod schemas, bounded
  ranges) before applying. Reject anything that would violate a core invariant.
- **Island unreachable to hub:** its `lastSeen` goes stale; the map shows it as not-live (like
  `/api/towns` already shows `live:false` for islands with no word). No crash.

## 19. Phasing

Each phase is independently shippable and leaves the no-hub floor intact.

### Hub v1 — registry + discovery + read-only overview
- **Island:** add `GET /api/island` (landing now); add `UW_HUB_URL`/`UW_ISLAND_URL`/`UW_HUB_SECRET`;
  self-register on boot + heartbeat `POST /islands/:id/state`; all no-op without `UW_HUB_URL`.
- **Hub:** `POST /islands`, `POST /islands/:id/state`, `GET /world/islands`, `GET /world/map`
  (read-only aggregation), `GET /world/islands/:id`. sqlite/json store.
- **Web:** spectator switcher / picker (Model A) built on `GET /world/islands`; static-index
  fallback (Model B) documented.
- **Value:** add islands freely; one world door; overview map. Zero risk to the sim.

### Hub v2 — diplomacy (relations + embargo/tariff)
- **Hub:** `Relation` store; `GET /relations/:from/:to`; `PUT /admin/relations/:from/:to` +
  embargo/tariff sugar.
- **Island:** pull stance in `boatTo()` (block/allow passengers — reuses `sail()`'s existing
  `onDepart===false` path) and in `sailCargo()` (skip harbor on embargo; reduce booked crossing on
  tariff); optionally consult relations in the `/api/boat/arrive`/`/api/boat/cargo` handlers to
  refuse rivals. Cache 60s; neutral fallback.
- **Web:** relation edges on the map; admin controls to set stance.

### Hub v3 — mainland as actor
- **Hub:** `MainlandState` store; `GET /mainland/:islandId`; `PUT /admin/mainland/:islandId` +
  edict endpoint.
- **Island:** pull mainland policy; apply `priceMultiplier`/`buys`/`duty` in `merchants()`,
  `sellToMainland()`/`ship(..., "the mainland")`, and optionally `tourism()`. All through existing
  `minted`/`burned` bookkeeping; pack prices as fallback.
- **Web:** mainland mood/edict banner on the map; admin edict controls.

### Hub v4 — military + coordinated events + cross-island social
- **Hub:** `Conflict` + `WorldEvent` stores; `GET /conflicts/:islandId` + ack; `GET
  /events/:islandId`; `POST /admin/conflict`, `POST /admin/event`; (later) cross-island letter
  routing.
- **Island:** apply conflict effects via `removeAgent("died")` / treasury debits / `brokenUntil`
  (with ack idempotency); apply world weather via the existing `weatherSource="real"` +
  `setWeather()` seam; (later) deliver cross-island letters via `sendLetter()`.
- **Web:** conflict badges, world-event banners, war/festival controls.

### Hub v5 — cross-island identity, dossiers & notoriety (§14)
- **Hub:** `PersonRecord` store keyed by engine agent id; arrival/departure/verdict/suspicion
  reports; `GET /persons/:id`, `GET /wanted`; read-time cross-island suspicion correlation;
  `GET /world/wanted` + `GET /world/persons/:id`; `PUT /admin/persons/:id/wanted`. The hub never
  auto-convicts and stores no intent.
- **Island (all opt-in, no-op without `UW_HUB_URL`):** forward arrival/departure events; compute a
  local per-person suspicion score off its own event record + arrival times; drive the existing
  `accuse → hearing → verdict` path from suspicion; report verdicts; consult `/wanted` in the
  `/api/boat/arrive` handler and **optionally** refuse/arrest (per-person embargo, reusing §8's
  refusal path). Every step degrades to boat/rumour-only when the hub is absent.
- **Web:** a "most wanted" board; a person's cross-island dossier panel; provocateur outcomes
  surfaced in the Gazette/map. This is the payoff phase for the "seed a person, read what they
  became" play.

## 20. Non-goals & invariants

- **Never break the no-hub minimal case.** "2 islands and nothing else, no hub" must always work
  and must never require the hub. This is the acceptance test for every change here.
- **The hub never runs simulation.** No `Town`, no clock the sim obeys, no minting of coins, no
  agents. It stores meta-state and aggregates; islands simulate.
- **Islands remain authoritative over their own sim.** The hub feeds *inputs* (a stance, a price, a
  weather value, a resolved war effect); the island applies them through its own existing code and
  is free to clamp/validate/refuse. The hub cannot reach into a `Town`.
- **No new hard dependency on the network.** Every hub interaction is best-effort, time-boxed,
  cached, and has a defined fallback. A `tick()` never blocks on the hub.
- **Don't route the boats through the hub.** Passengers and cargo keep flowing island → island
  directly over the existing peer endpoints. The hub is a directory/policy/aggregation layer
  beside that flow, not a broker in it.
- **The hub is not the master clock.** Each island keeps its own time; any archipelago clock is
  advisory flavour only.
- **Auth stays layered.** `UW_HUB_SECRET` (island↔hub) is distinct from the admin token
  (game actions) and from per-island owner auth (Supabase/`X-Owner`), which is untouched.
- **A given purpose is a seed the free-willed mind may follow or abandon.** The player controls
  only the setup (persona/secret/instructions) and the letters — never the outcome. A provocateur
  (killer, saboteur/unionizer, spy, agitator, missionary, tycoon, arsonist, smuggler) is a **bet
  on a person**, not a weapon: sent to sabotage the mill, they may fall in love and never touch it.
  That divergence is the point. Owners write letters, not orders (README).
- **The hub tracks emergent consequence, never intent.** It must add no mechanism that forces,
  scores, or even measures whether a seeded agent carried out its purpose. It records what actually
  happened (perceived deeds, reported verdicts, movement), and stays **Interpol, not a police
  force** — it shares dossiers/wanted notices between willing islands but cannot make any island act.
- **Guilt is perceived, never omniscient.** The hub knows identity and movement only if islands
  report them, and guilt only from detected-and-reported verdicts. Cross-island suspicion is a
  probabilistic read-time analytic, never proof — false positives are a feature.
- **Every hub feature must reach the digest.** Per the sixth rule, if a hub mechanism wouldn't
  change what an owner reads tomorrow (or the Gazette/map), it's decoration and shouldn't be built.
```
