import type { PlaceKind } from "../types.ts";
import type { WorldPack, PlaceSpec } from "./island.ts";

/**
 * Vinehaven — a warm, sun-terraced vineyard and orchard island. It lives on
 * what the sun ripens: wine, olive oil, honey, figs, grapes, olives and cloth.
 * It is deliberately POOR in fish, timber, stone and grain-for-bread — those
 * ride in on the boat, which is the point: the ferry earns its keep carrying
 * flour up and casks of wine down. It keeps the load-bearing place ids the
 * habit engine falls back on (harbor, inn, market, bakery, fields, chapel,
 * tavern) and reuses the island's sprite names so the client can draw it, but
 * its layout, names and golden economy are its own.
 *
 * Run it as its own instance: UW_PACK=vinehaven UW_TOWN_ID=vinehaven
 * UW_TOWN_NAME="Vinehaven", with UW_HARBORS pointed at the other islands so
 * citizens can sail between them (Vinehaven ships wine/oil, buys flour/timber).
 */
const P = (id: string, name: string, kind: PlaceKind, district: string, sprite: string, x: number, y: number, exits: string[], extra: Partial<PlaceSpec> = {}): PlaceSpec => ({ id, name, kind, district, sprite, x, y, exits, ...extra });

export const VINEHAVEN: WorldPack = {
  id: "vinehaven", name: "Vinehaven", size: { w: 3000, h: 1800 },
  places: [
    // The Landing — the little harbor where flour comes in and wine goes out
    P("harbor", "the sun landing", "harbor", "the landing", "harbor-office", 500, 1300, ["inn", "cellars", "boatshed", "coast", "market"]),
    P("inn", "the Vine & Fig inn", "inn", "the landing", "inn", 780, 1160, ["harbor", "market"], { sells: [{ item: "soup", base: 2 }, { item: "bread", base: 1 }, { item: "wine", base: 2 }], beds: { price: 4, capacity: 6 }, stock: { soup: 8, bread: 4, figs: 6, wine: 6 } }),
    P("cellars", "the harbor cellars", "shop", "the landing", "chandlery", 820, 1420, ["harbor", "market"], { sells: [{ item: "wine", base: 2 }, { item: "oil", base: 2 }, { item: "lamp oil", base: 2 }], beds: { price: 3, capacity: 1 }, stock: { wine: 12, oil: 8, "lamp oil": 6 } }),
    P("boatshed", "the boat shed", "home", "the landing", "boatshed", 360, 1440, ["harbor"], { beds: { price: 0, capacity: 8 } }),
    P("coast", "the shore road", "public", "the landing", "searocks", 700, 980, ["harbor", "terracewalk"]),
    // The Sun Market — the old town, its fountain square and its trades
    P("market", "the sun market", "market", "old town", "stall", 1300, 1150, ["harbor", "inn", "cellars", "bakery", "tavern", "chapel", "council", "weaver", "square", "hillroad", "terracewalk", "store", "wineshop", "drygoods"], { sells: [{ item: "bread", base: 1 }, { item: "figs", base: 1 }, { item: "olives", base: 1 }, { item: "honey", base: 2 }, { item: "wine", base: 2 }], stock: { bread: 10, figs: 8, olives: 8, honey: 6, wine: 6 } }),
    P("bakery", "Rosa's bakery", "workplace", "old town", "bakery", 1280, 900, ["market"], { sells: [{ item: "bread", base: 1 }], stock: { bread: 18, flour: 20 } }),
    P("tavern", "the Golden Cask", "public", "old town", "tavern", 1560, 1280, ["market", "square"], { sells: [{ item: "wine", base: 1 }], stock: { wine: 12 } }),
    P("chapel", "the sun chapel", "public", "old town", "chapel", 1780, 900, ["market", "council"]),
    P("council", "the council hall", "civic", "old town", "council", 1560, 880, ["market", "chapel"]),
    P("weaver", "the dye house", "workplace", "old town", "smithy", 1080, 900, ["market"], { sells: [{ item: "cloth", base: 3 }], stock: { cloth: 8, flax: 12 } }),
    // the shops — where citizens spend what they earn, apart from the market and the workyards
    P("store", "the general store", "shop", "old town", "chandlery", 1120, 1180, ["market"], { sells: [{ item: "bread", base: 1 }, { item: "flour", base: 2 }, { item: "olives", base: 1 }, { item: "lamp oil", base: 2 }], stock: { bread: 8, flour: 12, olives: 8, "lamp oil": 6 } }),
    P("wineshop", "the wine shop", "shop", "old town", "chandlery", 1520, 1080, ["market"], { sells: [{ item: "wine", base: 2 }, { item: "oil", base: 2 }], stock: { wine: 16, oil: 10 } }),
    P("drygoods", "the dry-goods shop", "shop", "old town", "stall", 1180, 1360, ["market"], { sells: [{ item: "cloth", base: 3 }, { item: "honey", base: 2 }, { item: "figs", base: 1 }], stock: { cloth: 8, honey: 8, figs: 8 } }),
    P("square", "the fountain square", "public", "old town", "well", 1420, 1400, ["market", "tavern", "sq-1"]),
    P("sq-1", "a plot off the square", "plot", "old town", "plot", 1300, 1560, ["square"]),
    // The Vineyard Terraces — sun-terraced vines, the press, and the villas
    P("terracewalk", "the terrace walk", "public", "terraces", "lamp", 1980, 1300, ["market", "coast", "vineyard", "highvines", "winepress", "villa", "cottage", "terr-1", "grovewalk"]),
    P("vineyard", "the Sunterrace vineyard", "workplace", "terraces", "orchard", 2200, 1500, ["terracewalk", "winepress"], { sells: [{ item: "grapes", base: 1 }], stock: { grapes: 20 } }),
    P("highvines", "the high vines", "workplace", "terraces", "orchard", 2460, 1440, ["terracewalk", "vineyard"], { sells: [{ item: "grapes", base: 1 }], stock: { grapes: 14 } }),
    P("winepress", "the wine press", "workplace", "terraces", "mill", 2260, 1220, ["terracewalk", "vineyard"], { sells: [{ item: "wine", base: 2 }], stock: { wine: 16, grapes: 12 } }),
    P("villa", "the terrace villa", "home", "terraces", "inn", 2020, 1520, ["terracewalk"], { beds: { price: 2, capacity: 4 } }),
    P("cottage", "the vine cottages", "home", "terraces", "boatshed", 2500, 1220, ["terracewalk"], { beds: { price: 1, capacity: 6 } }),
    P("terr-1", "a plot on the low terrace", "plot", "terraces", "plot", 2160, 1620, ["terracewalk"]),
    // The Orchard Groves — olives and figs, the oil press, and the apiary
    P("grovewalk", "the grove path", "public", "groves", "bench", 2000, 780, ["terracewalk", "grove", "figgrove", "olivepress", "apiary", "grov-1", "hillroad"]),
    P("grove", "the olive grove", "workplace", "groves", "orchard", 2240, 620, ["grovewalk", "olivepress"], { sells: [{ item: "olives", base: 1 }, { item: "figs", base: 1 }], stock: { olives: 22, figs: 10 } }),
    P("figgrove", "the fig orchard", "workplace", "groves", "orchard", 2480, 660, ["grovewalk", "grove"], { sells: [{ item: "figs", base: 1 }], stock: { figs: 18 } }),
    P("olivepress", "the olive press", "workplace", "groves", "mill", 2260, 880, ["grovewalk", "grove"], { sells: [{ item: "oil", base: 2 }], stock: { oil: 14, olives: 12 } }),
    P("apiary", "the sun apiary", "workplace", "groves", "bench", 2500, 900, ["grovewalk"], { sells: [{ item: "honey", base: 2 }], stock: { honey: 16 } }),
    P("grov-1", "a plot above the groves", "plot", "groves", "plot", 2180, 440, ["grovewalk"]),
    // The Heights — the flax fields, the mill, and the light over the water
    P("hillroad", "the hill road", "public", "the heights", "well", 1700, 620, ["market", "grovewalk", "fields", "mill", "lighthouse"]),
    P("fields", "the flax fields", "workplace", "the heights", "field", 1500, 440, ["hillroad", "mill"], { sells: [{ item: "flax", base: 1 }], stock: { flax: 24, grain: 12 } }),
    P("mill", "the hill mill", "workplace", "the heights", "mill", 1760, 400, ["hillroad", "fields"], { stock: { flour: 24, grain: 10 } }),
    P("lighthouse", "the Vinehaven light", "public", "the heights", "lighthouse", 1980, 420, ["hillroad", "point-1"]),
    P("point-1", "the plot on the point", "plot", "the heights", "plot", 2140, 300, ["lighthouse"]),
  ],
  jobs: [
    { id: "bakery.cook", title: "cook at the bakery", place: "bakery", wage: 3, hours: [6, 12], slots: 2 },
    { id: "inn.help", title: "help at the inn", place: "inn", wage: 2, hours: [8, 16], slots: 2 },
    { id: "harbor.dock", title: "dock hand", place: "harbor", wage: 2, hours: [6, 12], slots: 2 },
    { id: "cellars.clerk", title: "clerk at the cellars", place: "cellars", wage: 2, hours: [9, 17], slots: 1 },
    { id: "tavern.keep", title: "tavern keeper's help", place: "tavern", wage: 2, hours: [16, 23], slots: 1 },
    { id: "weaver.hand", title: "weaver at the dye house", place: "weaver", wage: 3, hours: [8, 16], slots: 2 },
    { id: "vineyard.picker", title: "vine picker", place: "vineyard", wage: 2, hours: [7, 14], slots: 4 },
    { id: "highvines.picker", title: "picker on the high vines", place: "highvines", wage: 2, hours: [7, 14], slots: 3 },
    { id: "winepress.presser", title: "presser at the wine press", place: "winepress", wage: 3, hours: [8, 16], slots: 2 },
    { id: "grove.picker", title: "picker at the olive grove", place: "grove", wage: 2, hours: [7, 14], slots: 4 },
    { id: "figgrove.picker", title: "picker at the fig orchard", place: "figgrove", wage: 2, hours: [7, 14], slots: 2 },
    { id: "olivepress.presser", title: "presser at the olive press", place: "olivepress", wage: 3, hours: [8, 16], slots: 2 },
    { id: "apiary.keeper", title: "keeper at the apiary", place: "apiary", wage: 2, hours: [8, 15], slots: 1 },
    { id: "fields.hand", title: "field hand", place: "fields", wage: 2, hours: [7, 15], slots: 3 },
    { id: "mill.hand", title: "mill hand", place: "mill", wage: 3, hours: [7, 14], slots: 1 },
  ],
  float: { inn: 60, market: 20, bakery: 40, cellars: 40, harbor: 40, tavern: 30, weaver: 40, vineyard: 40, highvines: 30, winepress: 50, grove: 40, figgrove: 30, olivepress: 50, apiary: 30, fields: 30, mill: 30 },
  produce: [
    // the vines: grapes ripen in the long warm months, thinning to almost nothing in winter
    { place: "vineyard", makes: "grapes", qty: 6, seasons: ["summer", "autumn"] }, { place: "vineyard", makes: "grapes", qty: 2, seasons: ["spring"] }, { place: "vineyard", makes: "grapes", qty: 1, seasons: ["winter"] },
    { place: "highvines", makes: "grapes", qty: 4, seasons: ["summer", "autumn"] }, { place: "highvines", makes: "grapes", qty: 1, seasons: ["spring"] },
    { place: "winepress", makes: "wine", qty: 5, needs: { item: "grapes", qty: 6 } },
    // the groves: olives and figs, and the press that turns olives to oil
    { place: "grove", makes: "olives", qty: 5, seasons: ["autumn"] }, { place: "grove", makes: "olives", qty: 2, seasons: ["summer"] },
    { place: "grove", makes: "figs", qty: 3, seasons: ["summer", "autumn"] }, { place: "figgrove", makes: "figs", qty: 4, seasons: ["summer", "autumn"] }, { place: "figgrove", makes: "figs", qty: 1, seasons: ["spring"] },
    { place: "olivepress", makes: "oil", qty: 4, needs: { item: "olives", qty: 5 } },
    // the apiary: honey through the warm months
    { place: "apiary", makes: "honey", qty: 4, seasons: ["summer", "autumn"] }, { place: "apiary", makes: "honey", qty: 2, seasons: ["spring"] },
    // the heights: flax for the dye house, a thin bit of grain the mill can grind
    { place: "fields", makes: "flax", qty: 4, seasons: ["summer", "autumn"] }, { place: "fields", makes: "flax", qty: 2, seasons: ["spring"] },
    { place: "fields", makes: "grain", qty: 2, seasons: ["summer", "autumn"] }, { place: "fields", makes: "grain", qty: 1, seasons: ["spring"] },
    { place: "weaver", makes: "cloth", qty: 3, needs: { item: "flax", qty: 4 } },
    { place: "mill", makes: "flour", qty: 4, needs: { item: "grain", qty: 4 } },
    // the table: bread from imported flour, the inn's fig-and-honey pottage, the tavern's pour
    { place: "bakery", makes: "bread", qty: 16, needs: { item: "flour", qty: 2 } },
    { place: "inn", makes: "soup", qty: 8, needs: { item: "figs", qty: 2 } },
  ],
  feasts: [{ name: "the vintage feast", month: 9, day: 21, place: "market" }, { name: "the harvest supper", month: 10, day: 12, place: "square" }, { name: "the golden night", month: 6, day: 24, place: "terracewalk" }],
  supply: [
    // grapes to the press, olives to the oil press, flax to the dye house, grain to the mill
    { from: "vineyard", to: "winepress", item: "grapes", qty: 6, price: 1, upTo: 12 }, { from: "highvines", to: "winepress", item: "grapes", qty: 4, price: 1, upTo: 12 },
    { from: "grove", to: "olivepress", item: "olives", qty: 5, price: 1, upTo: 10 }, { from: "fields", to: "weaver", item: "flax", qty: 4, price: 1, upTo: 10 },
    { from: "fields", to: "mill", item: "grain", qty: 2, price: 1, upTo: 8 }, { from: "mill", to: "bakery", item: "flour", qty: 4, price: 2, upTo: 8 },
    // the day's goods down to the market and the cellars, bread and figs to the inn
    { from: "winepress", to: "cellars", item: "wine", qty: 5, price: 2, upTo: 12 }, { from: "winepress", to: "tavern", item: "wine", qty: 4, price: 2, upTo: 10 }, { from: "winepress", to: "market", item: "wine", qty: 3, price: 2, upTo: 8 },
    { from: "olivepress", to: "cellars", item: "oil", qty: 4, price: 2, upTo: 10 }, { from: "apiary", to: "market", item: "honey", qty: 4, price: 2, upTo: 8 },
    { from: "grove", to: "market", item: "olives", qty: 4, price: 1, upTo: 8 }, { from: "figgrove", to: "market", item: "figs", qty: 4, price: 1, upTo: 8 }, { from: "figgrove", to: "inn", item: "figs", qty: 3, price: 1, upTo: 6 },
    { from: "bakery", to: "market", item: "bread", qty: 6, price: 1, upTo: 10 }, { from: "bakery", to: "inn", item: "bread", qty: 4, price: 1, upTo: 6 },
    // the shops get their morning delivery too
    { from: "bakery", to: "store", item: "bread", qty: 4, price: 1, upTo: 8 }, { from: "winepress", to: "wineshop", item: "wine", qty: 4, price: 2, upTo: 12 },
    { from: "olivepress", to: "wineshop", item: "oil", qty: 3, price: 2, upTo: 10 }, { from: "weaver", to: "drygoods", item: "cloth", qty: 2, price: 3, upTo: 8 }, { from: "apiary", to: "drygoods", item: "honey", qty: 3, price: 2, upTo: 8 },
  ],
  // Vinehaven's income: what the sun ripens. Flour, timber and stone it must buy back from the boat.
  exports: [
    { item: "wine", price: 4, keep: 12 }, { item: "oil", price: 3, keep: 8 }, { item: "honey", price: 3, keep: 6 }, { item: "cloth", price: 3, keep: 8 },
    { item: "figs", price: 1, keep: 12 }, { item: "olives", price: 1, keep: 12 }, { item: "grapes", price: 1, keep: 12 },
  ],
};
