import { describe, it, expect } from "vitest";
import { Town, ISLAND, CAIRNHOLD, MINUTES_PER_DAY } from "../src/index.ts";
import type { Brain } from "../src/index.ts";

const none: Brain = {
  name: "none", async decide() { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

describe("comparative advantage and specialization", () => {
  it("reads a pack's own specialty and its dependency straight off produce/supply, not a hardcoded list", () => {
    const woodIsland = new Town({ seed: 1, brain: none, pack: ISLAND });
    // the wooded island makes timber and planks itself, needs nothing off the boat for its boatyard
    expect(woodIsland.tradeDependentItems()).toEqual([]);
    expect(woodIsland.specialties()).toContain("lavender"); // its cash crop: grown for the boat alone, nothing local ever consumes it

    const hill = new Town({ seed: 2, brain: none, pack: CAIRNHOLD, idPrefix: "hill" });
    // the mining hill grows no grain and has no wood: flour and timber come off the boat alone
    expect(hill.tradeDependentItems().sort()).toEqual(["flour", "timber"]);
    // and it sells what its own ground gives, finished: stone, coal, nails and tools (iron itself is an intermediate — smithed further, not a specialty of its own)
    expect(hill.specialties()).toEqual(expect.arrayContaining(["stone", "coal", "nails", "tools"]));
    expect(hill.specialties()).not.toContain("iron");
  });
});

describe("trade over the boat: surplus exported, deficit imported, coins conserved", () => {
  it("one island's surplus timber fills the mining hill's empty boatyard shelf; coins leave the hill and arrive at the wooded island, none minted by the trade", () => {
    const south = new Town({ seed: 1, brain: none, pack: ISLAND });
    const hill = new Town({ seed: 2, brain: none, pack: CAIRNHOLD, idPrefix: "hill" });
    south.places.get("pinewood")!.stock.timber = 100; // well above what it keeps

    const offers = south.cargoOffers().filter((o) => o.item === "timber");
    expect(offers.length).toBeGreaterThan(0);
    const wants = hill.cargoWants().find((w) => w.item === "timber");
    expect(wants).toBeTruthy();
    expect(wants!.qty).toBeGreaterThan(0);

    const coinsHillBefore = [...hill.places.values()].reduce((s, p) => s + p.treasury, 0);
    const coinsSouthBefore = [...south.places.values()].reduce((s, p) => s + p.treasury, 0);
    const load = offers.map((o) => ({ ...o, qty: Math.min(o.qty, wants!.qty) }));
    const taken = hill.receive(load, "the wooded island");
    expect(taken).toEqual([{ item: "timber", qty: wants!.qty }]);
    south.ship(load, "the mining hill");

    const coinsHillAfter = [...hill.places.values()].reduce((s, p) => s + p.treasury, 0);
    const coinsSouthAfter = [...south.places.values()].reduce((s, p) => s + p.treasury, 0);
    const paid = coinsHillBefore - coinsHillAfter;
    expect(paid).toBeGreaterThan(0);
    expect(coinsSouthAfter - coinsSouthBefore).toBe(paid); // every coin that left the hill landed in the south's till
    expect(hill.burned).toBe(paid); expect(south.minted).toBe(paid); // and each island's own books balance against it
    expect(hill.events.some((e) => e.kind === "boat.cargo" && /brought .* timber/.test(e.text))).toBe(true);
    // the hill remembers who it got the timber from — a trade partner an owner can be told about
    expect(hill.tradePartners.timber).toBe("the wooded island");
  });

  it("a shelf that cannot pay takes nothing, and mints or burns nothing in the attempt", () => {
    const south = new Town({ seed: 1, brain: none, pack: ISLAND });
    const hill = new Town({ seed: 2, brain: none, pack: CAIRNHOLD, idPrefix: "hill" });
    south.places.get("pinewood")!.stock.timber = 100;
    hill.places.get("boatyard")!.treasury = 0;
    const load = south.cargoOffers().filter((o) => o.item === "timber");
    expect(hill.receive(load, "the wooded island")).toEqual([]);
    expect(hill.burned).toBe(0); expect(south.minted).toBe(0);
  });
});

describe("hostility bites: cutting the route starves what the island cannot make itself", () => {
  it("a healthy, well-supplied hill is not distressed", () => {
    const hill = new Town({ seed: 3, brain: none, pack: CAIRNHOLD, idPrefix: "hill", minutesPerTick: MINUTES_PER_DAY });
    expect(hill.distressed).toBe(false);
    expect(hill.tradeShortages.size).toBe(0);
  });

  it("a blockaded route empties the shelf over real days, marks the shortage, spikes the price, and couples into distress — then clears once the boat runs again", async () => {
    const hill = new Town({ seed: 4, brain: none, pack: CAIRNHOLD, idPrefix: "hill", minutesPerTick: MINUTES_PER_DAY });
    hill.places.get("boatyard")!.stock.timber = 0; // the blockade already has: nothing has landed in days
    expect(hill.tradeShortages.has("timber")).toBe(false); // not yet marked — the night has not turned

    await hill.tick(); // one day's end with the shelf bare

    expect(hill.tradeShortages.has("timber")).toBe(true);
    expect(hill.distressed).toBe(true);
    expect(hill.events.some((e) => e.kind === "economy.price" && /no timber off the boat/.test(e.text))).toBe(true);
    // the shortage itself adds a coin wherever the good is still sold at all — a bare-shelf good priced normally (5 of 12, above the plain scarcity band) still costs more while the boat brings none
    const shelf = { ...hill.places.get("boatyard")!, sells: [{ item: "timber", base: 3 }], stock: { timber: 5 } };
    const bumped = hill.price(shelf, "timber");
    hill.tradeShortages.delete("timber"); const notBumped = hill.price(shelf, "timber"); hill.tradeShortages.add("timber");
    expect(bumped!).toBeGreaterThan(notBumped!);

    // survives a snapshot/restore
    const snap = hill.snapshot();
    const restored = new Town({ seed: 4, brain: none, pack: CAIRNHOLD, idPrefix: "hill", minutesPerTick: MINUTES_PER_DAY });
    restored.restore(snap);
    expect(restored.tradeShortages.has("timber")).toBe(true);
    expect(restored.distressed).toBe(true);

    // the blockade lifts: the boat brings a real load in, above the bare-shelf threshold
    const boatyard = hill.places.get("boatyard")!;
    boatyard.stock.timber = 12;
    await hill.tick();
    expect(hill.tradeShortages.has("timber")).toBe(false);
    expect(hill.events.some((e) => e.kind === "economy.price" && /coming in off the boat again/.test(e.text))).toBe(true);
  });
});
