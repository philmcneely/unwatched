import type { PlaceKind } from "../types.ts";
import type { WorldPack, PlaceSpec } from "./island.ts";

/**
 * Kestrel Isle — a second island pack, deliberately SMALL and, uniquely among
 * the five, deliberately LONG: not a compact rock but a slender, curving spit
 * strung out east to west, closer in shape to a barrier reef than a round
 * island. It's rich in fish, smoked fish, kelp and salt but poor in grain,
 * flour and timber. That scarcity is the point — it's why the boat between
 * Kestrel and the island is worth running (each sells what the other lacks).
 * Its wide `size` (roughly 2.75:1) tells the client's coastline generator to
 * stretch the isle's outline into that long, narrow, gently curved shape, and
 * its places are strung along the length accordingly: the quay at the western
 * tip, the town just inland of it, the salt flats and thin fields along the
 * middle, and the cliffs, kelp shore and light out at the eastern tip — so a
 * long walk (or a single coast road) runs the whole spine of the isle. It
 * keeps the load-bearing place ids the habit engine falls back on (harbor,
 * inn, market, bakery, fields, chapel, tavern) and reuses the island's sprite
 * names so the client can draw it, but everything else — layout, names,
 * economy — is its own. Besides the open market it has a few proper shops
 * (kind "shop") where citizens buy: the net loft for gear, the fishmonger,
 * the dry store.
 *
 * Run it as its own instance: UW_PACK=kestrel UW_TOWN_ID=kestrel
 * UW_TOWN_NAME="Kestrel Isle", with the two instances' UW_HARBORS pointed at
 * each other so citizens can sail between them.
 */
const P = (id: string, name: string, kind: PlaceKind, district: string, sprite: string, x: number, y: number, exits: string[], extra: Partial<PlaceSpec> = {}): PlaceSpec => ({ id, name, kind, district, sprite, x, y, exits, ...extra });

export const KESTREL: WorldPack = {
  id: "kestrel", name: "Kestrel Isle", size: { w: 3300, h: 1200 },
  places: [
    // The quay — the working waterfront, at the western tip of the spit: the boat, the fish, the smoke, the gear.
    P("harbor", "the quay", "harbor", "quay", "harbor-office", 450, 620, ["inn", "market", "smokehouse", "fishhouse", "netloft", "cliffpath"]),
    P("inn", "the Kestrel inn", "inn", "quay", "inn", 700, 520, ["market"], { sells: [{ item: "soup", base: 2 }, { item: "bread", base: 1 }], beds: { price: 4, capacity: 6 }, stock: { soup: 8, bread: 4, fish: 6 } }),
    P("fishhouse", "the fish house", "workplace", "quay", "fishhouse", 280, 480, ["netloft"], { sells: [{ item: "fish", base: 1 }], stock: { fish: 16 } }),
    P("netloft", "the net loft", "shop", "quay", "chandlery", 260, 760, ["boatshed"], { sells: [{ item: "rope", base: 3 }, { item: "lamp oil", base: 2 }], beds: { price: 3, capacity: 1 }, stock: { rope: 8, "lamp oil": 6 } }),
    P("smokehouse", "the smokehouse", "workplace", "quay", "smithy", 650, 820, ["market"], { sells: [{ item: "smoked fish", base: 2 }], stock: { "smoked fish": 8, fish: 4 } }),
    P("boatshed", "the boat shed", "home", "quay", "boatshed", 380, 900, [], { beds: { price: 0, capacity: 8 } }),
    // the isle wants boats badly but has no wood of its own — the yard runs on imported timber
    P("boatyard", "the boatyard", "workplace", "quay", "sawpit", 700, 680, ["harbor"], { stock: { timber: 6 } }),
    // The town — just inland of the quay: the market, the shops, the trades, and the homes round the green.
    P("market", "the fish market", "market", "town", "stall", 1150, 560, ["fishmonger", "drygoods", "bakery", "tavern", "chapel", "saltpan", "green", "tradehouse"], { sells: [{ item: "fish", base: 1 }, { item: "smoked fish", base: 2 }, { item: "bread", base: 1 }], stock: { fish: 10, "smoked fish": 6, bread: 6 } }),
    // the trade house: a merchant ships the isle's gluts of fish and salt to the mainland for the spread
    P("tradehouse", "the trade house", "shop", "town", "chandlery", 1350, 460, ["market"], { sells: [{ item: "rope", base: 3 }, { item: "salt", base: 2 }], stock: { rope: 4, salt: 6 } }),
    P("fishmonger", "the fishmonger", "shop", "town", "fishhouse", 980, 720, [], { sells: [{ item: "fish", base: 1 }, { item: "smoked fish", base: 2 }], stock: { fish: 8, "smoked fish": 6 } }),
    P("drygoods", "the dry store", "shop", "town", "stall", 1380, 720, [], { sells: [{ item: "bread", base: 1 }, { item: "salt", base: 2 }], stock: { bread: 8, salt: 8 } }),
    P("bakery", "the isle bakery", "workplace", "town", "bakery", 1080, 320, ["chapel"], { sells: [{ item: "bread", base: 1 }], stock: { bread: 12, flour: 8 } }),
    P("tavern", "the Anchor", "public", "town", "tavern", 1420, 680, ["green"], { sells: [{ item: "drink", base: 1 }] }),
    P("chapel", "the sea chapel", "public", "town", "chapel", 1550, 320, []),
    P("green", "the green", "public", "town", "well", 1500, 880, ["green-1", "green-2"]),
    P("green-1", "a plot on the green", "plot", "town", "plot", 1350, 1020, []),
    P("green-2", "the far plot on the green", "plot", "town", "plot", 1650, 1000, []),
    // The middle flats — the salt pans and the isle's thin grain, strung along the spine between town and cliffs.
    P("saltpan", "the salt pans", "workplace", "flats", "field", 1950, 480, ["fields", "kelpshore"], { sells: [{ item: "salt", base: 2 }], stock: { salt: 12 } }),
    P("fields", "the thin fields", "workplace", "flats", "field", 2150, 260, [], { stock: { grain: 24 } }),
    // The cliffs and the shore, at the eastern tip — the kelp, the light, and a plot on the point.
    P("cliffpath", "the cliff path", "public", "cliffs", "searocks", 2500, 560, ["kelpshore", "lighthouse"]),
    P("kelpshore", "the kelp shore", "workplace", "cliffs", "bench", 2750, 320, [], { sells: [{ item: "kelp", base: 1 }], stock: { kelp: 20 } }),
    P("lighthouse", "the Kestrel light", "public", "cliffs", "lighthouse", 3020, 680, ["point-1"]),
    P("point-1", "the plot on the point", "plot", "cliffs", "plot", 2900, 860, []),
  ],
  jobs: [
    { id: "fishhouse.gutter", title: "fish gutter", place: "fishhouse", wage: 2, hours: [5, 11], slots: 3 },
    { id: "smokehouse.smoker", title: "smoker", place: "smokehouse", wage: 3, hours: [7, 15], slots: 2 },
    { id: "boatyard.wright", title: "shipwright", place: "boatyard", wage: 3, hours: [8, 16], slots: 1 },
    { id: "harbor.ferry", title: "ferryman", place: "harbor", wage: 3, hours: [6, 14], slots: 2 },
    { id: "netloft.mender", title: "net mender", place: "netloft", wage: 2, hours: [9, 16], slots: 1 },
    { id: "fishmonger.clerk", title: "clerk at the fishmonger", place: "fishmonger", wage: 2, hours: [8, 15], slots: 1 },
    { id: "drygoods.clerk", title: "clerk at the dry store", place: "drygoods", wage: 2, hours: [9, 17], slots: 1 },
    { id: "inn.help", title: "help at the inn", place: "inn", wage: 2, hours: [8, 16], slots: 2 },
    { id: "bakery.cook", title: "cook at the bakery", place: "bakery", wage: 3, hours: [6, 12], slots: 1 },
    { id: "harbor.dock", title: "dock hand", place: "harbor", wage: 2, hours: [6, 12], slots: 2 },
    { id: "kelpshore.gatherer", title: "kelp gatherer", place: "kelpshore", wage: 2, hours: [6, 13], slots: 3 },
    { id: "saltpan.raker", title: "salt raker", place: "saltpan", wage: 2, hours: [8, 15], slots: 2 },
    { id: "fields.hand", title: "field hand", place: "fields", wage: 2, hours: [7, 14], slots: 2 },
    { id: "tavern.keep", title: "tavern keeper's help", place: "tavern", wage: 2, hours: [16, 23], slots: 1 },
    { id: "tradehouse.merchant", title: "merchant", place: "tradehouse", wage: 3, hours: [8, 16], slots: 1 },
  ],
  float: { inn: 60, market: 20, bakery: 40, fishhouse: 40, smokehouse: 40, boatyard: 40, netloft: 30, fishmonger: 30, drygoods: 30, saltpan: 30, kelpshore: 30, tavern: 30, fields: 30, harbor: 40, tradehouse: 50 },
  produce: [
    { place: "fishhouse", makes: "fish", qty: 14 },
    { place: "smokehouse", makes: "smoked fish", qty: 6, needs: { item: "fish", qty: 6 } },
    { place: "kelpshore", makes: "kelp", qty: 8, seasons: ["spring", "summer", "autumn"] }, { place: "kelpshore", makes: "kelp", qty: 3, seasons: ["winter"] },
    { place: "saltpan", makes: "salt", qty: 4, seasons: ["summer", "autumn"] }, { place: "saltpan", makes: "salt", qty: 1, seasons: ["spring", "winter"] },
    { place: "fields", makes: "grain", qty: 2, seasons: ["summer", "autumn"] }, { place: "fields", makes: "grain", qty: 1, seasons: ["spring"] },
    { place: "bakery", makes: "bread", qty: 12, needs: { item: "flour", qty: 1 } },
    { place: "inn", makes: "soup", qty: 8, needs: { item: "fish", qty: 2 } }, { place: "tavern", makes: "drink", qty: 4 },
    { place: "netloft", makes: "rope", qty: 1 }, { place: "netloft", makes: "lamp oil", qty: 1 },
    { place: "boatyard", makes: "boat", qty: 1, needs: { item: "timber", qty: 4 } },
  ],
  feasts: [{ name: "the kestrel run", month: 5, day: 12, place: "harbor" }, { name: "the salt fair", month: 8, day: 30, place: "market" }, { name: "the light's night", month: 11, day: 2, place: "lighthouse" }],
  supply: [
    { from: "harbor", to: "boatyard", item: "timber", qty: 4, price: 2, upTo: 12 },
    { from: "harbor", to: "bakery", item: "flour", qty: 4, price: 2, upTo: 8 }, // the isle grows no grain to speak of; its flour comes in by boat
    { from: "fishhouse", to: "market", item: "fish", qty: 6, price: 1, upTo: 10 }, { from: "fishhouse", to: "inn", item: "fish", qty: 4, price: 1, upTo: 8 },
    { from: "fishhouse", to: "smokehouse", item: "fish", qty: 6, price: 1, upTo: 8 }, { from: "fishhouse", to: "fishmonger", item: "fish", qty: 4, price: 1, upTo: 8 },
    { from: "smokehouse", to: "market", item: "smoked fish", qty: 4, price: 2, upTo: 6 }, { from: "smokehouse", to: "fishmonger", item: "smoked fish", qty: 3, price: 2, upTo: 6 },
    { from: "bakery", to: "market", item: "bread", qty: 6, price: 1, upTo: 8 }, { from: "bakery", to: "inn", item: "bread", qty: 3, price: 1, upTo: 6 }, { from: "bakery", to: "drygoods", item: "bread", qty: 4, price: 1, upTo: 6 },
    { from: "kelpshore", to: "market", item: "kelp", qty: 6, price: 1, upTo: 10 },
    { from: "saltpan", to: "market", item: "salt", qty: 4, price: 2, upTo: 8 }, { from: "saltpan", to: "drygoods", item: "salt", qty: 3, price: 2, upTo: 8 },
  ],
  // Kestrel's income: the sea's harvest and salt. It has no timber and little grain — those come by boat from the island.
  exports: [
    { item: "fish", price: 1, keep: 16 }, { item: "smoked fish", price: 2, keep: 8 }, { item: "kelp", price: 1, keep: 8 }, { item: "salt", price: 2, keep: 12 }, { item: "boat", price: 10, keep: 0 },
  ],
};
