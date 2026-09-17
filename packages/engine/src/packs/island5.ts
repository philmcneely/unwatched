import type { PlaceKind } from "../types.ts";
import type { WorldPack, PlaceSpec } from "./island.ts";

/**
 * Aurelia — the capital. The largest island by far, and the seat of the whole
 * little world: its governance (the grand council, the courts, the customs
 * house), its money (the bank), its learning and worship and spectacle (the
 * great library, the academy, the cathedral, the theatre, the royal gardens,
 * the museum). All of that is the point. Aurelia grows little of its own food
 * and has no timber, so it lives on trade: it imports grain and fish and timber
 * from the working islands and exports what it alone makes well — books and
 * fine cloth. Its dense knot of public and civic places makes it the world's
 * great draw: more to see than anywhere, so the tourism trade lands here
 * hardest, and a capital feast fills every inn.
 *
 * It keeps the load-bearing place ids the habit engine falls back on (harbor,
 * inn, market, bakery, fields, chapel, tavern) — the cathedral is "chapel" — and
 * reuses the island sprites so the client can draw it.
 *
 * Run it as its own instance: UW_PACK=capital UW_TOWN_ID=capital
 * UW_TOWN_NAME="Aurelia", with the islands' UW_HARBORS pointed at each other so
 * citizens sail between them.
 */
const P = (id: string, name: string, kind: PlaceKind, district: string, sprite: string, x: number, y: number, exits: string[], extra: Partial<PlaceSpec> = {}): PlaceSpec => ({ id, name, kind, district, sprite, x, y, exits, ...extra });

export const CAPITAL: WorldPack = {
  id: "capital", name: "Aurelia", size: { w: 4400, h: 2300 },
  places: [
    // The Great Harbor — the customs house, the quays, the royal boatyard.
    P("harbor", "the Great Harbor", "harbor", "the harbor", "harbor-office", 640, 1460, ["inn", "market", "customs", "fishquay", "boatyard", "boatshed", "chandlery", "esplanade"]),
    P("customs", "the customs house", "civic", "the harbor", "council", 370, 1300, ["harbor"]),
    P("fishquay", "the fish quay", "workplace", "the harbor", "fishhouse", 320, 1590, ["harbor"], { sells: [{ item: "fish", base: 1 }], stock: { fish: 12 } }),
    P("boatyard", "the royal boatyard", "workplace", "the harbor", "sawpit", 930, 1690, ["harbor"], { stock: { timber: 6 } }),
    P("boatshed", "the boat shed", "home", "the harbor", "boatshed", 760, 1760, ["harbor"], { beds: { price: 0, capacity: 8 } }),
    P("chandlery", "the chandlery", "shop", "the harbor", "chandlery", 1050, 1440, ["harbor"], { sells: [{ item: "rope", base: 3 }, { item: "lamp oil", base: 2 }], beds: { price: 3, capacity: 1 }, stock: { rope: 8, "lamp oil": 6 } }),
    P("esplanade", "the esplanade", "public", "the harbor", "bench", 640, 1210, ["harbor", "forum", "lighthouse"]),
    P("lighthouse", "the Aurelian light", "public", "the harbor", "lighthouse", 290, 1020, ["esplanade", "commons"]),

    // The Exchange — the grand market, the exchange house, the bank, the shops and the makers.
    P("market", "the grand market", "market", "the exchange", "stall", 1370, 1340, ["harbor", "inn", "bakery", "exchange", "bookshop", "draper", "bank", "tavern", "forum", "grandway"], { sells: [{ item: "bread", base: 1 }, { item: "fish", base: 1 }, { item: "apples", base: 1 }, { item: "cloth", base: 3 }], stock: { bread: 10, fish: 6, apples: 6, cloth: 4 } }),
    P("exchange", "the exchange house", "shop", "the exchange", "chandlery", 1660, 1210, ["market"], { sells: [{ item: "cloth", base: 3 }, { item: "books", base: 4 }], stock: { cloth: 4, books: 3 } }),
    P("bank", "the bank of Aurelia", "workplace", "the exchange", "council", 1660, 1460, ["market"], { sells: [] }),
    P("bookshop", "the bookshop", "shop", "the exchange", "stall", 1100, 1170, ["market"], { sells: [{ item: "books", base: 4 }], stock: { books: 4 } }),
    P("draper", "the draper", "shop", "the exchange", "stall", 1220, 1570, ["market"], { sells: [{ item: "cloth", base: 3 }], stock: { cloth: 6 } }),
    P("weavery", "the weavery", "workplace", "the exchange", "smithy", 1910, 1590, ["grandway"], { sells: [{ item: "cloth", base: 3 }], stock: { cloth: 6 } }),
    P("printhouse", "the print house", "workplace", "the exchange", "smithy", 1910, 1340, ["grandway"], { sells: [{ item: "books", base: 4 }], stock: { books: 4, cloth: 4 } }),

    // The Forum — governance and learning: the grand council, the courts, the library, the academy.
    P("forum", "the great forum", "public", "the forum", "well", 1440, 940, ["market", "esplanade", "council", "courts", "library", "academy", "chapel"]),
    P("council", "the grand council", "civic", "the forum", "council", 1100, 790, ["forum"]),
    P("courts", "the courts", "civic", "the forum", "council", 1780, 790, ["forum"]),
    P("library", "the great library", "public", "the forum", "council", 1220, 590, ["forum"]),
    P("academy", "the academy", "public", "the forum", "council", 1690, 590, ["forum"]),

    // The Cathedral Close — the great draws: the cathedral, the theatre, the gardens, the museum.
    P("chapel", "the cathedral", "public", "the close", "chapel", 2150, 940, ["forum", "theatre", "gardens", "museum"]),
    P("theatre", "the theatre", "public", "the close", "council", 2470, 820, ["chapel"]),
    P("gardens", "the royal gardens", "public", "the close", "tree-large", 2490, 1090, ["chapel", "monument"]),
    P("museum", "the museum", "public", "the close", "council", 2180, 1230, ["chapel"]),
    P("monument", "the monument", "public", "the close", "well", 2790, 1210, ["gardens"]),

    // The Grand Way — the great street of the living city: the inn, the tavern, the bakery, the mill, the homes.
    P("grandway", "the Grand Way", "public", "old town", "lamp", 1810, 1800, ["market", "weavery", "printhouse", "bakery", "mill", "row-1", "row-2", "row-3", "orchard", "fields", "heath", "moor"]),
    P("inn", "the crown inn", "inn", "old town", "inn", 1000, 1170, ["market", "harbor"], { sells: [{ item: "soup", base: 2 }, { item: "bread", base: 1 }], beds: { price: 5, capacity: 8 }, stock: { soup: 8, bread: 6, fish: 4 } }),
    P("tavern", "the Old Crown", "public", "old town", "tavern", 1590, 1630, ["market"], { sells: [{ item: "drink", base: 1 }] }),
    P("bakery", "the grand bakery", "workplace", "old town", "bakery", 1520, 1840, ["grandway"], { sells: [{ item: "bread", base: 1 }], stock: { bread: 14, flour: 10 } }),
    P("mill", "the city mill", "workplace", "old town", "mill", 2100, 1990, ["grandway"], { stock: { grain: 12, flour: 6 } }),
    P("row-1", "a house on the Grand Way", "home", "old town", "boatshed", 1520, 2070, ["grandway"], { beds: { price: 3, capacity: 4 } }),
    P("row-2", "a house on the Grand Way", "home", "old town", "boatshed", 1860, 2110, ["grandway"], { beds: { price: 3, capacity: 4 } }),
    P("row-3", "a house on the Grand Way", "home", "old town", "boatshed", 2200, 2090, ["grandway"], { beds: { price: 3, capacity: 4 } }),
    P("plot-1", "a building plot", "plot", "old town", "plot", 2440, 1900, ["grandway"]),
    P("plot-2", "a building plot", "plot", "old town", "plot", 2690, 1990, ["grandway"]),
    P("plot-3", "a building plot by the gardens", "plot", "the close", "plot", 2880, 1050, ["monument"]),

    // The city's thin farmland — most of Aurelia's food comes by boat.
    P("fields", "the city fields", "workplace", "the fields", "field", 2690, 1710, ["grandway"], { stock: { grain: 16 } }),
    P("orchard", "the city orchard", "workplace", "the fields", "orchard", 2980, 1590, ["grandway"], { sells: [{ item: "apples", base: 1 }], stock: { apples: 8 } }),

    // The trade house — a merchant ships Aurelia's gluts of books and cloth to the mainland.
    P("tradehouse", "the trade house", "shop", "the exchange", "chandlery", 950, 1570, ["harbor"], { sells: [{ item: "books", base: 4 }, { item: "cloth", base: 3 }], stock: { books: 3, cloth: 4 } }),

    // Idle wild land, out past the last built street — the capital's own room to grow: a future farm to feed
    // itself, or a park for the city to keep. No job stands on it and nothing in the pack is produced from it,
    // so the town itself may one day sell it to whoever has saved enough to buy it.
    P("heath", "the Aurelian heath", "wild", "the fields", "field", 3400, 1550, ["grandway"]),
    P("moor", "the wild moor", "wild", "the fields", "field", 3150, 1950, ["grandway"]),
    P("commons", "the north commons", "wild", "the harbor", "field", 150, 750, ["lighthouse"]),
  ],
  jobs: [
    { id: "bank.teller", title: "teller at the bank", place: "bank", wage: 3, hours: [9, 16], slots: 2 },
    { id: "weavery.weaver", title: "weaver", place: "weavery", wage: 3, hours: [8, 16], slots: 3 },
    { id: "printhouse.printer", title: "printer", place: "printhouse", wage: 3, hours: [8, 16], slots: 2 },
    { id: "bookshop.clerk", title: "clerk at the bookshop", place: "bookshop", wage: 2, hours: [9, 17], slots: 1 },
    { id: "draper.clerk", title: "clerk at the draper", place: "draper", wage: 2, hours: [9, 17], slots: 1 },
    { id: "chandlery.clerk", title: "clerk at the chandlery", place: "chandlery", wage: 2, hours: [9, 17], slots: 1 },
    { id: "library.keeper", title: "keeper of the library", place: "library", wage: 2, hours: [9, 17], slots: 2 },
    { id: "academy.tutor", title: "tutor at the academy", place: "academy", wage: 3, hours: [9, 15], slots: 2 },
    { id: "theatre.player", title: "player at the theatre", place: "theatre", wage: 2, hours: [16, 22], slots: 3 },
    { id: "museum.warden", title: "warden of the museum", place: "museum", wage: 2, hours: [10, 16], slots: 1 },
    { id: "gardens.gardener", title: "gardener", place: "gardens", wage: 2, hours: [7, 14], slots: 2 },
    { id: "customs.officer", title: "customs officer", place: "customs", wage: 3, hours: [7, 15], slots: 2 },
    { id: "bakery.cook", title: "cook at the bakery", place: "bakery", wage: 3, hours: [6, 12], slots: 2 },
    { id: "mill.hand", title: "mill hand", place: "mill", wage: 3, hours: [7, 14], slots: 1 },
    { id: "inn.help", title: "help at the crown inn", place: "inn", wage: 2, hours: [8, 16], slots: 3 },
    { id: "tavern.keep", title: "tavern keeper's help", place: "tavern", wage: 2, hours: [16, 23], slots: 1 },
    { id: "fishquay.gutter", title: "fish gutter", place: "fishquay", wage: 2, hours: [5, 11], slots: 2 },
    { id: "fields.hand", title: "field hand", place: "fields", wage: 2, hours: [7, 14], slots: 2 },
    { id: "orchard.picker", title: "picker at the orchard", place: "orchard", wage: 2, hours: [7, 14], slots: 2 },
    { id: "boatyard.wright", title: "shipwright", place: "boatyard", wage: 3, hours: [8, 16], slots: 2 },
    { id: "harbor.ferry", title: "ferryman", place: "harbor", wage: 3, hours: [6, 14], slots: 2 },
    { id: "harbor.dock", title: "dock hand", place: "harbor", wage: 2, hours: [6, 12], slots: 3 },
    { id: "tradehouse.merchant", title: "merchant", place: "tradehouse", wage: 3, hours: [8, 16], slots: 1 },
  ],
  float: { inn: 80, market: 30, bakery: 40, mill: 40, harbor: 50, chandlery: 30, tavern: 30, fishquay: 30, bank: 80, weavery: 50, printhouse: 50, bookshop: 40, draper: 40, exchange: 40, fields: 30, orchard: 30, boatyard: 50, customs: 40, library: 30, academy: 30, theatre: 30, museum: 30, gardens: 30, tradehouse: 60 },
  produce: [
    { place: "fishquay", makes: "fish", qty: 10 },
    { place: "fields", makes: "grain", qty: 2, seasons: ["summer", "autumn"] }, { place: "fields", makes: "grain", qty: 1, seasons: ["spring"] },
    { place: "orchard", makes: "apples", qty: 6, seasons: ["summer", "autumn"] }, { place: "orchard", makes: "apples", qty: 2, seasons: ["spring"] },
    { place: "mill", makes: "flour", qty: 6, needs: { item: "grain", qty: 6 } },
    { place: "bakery", makes: "bread", qty: 14, needs: { item: "flour", qty: 1 } },
    { place: "weavery", makes: "cloth", qty: 3 },
    { place: "printhouse", makes: "books", qty: 2, needs: { item: "cloth", qty: 1 } },
    { place: "inn", makes: "soup", qty: 8, needs: { item: "fish", qty: 2 } }, { place: "tavern", makes: "drink", qty: 4 },
    { place: "boatyard", makes: "boat", qty: 1, needs: { item: "timber", qty: 4 } },
  ],
  feasts: [{ name: "the founding day", month: 4, day: 1, place: "forum" }, { name: "the great fair", month: 7, day: 20, place: "market" }, { name: "the lantern night", month: 10, day: 15, place: "chapel" }],
  supply: [
    // the capital has no timber of its own — the yard runs on imported wood
    { from: "harbor", to: "boatyard", item: "timber", qty: 4, price: 2, upTo: 12 },
    { from: "fields", to: "mill", item: "grain", qty: 4, price: 1, upTo: 12 }, { from: "mill", to: "bakery", item: "flour", qty: 4, price: 2, upTo: 10 },
    { from: "bakery", to: "market", item: "bread", qty: 6, price: 1, upTo: 10 }, { from: "bakery", to: "inn", item: "bread", qty: 3, price: 1, upTo: 6 },
    { from: "fishquay", to: "market", item: "fish", qty: 6, price: 1, upTo: 10 }, { from: "fishquay", to: "inn", item: "fish", qty: 4, price: 1, upTo: 8 },
    { from: "orchard", to: "market", item: "apples", qty: 4, price: 1, upTo: 8 },
    { from: "weavery", to: "market", item: "cloth", qty: 3, price: 3, upTo: 8 }, { from: "weavery", to: "draper", item: "cloth", qty: 4, price: 3, upTo: 8 }, { from: "weavery", to: "exchange", item: "cloth", qty: 3, price: 3, upTo: 6 }, { from: "weavery", to: "printhouse", item: "cloth", qty: 3, price: 3, upTo: 8 },
    { from: "printhouse", to: "bookshop", item: "books", qty: 3, price: 4, upTo: 8 }, { from: "printhouse", to: "exchange", item: "books", qty: 2, price: 4, upTo: 6 },
  ],
  // Aurelia lives on what it makes best: books and fine cloth. Its bread, fish and timber come by boat from the working islands.
  exports: [
    { item: "books", price: 4, keep: 6 }, { item: "cloth", price: 3, keep: 8 }, { item: "apples", price: 1, keep: 8 }, { item: "boat", price: 12, keep: 0 },
  ],
};
