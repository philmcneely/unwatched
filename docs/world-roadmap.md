# World roadmap

A design and backlog document for the multi-island world of `unwatched`. It records
what the world model **actually is** today (grounded in the engine, server and
renderer as of 2026-09-14), the known gaps Phil has called out, and a prioritized
plan for making the islands feel like distinct, living places with a real economy.

Every item here is measured against the six rules — a feature that does not change
what an owner reads tomorrow is decoration, and a feature that lets the operator
command outcomes is against the point.

---

## 1. Purpose & the six rules

Unwatched is a persistent set of islands of AI citizens with free will. Each citizen
is owned by one person who writes **letters, not orders**, and reads a **digest** each
morning of what happened while they were away. The island runs in real time under the
live sky of a real coast whether or not anyone watches.

Every roadmap item below must stay on-thesis. The load-bearing rules (`README.md`):

1. **The engine is physics, not morality.** It stops you walking through walls and
   spending coins you do not have. It does not stop lying, stealing, quitting, or
   leaving. Weather, fire and a bad harvest are physics too.
2. **Everyone gets the same seconds.** One sim minute is one real minute. Money buys a
   more thoughtful mind, never a faster one.
3. **Credits are never coins.** Credits pay for *thinking*; coins are earned *on the
   island*. There is no path between them.
4. **Nothing is known unless it was perceived.** A citizen knows what they saw or were
   told; owners see what their person knows.
5. **No bans, only consequences.** The operator does not punish citizens; other
   citizens do, through the town's own laws.
6. **The digest is the product.** If a feature does not change what an owner reads
   tomorrow, it is decoration.

Two consequences shape everything downstream:

- **Influence, not command.** Owners nudge with letters; the engine never lets an owner
  force a deed. New systems (housing, banks, land markets) must be things citizens *do*,
  legible in the digest — not levers the operator or owner pulls directly.
- **Credits ≠ coins.** No economy feature may open a path from paid credits to island
  coins. A "very rich" agent is rich in *coins* the island can mint/burn, never in
  credits.

---

## 2. Current world model (grounded, accurate)

Everything in this section was read from the code. Line numbers are approximate and
point at `packages/engine/src/engine.ts` unless noted.

### Needs
An agent has exactly **three** needs: `hunger`, `rest`, `social`
(`addAgent`, ~L192: `needs: { hunger: 0.3, rest: 0.2, social: 0.4 }`). They decay each
minute in `decayNeeds` (~L1686). **There is no thirst and no water resource of any
kind** — nothing to drink, no wells or springs as a need-source. (A `well` prop exists
in the renderer as decoration only.)

### Food
Eating drops hunger (`agent.eat`, ~L667: `hunger -= 0.6`). Food is sold on shelves at
the inn, bakery, market, fish house, etc.; produce (`grain`, `apples`, `fish`,
`flour`, `bread`, and pack-specific goods like `wine`, `figs`, `iron`) is made at
workplaces per the pack's `produce` spec and moved by the 6 o'clock cart along
`supply` lines. Feasts and weddings feed the whole crowd.

### Jobs & wages
Jobs come from the pack (`makeJobs`). Wages are paid nightly (`payWages`-style loop,
~L1014–1035), skipped on Sundays:
- An **owned** place: the owner pays the employee's wage out of the owner's coins.
- An **unowned** place: the wage is paid out of the place's `treasury`.
- The **mainland** pays an unowned workplace/harbor ~`1.25×` the shift cost as a
  handling fee for a day's work that makes something the boat can carry (~L1023,
  `this.minted += paid`).
- `prosper()` (~L1340): an unowned business with a fat till raises its wage and opens
  more slots (bounded), and reverts when takings fall. Owners set their own terms.
- A town `tax` rule skims a percentage of each wage into the council treasury.

### Ownership & building
`place.owner` is the single ownership field. A citizen owns a place by **building** on
a free `plot`:
- `build` (~L687): pays `BUILDS[kind].coins` (to the council treasury, minus a planks
  cost paid to the sawpit/its owner), marks a **site** with a labor requirement.
- Each morning of work advances the site; when finished (`finishSite`, ~L1250) the plot
  becomes a real place and **`here.owner = site.by`** (the builder), unless it is a
  community garden (owner stays `null`).
- A finished **house**: `kind: "home"`, `beds: { price: 2, capacity: 2 }`, and the
  builder is homed there permanently (`nightsPaid: 36500`).
- A finished **shop**: `kind: "shop"`, a default shelf, and a `help` job at wage 2.

Ownership carries income: bed rent, employees' takings, shelf sales, and the harbor
owner collects boat fares.

### Rent, arrears & eviction
Sleeping in a bed charges `bedPrice(place)` (~L817–827). The money goes to the bed's
**owner** (their coins) or, if unowned, the place's `treasury`.
- Your own home decrements `nightsPaid`; when it runs out you begin to accrue
  **arrears** (~L820: `owed = arrears + rent`, pays what it can above a 2-coin floor).
- Arrears that reach `bedPrice × 3` trigger **eviction** (~L1118–1127): the tenant is
  put out (`agent.evicted`), the unpaid arrears become a **debt to the landlord**, and
  the tenant's `roofless` counter climbs. Sleeping rough in winter can kill
  (`roofless >= 3 && starving >= 3`, ~L1132).

### Peer lending & debt
The `lend` action (~L881) creates a debt on the borrower with a due date
(`due = now + days`). Debts are surfaced in perception, come due with a nag
(`agent.debt`, ~L1142), and **grow while overdue** — a tenth a day, at least one coin,
capped at twice the principal (~L1148). Repayment is via `settle`/`give` coins
(~L637). Landlords whose tenant is evicted hold the arrears as a debt the same way.

### The mainland (abstract infinite buyer)
The mainland is not a place; it is a **sink/source that always buys**, tracked by two
counters, `minted` and `burned`, so the books balance:
- Each evening the morning boat ships each place's **surplus** (stock above what it
  keeps back, per `exports`) to the mainland at export prices; those coins are
  **minted** into the island (`ship(..., "the mainland")`, ~L1460).
- Arrivals mint their coins; departures burn theirs (~L206, L281).
- Handling fees and tourism spend are minted; boat fares paid to another island are
  handled by the fare logic.

### Boat fares & inter-island travel
`BOAT_FARE = 2` (~L57). A traveller leaving for another island pays the fare up front
(capped at their coins, so being broke never strands anyone), refunded if the boat
cannot sail; a collected fare lands in the **harbor's** purse (owner's coins, else the
harbor's till) via `landFare` (~L1320). Passengers carry coins, inventory, skills and
memories across; the server wires islands together with `UW_HARBORS` and an optional
hub that can apply friction/tariff/blockade between islands.

### Merchants & trade houses (arbitrage)
A place is a **trade house** if a `*.merchant` job works it (`merchants()`, ~L1393,
runs at hour 7 before the mainland boat). The merchant buys **glutted export goods**
cheap off the island's shelves (only a real glut, `have >= target × 2`), ships them to
the mainland at the export price, and keeps the spread in the trade house's purse — which
then pays the merchant's wage the ordinary way. No trade in a storm. Every non-capital
pack seeds a `tradehouse`.

### Tourism
`tourism()` (~L1424, hour 10): day-trippers come when the boat crosses, drawn by the
island's **public and civic** attractions (a decorated attraction draws more; feast
days draw a crowd). They leave coins at the inn, the attractions, and the market;
their money is **minted** from the mainland, and what they don't spend goes home
unspent. No visitors in a storm.

### Supply & demand pricing
`price()` (~L1731) adjusts a shelf's base price by scarcity: a nearly-bare shelf
(`have <= ceil(target × 0.2)`) asks **+1**; a glut (`have >= target × 2`) asks **−1**;
market day is −1; a **flush** till (full treasury) shaves −1; a flour shortage doubles
bread; a town `cap` rule clamps it. Bounded so prices stay legible.

### Per-island rendering
`apps/web/components/World.tsx` seeds **each island's coastline** from its id/name
(~L159–167: an FNV hash drives three sine lobes → a unique wobbled outline), so no two
islands share a silhouette. Decorations are **clipped to land** (`inside()` test in
`plantTrees` and the prop loop, ~L278/L281), so nothing renders in the water. The
`pinewood` place gets a 22-tree forest (~L72).

### What is flavor, not a system
- **The capital's "bank"** (`island5.ts`): a `workplace` with `sells: []` and a
  `bank.teller` job (wage 3). You can *work* there; there are **no deposits, no
  interest, no loans**. It is set dressing plus a paycheck.
- **Wells, the "well" prop, the lighthouse, offshore rocks**: pure decoration.
- **No water/thirst**, **no land market** (you can only acquire land by building on a
  free plot; there is no buying/selling of existing owned places except inheritance),
  and **no central bank / money supply policy** beyond the mint/burn bookkeeping.

### The five packs at a glance
`packages/engine/src/packs/*.ts`. Home-kind places are scarce relative to the fixed
20-citizen seed:

| Pack (id) | `size` w×h | Places | Home-kind | Industry terrain today |
|---|---|---|---|---|
| island (`island`) | 3000×1800 | 32 | **1** | `pinewood`+`sawpit` (lumber), `quarry` (stone) |
| island2 (`kestrel`) | 2400×1600 | 23 | **1** | fishing/coast; no wood or mine place |
| island3 (`cairnhold`) | 2900×1800 | 35 | **4** | `quarry`, `ironadit`, `coalpit`, foundry/smithy (mining) |
| island4 (`vinehaven`) | 3000×1800 | 35 | **3** | `vineyard` → wine/oil/honey/figs |
| island5 (`capital`) | 3600×2200 | 39 | **4** | `bank` (flavor), exchange/academy/theatre |

Note the mismatch: even the biggest pack seeds **4 homes for 20 citizens**, and
`kestrel` seeds **1**. This is the root of the "everyone sleeps in the inn" bug below.

### Already in the game (don't rebuild)

Several ideas that come up as "features to add" are **already simulated**. Confirmed
against `packages/engine/src/engine.ts`; build *on* these, don't duplicate them.

- **Relationships, love & hate — EXISTS.** Every pair holds a relationship with
  `trust`, `affection` and a free-text `opinion` (~L230, L401), moved by `nudge()` as
  deeds land (a repaid debt lifts trust ~L637; a theft drops it and spreads as rumor to
  witnesses ~L650). Opinions travel as rumor. Perception shows nearby people's relation.
- **Partners, weddings, funerals — EXISTS.** `partnerOf`, a `wedded` set, and wedding /
  funeral **gatherings** the whole town attends (~L1850-1879); a death writes "the book
  of a life."
- **Children — EXISTS.** Children are born to partners into a home, grow up over
  `ageOfMajority` days, can be **adopted** (`adoptedBy`) or **orphaned**, and **come of
  age** (`town.of_age`, ~L1580) to become full citizens (`/api/children` exposes both
  growing and grown).
- **Entrepreneurship — EXISTS.** A free-willed citizen can bootstrap a business: `build`
  a shop on a plot and **own** it, `hire` staff, collect wages/rent/shelf-takings,
  `found_institution` (~L524), and run **merchant/trade-house arbitrage** on gluts
  (~L1393). *Gap*: no startup capital beyond peer `lend` — no bank loans yet (→ B4).
- **Education, as skills — PARTIAL.** There is a real learn/teach loop:
  `propose_skill`, `test_skill`, `practice_skill`, `share_skill`, and `teach` (gated by
  the `learning` flag), with skills carried between islands by travellers. This is
  de-facto education. *NEW* would be a dedicated **school** building and a formal
  literacy/education level (see A10).
- **"Smart vs dumb" citizens — PARTIAL, and mostly already expressible.** A citizen's
  cleverness is two existing things: (a) **persona traits** (warmth, honesty, ambition,
  etc., which drift with life events, ~L1762), and (b) the **mind tier** — credits buy
  a *more thoughtful model* (routine=Haiku, stakes=Sonnet, reflect=Opus; Patrons get
  Opus everywhere; `apps/server/src/main.ts` ~L56/L58). Per **rule 2/3**, a better mind
  is bought with **credits, never coins**, and never buys *faster* seconds. A separate
  in-world **intelligence stat** (distinct from traits and mind tier) would be NEW — and
  should be weighed carefully against the credits≠coins line.
- **Murder — does NOT exist (NEW).** Death occurs only from **starvation, cold, and
  age**; there is **no deliberate kill/attack/harm action** (verified: no such verb in
  `OPTIONS_DEFAULT` or the per-place options; theft is the strongest hostile act). See
  B11 — model it as **emergent**, per hub-design §14 (seed a provocateur, let violence
  and suspicion emerge, notoriety travels), not a scripted kill button.

---

## 3. Known bugs / gaps (reported by Phil, 2026-09-14)

### (a) Everyone sleeps in the inn
Every seeded citizen is created **homed at the inn** (`addAgent`, engine ~L194:
`home: { place: "inn", nightsPaid: 3 }`) and the server seed loop
(`apps/server/src/main.ts` ~L180) never assigns anyone a house. Combined with the tiny
home-kind counts above, the inn is a dormitory and **rent barely flows** — the whole
rent/arrears/eviction/landlord economy that already exists in the engine is almost
never exercised. The digest reads the same for everyone: "worked, ate at the inn, and
slept."

### (b) Population is fixed regardless of island size
`CITIZENS = Number(process.env.UW_CITIZENS ?? 20)` (`main.ts` ~L44) seeds a flat 20
people on **every** pack. `pack.size` and place counts vary widely (23→39 places,
2400×1600→3600×2200) but the population does not. A bigger island should carry **more
people and more stuff**; today the capital feels as empty as kestrel.

### (c) Decorations rendered in the water — fixed, but forests are not industry
Previously islands without a `pinewood` place placed the 22-tree forest at `{0,0}`
(the default from `decorFor`'s `at("pinewood")` fallback), and props could land in the
sea. **Fixed**: the per-island coastline seed plus the `inside()` land-clip now discard
anything off the land (a tree at `{0,0}` falls outside the island and is dropped). But
the fix is incidental clipping, not intent: forests should be **tied to the lumber
industry** (trees where a wood/sawpit exists) and the forest loop should be **guarded**
when `pinewood` is absent rather than relying on the clip.

### (d) All islands looked the same — fixed silhouettes, but flat terrain
**Fixed**: coastlines are now seeded per-island so silhouettes differ. But the
**ground still doesn't reflect industry** — a mining isle (cairnhold) has no hills or
mountains, a vineyard isle (vinehaven) has no vine rows, and `drawGround` treats every
pack the same. Islands differ in outline but not in character.

---

## 4. Roadmap / backlog

Sizes: **S** ≈ a focused change in one file; **M** ≈ a coordinated change across a
couple of layers; **L** ≈ a new subsystem or cross-cutting design. Layers:
**engine** (`packages/engine`), **server** (`apps/server`), **packs**
(`packages/engine/src/packs`), **renderer** (`apps/web/components/World.tsx` + `world/`),
**hub** (`docs/hub-design.md`).

### Group A — world realism (near-term)

| # | Item | Layer | Size | On-thesis notes | Depends on |
|---|---|---|---|---|---|
| A1 | **Population scales with island size.** Derive the seed count from `pack.size` / place count instead of a flat 20 (keep `UW_CITIZENS` as an override). Bigger island → more citizens, more shops stocked, more open jobs. | server (+ packs for targets) | S–M | Rule 6: a fuller capital changes every owner's digest. Same seconds for all — more people, not faster ones. | — |
| A2 | **Assign citizens to real homes at seed.** Give packs more home-kind places, then at seed distribute citizens across available homes (owner + `beds`, `nightsPaid` set) instead of homing everyone at the inn; leave the inn for the genuinely un-housed. | engine (`addAgent`/a new seat step) + server + packs | M | Unlocks the *existing* rent/arrears/eviction/landlord loop → real digest events (rent paid, fell behind, evicted). Physics not morality: eviction stays a consequence, not an operator act. | A1 (counts) |
| A3 | **Terrain reflects industry.** `drawGround` + `decorFor` read the pack: forests where there's a wood/sawpit (trees as the *lumber source*, not just dressing), hills/mountains where mining happens (cairnhold's quarry/adit/coalpit), vine rows for vinehaven, terraced fields, etc. Guard the pinewood forest loop when the place is absent. | renderer | M | Rule 1 flavor: the land shows the physics that's already simulated. Fixes bug (c)/(d) properly. | — |
| A4 | **Restaurants/eateries & more building types.** Beyond inn/tavern: an eatery/cookshop building type citizens can build and run, more `sells` variety, more "things to do" that produce digest-worthy moments. | engine (`BUILDS`, `finishSite`) + packs + renderer sprites | M | Rule 6: new places must generate readable events (a meal out, a new shop opening), not just map clutter. | A2 helpful |
| A5 | **Offshore rocks + lighthouse + bridge/causeway; distinct silhouettes.** Add a lighthouse on offshore rocks, a bridge/causeway where a pack declares one, and push the per-island silhouette further (bays, headlands) so islands are recognizable at a glance. | renderer (+ optional pack hints) | S–M | Pure atmosphere; keep it cheap and reduced-motion-safe. Decoration by rule 6 — batch with A3 so it ships alongside a substantive change. | A3 |
| A6 | **Double the capital's size.** Grow `island5` (`capital`): larger `pack.size`, more places, more homes, more people. The obvious first beneficiary of the population+homes-scale work — a capital that is visibly the biggest, busiest island. | packs + server (scaling) | M | Rule 6: a denser capital reads differently every morning. *Partly exists*: the capital is already the largest pack (3600×2200, 39 places, 4 homes), so this is "more of a thing that works," not new machinery. | A1, A2 |
| A7 | **"Cuba-shaped" / hand-tuned silhouettes.** Let a pack declare its own coastline shape (a long curved isle, an archipelago lobe) instead of a hash of its name. | renderer (+ pack coastline hint) | S–M | Atmosphere. **Already half-built**: `World.tsx` (~L159–167) *already* seeds each island's coastline from its id/name via an FNV hash → three sine lobes. The new work is exposing those wobble params (or an explicit outline) as **per-pack data** so a shape can be deliberately tuned, not just randomized. Extends A5. | A5 |
| A8 | **Terrain by region (mountains, hills, grasslands).** Generalize A3's "hills where mining" into a real terrain-by-region system: `drawGround` reads pack-declared regions (mountain / hill / grassland / marsh / vineyard) and paints them, so a mining isle has mountains, a farming isle has grassland, etc. | renderer (`drawGround`) + packs (region data) | M–L | Rule 1: the land shows the physics. Supersedes/absorbs A3 once regions are data-driven. Today `drawGround` treats every pack the same and has only an ad-hoc `hill` concept. | A3 |
| A9 | **National park (tourism draw).** A protected land-use that raises the island's tourism draw. | engine (`tourism()`) + packs + renderer | M | Rule 6: shows up as more visitors and more coins left behind. **Builds on an existing system**: `tourism()` (~L1424) already draws day-trippers to `public`/`civic` places (a decorated one draws more). A park is a new high-draw place kind; the draw loop already exists. Land-protection ties to the land model (B2). | A3, B2 |
| A10 | **Schools / formal education.** A dedicated **school** building plus a literacy/education level, on top of the existing skills system. | engine (place kind + a learn-at-school loop, an education stat) + packs + renderer | M–L | **PARTIAL — build on what's there.** The skills loop (`propose_skill`/`teach`/`share_skill`/`practice_skill`) is already de-facto education; a school could be where teaching concentrates. A separate **education level** is NEW. Keep it distinct from the credits-bought **mind tier** (rule 2/3): schooling is an in-world stat earned with time, not a better model bought with credits. Rule 6: a child learning to read is a digest moment. | — |

### Group B — economy / geopolitics depth (later)

| # | Item | Layer | Size | On-thesis notes | Depends on |
|---|---|---|---|---|---|
| B1 | **Housing market.** Make ownership/tenancy legible and tradeable: seed some landlords and tenants at start, let a house change hands, let a rich agent buy up housing and become a landlord at scale. Rent/arrears/eviction already exist — this makes them *visible and dynamic*. | engine (a buy/sell-place verb) + server seed | L | Physics not morality: a housing monopoly is a *consequence* citizens live with, surfaced in the digest, not something the operator forbids. | A2 |
| B2 | **Land ownership model.** Make "who owns what" first-class: commons vs private, a land market, and a clear default (today land is effectively unowned/"communist" — you only claim it by building). Tradeable deeds; legible in perception and digest. | engine + hub (cross-island norms) | L | Rule 4: ownership must be *perceived* to matter. Rule 5: disputes resolve through town laws, not bans. | B1 |
| B3 | **Fresh water as a resource.** Add a `thirst` need and wells/springs as sources; scarcity in dry seasons; ownership/hoarding of water as a genuine pressure and source of conflict. | engine (new need + resource + decay) | L | The biggest simulation gap. Rule 1: scarcity is physics. Rule 6: thirst/drought must produce digest events (a well runs dry, a fight over water), or it's not worth adding. | — |
| B4 | **Real banking.** Turn the capital's flavor `bank` into a system: deposits, interest, loans (beyond peer `lend`), possibly a central bank per mainland tied to the hub. | engine + hub | L | **Guard rule 3 hard**: bank balances are *coins*, never credits; interest mints/burns through the mainland books. Deposits/loans must show up in the digest. | hub v3, B2 |
| B5 | **Wealth shock / tycoon seed.** Seed a very rich agent (e.g. "5000 coins") and watch monopoly/tycoon dynamics emerge — buying land and labor, lending, cornering housing. Option to add anti-monopoly town laws, or just let consequences play out. | server seed (+ engine if anti-monopoly laws) | M | Rule 3: rich in *coins*, never credits — the mint accounts for the seed. Rule 5: any check on a tycoon comes from the town's laws, not the operator. Best *after* B1/B2 so there's something to monopolize. | B1, B2 |
| B6 | **Hub-driven geopolitics.** Lean on the existing hub seam (friction/tariff/blockade already wired in `main.ts`) for trade wars, alliances, migration waves between islands, and cross-island prices. | hub + server | L | Directed relations are already leaky-by-design (friction, not walls) — consistent with rule 1. | B2, B4 |
| B7 | **Buy wild land → farm.** A land market for **wild/unowned** tiles, plus letting a citizen build on wild land (a farm), not just on pegged plots. | engine (`build` on `kind:"wild"`, a claim/buy verb) + packs | M–L | Rule 1: turning wild land to farm is physics, and who owns it is a consequence. **Verified gap**: today `build` is offered **only** on `kind:"plot"` (engine ~L437); wild places allow `decorate`/forage but **cannot** be built on or bought. This is the buildable half of the land model (B2). | B1, B2 |
| B8 | **Fishing + overfishing.** Give the fishery a **stock that depletes with effort and recovers over time**, so sustained fishing crashes it (scarcity → prices → conflict), and it rebounds when rested. | engine (`produce()` + a per-resource stock) | M | Rule 1: a crashed fishery is physics; rule 6: the crash and recovery are digest events. **Verified NEW**: today `produce()` (~L1350) just *adds* `qty × weatherCut` to the fish house's stock each shift — the **source never depletes** (only weather stops it, and day-old fish goes stale on the shelf). No stock/quota on the sea itself. Same pattern would generalize to timber, ore, game. | — |
| B9 | **Police + travel-delay enforcement.** Constables based on the capital who travel to other islands to act on crimes, with a **deliberate delay** so a culprit can flee before they arrive. | engine (a constable role acting on verdicts) + hub (§14) + server (travel) | L | **Extends what exists, don't rebuild the trial**: `accuse` → a council **`hearing`** gathering → `town.verdict`, with `convictions` tracked and exile via `removeAgent("exiled")` (engine ~L911-917) already exist. Police are the *enforcement arm*. Ties directly to hub-design §14 (fugitive/notoriety, "Interpol, not a police force"): notoriety travels at boat/rumour speed, the wanted-list faster — the travel-delay **is** the cat-and-mouse of §14.5. Rule 5: consequences through the town/hub, never an operator ban. | B6 |
| B10 | **Disasters → food-shortage → trade/aid diplomacy loop.** Add **floods and tsunami** (NEW), and model the marquee consequence: a disaster that **wrecks an island's farms** creates a food shortage → the island must **import food or starve** → this drives inter-island trade and **aid** (allies send it, rivals don't; a desperate island may raid). | engine (new disaster kinds + farm damage) + hub (aid/relations) | L | Rule 1 + rule 6: scarcity is physics and the whole cascade is readable. **Verified EXISTS (don't rebuild)**: **fire** (`fire()`/`maybeFire` ~L1791-1802 — a fire gathering, `brokenUntil`, stock zeroed, repairable) and **storms** (boats halt ~L1002; outdoor work zeroed in storm / halved in rain via `weatherCut` ~L1352-1360; 50% mill-roof → 3-day break → **flour shortage** ~L1186-1189) are already in. **NEW**: floods/tsunami, farm-wrecking, and the import-or-starve → aid/raid diplomacy loop (the starvation death path already exists; the *cross-island response* does not). | B6, A8 |
| B11 | **Murder / violence, emergent.** Model deliberate harm and killing as an **emergent** outcome of free will, not a scripted verb: a seeded provocateur, escalation from theft/feuds, death, and the suspicion/notoriety that follows. | engine (a harm/violence path, mortality-by-agent) + hub (§14) | L | **NEW — verified absent** (death today is only starvation/cold/age; no kill action). Do it the §14 way: seed an agent and **watch the world answer** — model **suspicion**, not a binary "killer" flag (§14.4); notoriety travels at boat/rumour speed, faster via the hub's wanted-list. Rule 1: the engine is physics, not morality — it doesn't stop harm; rule 5: consequences come from the town's hearings (B9) and other citizens, never an operator ban. | B9, B6 |

---

## 5. Recommended next steps (ordered)

The first two are the user's biggest complaints and, together, unlock the rent economy
the engine already simulates but never exercises.

1. **A1 — Population + homes scale with island size.** Stop seeding a flat 20. Size the
   population off `pack.size`/place count (keep `UW_CITIZENS` as override) and add more
   home-kind places to the packs so there are homes to fill. *Highest impact, smallest
   change; unblocks everything else.*

2. **A2 — Assign citizens to homes at seed.** Distribute seeded citizens across real
   homes (owner + beds + `nightsPaid`) instead of homing everyone at the inn. This
   alone turns on the existing rent → arrears → eviction → landlord loop and makes the
   digest read differently for different people.

3. **A3/A8 (+ A5/A7) — Terrain by industry/region.** Make `drawGround`/`decorFor` read
   the pack: forests tied to lumber, mountains/hills for mining, vine rows and
   grassland; guard the pinewood loop; then generalize to a data-driven terrain-by-region
   system (A8) and add per-pack silhouettes plus the lighthouse/offshore-rocks/causeway
   pass (A5/A7). Islands finally look like what they *do*. Grow the capital (A6) once
   scaling lands.

4. **A4/A10 — More to build and do.** Eateries and new building types (A4), then a
   school layered on the existing skills system (A10), so a fuller population generates
   more.

5. **Then the deeper economy/geopolitics items**, roughly in dependency order:
   **B1 housing market → B2 land model → B7 wild-land-to-farm → B3 water → B4 banking →
   B5 wealth shock → B8 overfishing → B9 police → B10 disasters/aid → B11 emergent
   violence → B6 hub geopolitics.** (B8 overfishing and A9 national park are smaller
   and can slot in opportunistically once their prerequisites exist.) Each larger item
   is an L-sized subsystem; take them one hypothesis at a time, and for every one,
   confirm it changes what an owner reads tomorrow (rule 6) and never opens a path from
   credits to coins (rule 3).
