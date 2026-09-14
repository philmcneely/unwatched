import type { PlaceKind } from "../types.ts";
import type { WorldPack, PlaceSpec } from "./island.ts";

/**
 * Cairnhold — a third world pack. A rugged highland mining isle: rich in stone,
 * ore, coal, iron and the nails and tools its forge and smithy beat out of them,
 * but poor in grain, flour, fish and timber. That scarcity is the point — the
 * hill has no soil to spare and no wood to fell, so the boat that carries stone
 * and iron down to the mainland comes back laden with flour and timber. It keeps
 * the load-bearing place ids the habit engine falls back on (harbor, inn,
 * market, bakery, fields, chapel, tavern) and reuses the island's sprite names
 * so the client can draw it, but everything else — layout, names, economy — is
 * its own: five districts strung between the landing and the high crag, the
 * miners' rows below the diggings, the foundry breathing on the haul road.
 *
 * Run it as its own instance: UW_PACK=cairnhold UW_TOWN_ID=cairnhold
 * UW_TOWN_NAME="Cairnhold", with the harbors pointed at the other isles so the
 * grain and timber it lacks can come in by boat and its ore and iron go out.
 */
const P = (id: string, name: string, kind: PlaceKind, district: string, sprite: string, x: number, y: number, exits: string[], extra: Partial<PlaceSpec> = {}): PlaceSpec => ({ id, name, kind, district, sprite, x, y, exits, ...extra });

export const CAIRNHOLD: WorldPack = {
  id: "cairnhold", name: "Cairnhold", size: { w: 2900, h: 1800 },
  places: [
    // The landing
    P("harbor", "the landing", "harbor", "the landing", "harbor-office", 560, 1220, ["inn", "market", "chandlery", "boatshed", "orewash", "fishhouse", "coast"]),
    P("inn", "the Deepgate inn", "inn", "the landing", "inn", 820, 1060, ["market"], { sells: [{ item: "soup", base: 2 }, { item: "bread", base: 1 }], beds: { price: 4, capacity: 6 }, stock: { soup: 8, bread: 4, fish: 4 } }),
    P("chandlery", "the chandlery", "shop", "the landing", "chandlery", 880, 1320, ["market"], { sells: [{ item: "rope", base: 3 }, { item: "lamp oil", base: 2 }], beds: { price: 3, capacity: 1 } }),
    P("boatshed", "the boat shed", "home", "the landing", "boatshed", 400, 1440, ["harbor"], { beds: { price: 0, capacity: 8 } }),
    P("fishhouse", "the fish house", "workplace", "the landing", "fishhouse", 300, 1040, ["harbor"], { sells: [{ item: "fish", base: 1 }], stock: { fish: 8 } }),
    P("orewash", "the ore-washing shed", "workplace", "the landing", "fishhouse", 700, 1460, ["harbor", "haul"], { stock: { ore: 8 } }),
    P("boatyard", "the boatyard", "workplace", "the landing", "sawpit", 560, 1560, ["harbor"], { sells: [{ item: "boat", base: 10 }], stock: { timber: 6, boat: 1 } }),
    // Cairn town
    P("market", "the market square", "market", "cairn town", "stall", 1180, 1160, ["harbor", "inn", "bakery", "tavern", "council", "chapel", "smithy", "wynd", "haul", "fells", "store", "ironmonger"], { sells: [{ item: "bread", base: 1 }, { item: "fish", base: 1 }, { item: "tools", base: 4 }], stock: { bread: 8, fish: 4, tools: 3 } }),
    P("store", "the provisioner", "shop", "cairn town", "chandlery", 1380, 1020, ["market"], { sells: [{ item: "bread", base: 1 }, { item: "fish", base: 1 }, { item: "lamp oil", base: 2 }], stock: { bread: 8, fish: 4, "lamp oil": 6 } }),
    P("ironmonger", "the ironmonger", "shop", "cairn town", "stall", 1000, 1080, ["market"], { sells: [{ item: "nails", base: 2 }, { item: "tools", base: 4 }, { item: "rope", base: 3 }], stock: { nails: 12, tools: 6, rope: 6 } }),
    P("bakery", "the wee bakery", "workplace", "cairn town", "bakery", 1150, 880, ["market"], { sells: [{ item: "bread", base: 1 }], stock: { bread: 12, flour: 8 } }),
    P("tavern", "the Pick & Anvil", "public", "cairn town", "tavern", 1480, 1240, ["market", "wynd"], { sells: [{ item: "drink", base: 1 }] }),
    P("council", "the council house", "civic", "cairn town", "council", 1500, 900, ["market", "chapel"]),
    P("chapel", "the kirk", "public", "cairn town", "chapel", 1780, 820, ["market", "council", "fells"]),
    P("smithy", "the smithy", "workplace", "cairn town", "smithy", 940, 900, ["market"], { sells: [{ item: "nails", base: 2 }, { item: "tools", base: 4 }], stock: { nails: 10, tools: 4, iron: 6 } }),
    P("wynd", "Miners' Wynd", "public", "cairn town", "lamp", 1400, 1440, ["market", "tavern", "wynd-1", "rows"]),
    P("wynd-1", "an empty lot on the wynd", "plot", "cairn town", "plot", 1280, 1560, ["wynd"]),
    // The miners' rows
    P("rows", "the miners' rows", "public", "the rows", "well", 1150, 1520, ["wynd", "row-1", "row-2", "cot-1"]),
    P("row-1", "a cottage on the rows", "home", "the rows", "boatshed", 1000, 1600, ["rows"], { beds: { price: 1, capacity: 4 } }),
    P("row-2", "the end cottage on the rows", "home", "the rows", "boatshed", 1250, 1660, ["rows"], { beds: { price: 1, capacity: 4 } }),
    P("cot-1", "an empty cot on the rows", "plot", "the rows", "plot", 1050, 1440, ["rows"]),
    // The diggings
    P("haul", "the haul road", "public", "the diggings", "bench", 1750, 1240, ["market", "orewash", "foundry", "ironadit"]),
    P("foundry", "the foundry", "workplace", "the diggings", "smithy", 2050, 1200, ["haul", "coalpit", "charcoal"], { sells: [{ item: "iron", base: 3 }], stock: { iron: 8, ore: 6, coal: 6 } }),
    P("ironadit", "the iron adit", "wild", "the diggings", "quarry", 2300, 1080, ["haul", "coalpit"], { stock: { ore: 12 } }),
    P("coalpit", "the coal pit", "wild", "the diggings", "quarry", 2350, 1320, ["foundry", "ironadit", "charcoal"], { stock: { coal: 12 } }),
    P("charcoal", "the charcoal burner", "workplace", "the diggings", "sawpit", 2100, 1480, ["coalpit", "fells"], { stock: { coal: 6 } }),
    // The high fells
    P("fells", "the high fells", "public", "the high fells", "well", 1950, 620, ["market", "chapel", "charcoal", "fields", "quarry", "crag", "fell-1"]),
    P("fields", "the thin fields", "workplace", "the high fells", "field", 1650, 400, ["fells"], { stock: { grain: 18 } }),
    P("quarry", "the high quarry", "wild", "the high fells", "quarry", 2250, 480, ["fells", "crag"], { stock: { stone: 12 } }),
    P("fell-1", "a croft on the fells", "home", "the high fells", "boatshed", 1450, 340, ["fells"], { beds: { price: 1, capacity: 4 } }),
    // The crag
    P("coast", "the coast road", "public", "the crag", "searocks", 1900, 1650, ["harbor", "crag"]),
    P("crag", "the crag path", "public", "the crag", "bench", 2450, 1000, ["fells", "quarry", "coast", "lighthouse"]),
    P("lighthouse", "the crag light", "public", "the crag", "lighthouse", 2700, 640, ["crag", "point-1"]),
    P("point-1", "the plot on the point", "plot", "the crag", "plot", 2620, 400, ["lighthouse"]),
  ],
  jobs: [
    { id: "ironadit.miner", title: "miner at the iron adit", place: "ironadit", wage: 3, hours: [6, 14], slots: 3 },
    { id: "coalpit.collier", title: "collier", place: "coalpit", wage: 3, hours: [6, 14], slots: 3 },
    { id: "quarry.hand", title: "quarryman", place: "quarry", wage: 3, hours: [7, 15], slots: 2 },
    { id: "foundry.founder", title: "founder", place: "foundry", wage: 4, hours: [7, 15], slots: 2 },
    { id: "smithy.help", title: "smith's help", place: "smithy", wage: 3, hours: [8, 16], slots: 2 },
    { id: "charcoal.burner", title: "charcoal burner", place: "charcoal", wage: 2, hours: [6, 13], slots: 1 },
    { id: "orewash.washer", title: "ore washer", place: "orewash", wage: 2, hours: [7, 14], slots: 2 },
    { id: "bakery.cook", title: "cook at the bakery", place: "bakery", wage: 3, hours: [6, 12], slots: 1 },
    { id: "inn.help", title: "help at the inn", place: "inn", wage: 2, hours: [8, 16], slots: 2 },
    { id: "harbor.dock", title: "dock hand", place: "harbor", wage: 2, hours: [6, 12], slots: 2 },
    { id: "harbor.ferry", title: "ferryman", place: "harbor", wage: 3, hours: [6, 14], slots: 2 },
    { id: "boatyard.wright", title: "shipwright", place: "boatyard", wage: 3, hours: [8, 16], slots: 1 },
    { id: "chandlery.clerk", title: "clerk at the chandlery", place: "chandlery", wage: 2, hours: [9, 17], slots: 1 },
    { id: "store.keep", title: "shopkeeper at the provisioner", place: "store", wage: 2, hours: [9, 17], slots: 1 },
    { id: "ironmonger.clerk", title: "clerk at the ironmonger", place: "ironmonger", wage: 2, hours: [9, 17], slots: 1 },
    { id: "tavern.keep", title: "tavern keeper's help", place: "tavern", wage: 2, hours: [16, 23], slots: 1 },
    { id: "fields.hand", title: "field hand", place: "fields", wage: 2, hours: [7, 14], slots: 2 },
    { id: "fishhouse.gutter", title: "fish gutter", place: "fishhouse", wage: 2, hours: [5, 11], slots: 1 },
  ],
  float: { inn: 60, market: 20, bakery: 40, smithy: 40, foundry: 50, ironadit: 30, coalpit: 30, quarry: 30, charcoal: 30, orewash: 30, chandlery: 30, store: 40, ironmonger: 40, tavern: 30, fields: 30, fishhouse: 30, boatyard: 40, harbor: 40 },
  produce: [
    // the hill's wealth: rock, ore and coal, all year, most of it for the boat
    { place: "quarry", makes: "stone", qty: 4 },
    { place: "ironadit", makes: "ore", qty: 3 }, { place: "orewash", makes: "ore", qty: 2 },
    { place: "coalpit", makes: "coal", qty: 4 }, { place: "charcoal", makes: "coal", qty: 2 },
    // the foundry smelts ore to iron (fed coal by the morning cart); the smithy beats iron into nails and tools
    { place: "foundry", makes: "iron", qty: 4, needs: { item: "ore", qty: 4 } },
    { place: "smithy", makes: "nails", qty: 3, needs: { item: "iron", qty: 1 } }, { place: "smithy", makes: "tools", qty: 1, needs: { item: "iron", qty: 1 } },
    // the thin food it can raise for itself; grain, flour, fish and timber come in by boat
    { place: "fields", makes: "grain", qty: 2, seasons: ["summer", "autumn"] }, { place: "fields", makes: "grain", qty: 1, seasons: ["spring"] },
    { place: "bakery", makes: "bread", qty: 12, needs: { item: "flour", qty: 1 } },
    { place: "fishhouse", makes: "fish", qty: 4 },
    // a boat now and then; the hill has no wood, so each hull waits on timber off the ferry
    { place: "boatyard", makes: "boat", qty: 1, needs: { item: "timber", qty: 4 } },
    // the counters: the inn's pot, the tavern's tap, the chandlery's rope and oil
    { place: "inn", makes: "soup", qty: 8, needs: { item: "fish", qty: 2 } }, { place: "tavern", makes: "drink", qty: 4 },
    { place: "chandlery", makes: "rope", qty: 1 }, { place: "chandlery", makes: "lamp oil", qty: 1 },
  ],
  feasts: [{ name: "the founders' cairn", month: 6, day: 18, place: "market" }, { name: "the miners' rest", month: 9, day: 2, place: "market" }, { name: "the midwinter coal-fire", month: 12, day: 20, place: "harbor" }],
  supply: [
    // the six o'clock cart: ore and coal to the foundry, iron to the smithy, food to the shelves
    { from: "ironadit", to: "foundry", item: "ore", qty: 4, price: 2, upTo: 8 }, { from: "orewash", to: "foundry", item: "ore", qty: 2, price: 2, upTo: 8 },
    { from: "coalpit", to: "foundry", item: "coal", qty: 4, price: 2, upTo: 8 }, { from: "charcoal", to: "foundry", item: "coal", qty: 2, price: 2, upTo: 8 },
    { from: "foundry", to: "smithy", item: "iron", qty: 4, price: 3, upTo: 8 }, { from: "smithy", to: "market", item: "tools", qty: 2, price: 4, upTo: 4 },
    // the trades restock the shops: nails and tools to the ironmonger, bread and fish to the provisioner
    { from: "smithy", to: "ironmonger", item: "nails", qty: 4, price: 2, upTo: 12 }, { from: "smithy", to: "ironmonger", item: "tools", qty: 2, price: 4, upTo: 6 },
    { from: "bakery", to: "store", item: "bread", qty: 4, price: 1, upTo: 8 }, { from: "fishhouse", to: "store", item: "fish", qty: 2, price: 1, upTo: 6 },
    { from: "bakery", to: "market", item: "bread", qty: 6, price: 1, upTo: 8 }, { from: "bakery", to: "inn", item: "bread", qty: 3, price: 1, upTo: 6 },
    { from: "fishhouse", to: "market", item: "fish", qty: 3, price: 1, upTo: 6 }, { from: "fishhouse", to: "inn", item: "fish", qty: 2, price: 1, upTo: 6 },
  ],
  // Cairnhold's income: what the hill gives up. It has no soil or wood to spare — flour, timber and most of its fish come in by boat.
  exports: [
    { item: "stone", price: 2, keep: 12 }, { item: "ore", price: 2, keep: 12 }, { item: "coal", price: 2, keep: 12 },
    { item: "iron", price: 3, keep: 12 }, { item: "nails", price: 2, keep: 8 }, { item: "tools", price: 4, keep: 8 },
    { item: "boat", price: 10, keep: 0 },
  ],
};
