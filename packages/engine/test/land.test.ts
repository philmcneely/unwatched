import { describe, it, expect } from "vitest";
import { Town, ISLAND } from "../src/index.ts";
import type { Brain, AgentState, Tier, WorldPack } from "../src/index.ts";
import type { Perception, ActionProposal } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string, i: number) => ({ name, age: 30 + i, origin: "the mainland", summary: "A person.", want: "land of their own", fear: "an empty purse", secret: "none", strangers: "wary", advice: "weighs it", traits: { warmth: 0.4, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.5 } });

/** Direct calls to the engine's own private nightly hooks, exactly the way bank.test.ts and education.test.ts drive them: no tick loop, no habit noise, just the mechanism itself. */
function tryBuyWildLandOf(town: Town) { return (town as unknown as { tryBuyWildLand(): void }).tryBuyWildLand(); }
function tryDevelopWildLandOf(town: Town) { return (town as unknown as { tryDevelopWildLand(): void }).tryDevelopWildLand(); }
function tendFarmsOf(town: Town) { return (town as unknown as { tendFarms(): void }).tendFarms(); }
function tourismOf(town: Town) { return (town as unknown as { tourism(): void }).tourism(); }

/** The default island pack, plus one parcel of wild land the town has never put to any work: no job on it, nothing produced from it — unlike pinewood or the quarry, which are wild land already spoken for and must stay untouched by this layer. */
function packWithWildLand(): WorldPack {
  const pack: WorldPack = structuredClone(ISLAND);
  pack.places.push({ id: "backforty", name: "the back forty", kind: "wild", district: "hill", sprite: "field", x: 2500, y: 1500, exits: ["hill"] });
  return pack;
}

/** A day-end pass through every night-end hook this layer added, in the order `nightly()` runs them. Agents start asleep and it is never a Sunday, mirroring bank.test.ts / education.test.ts setup. */
function runLandNight(town: Town) { tryBuyWildLandOf(town); tryDevelopWildLandOf(town); tendFarmsOf(town); }

describe("wild land — buying it, and the farm-or-park tradeoff", () => {
  it("a citizen with capital buys the town's wild land; a broke one cannot", () => {
    const town = new Town({ seed: 60, brain: none, pack: packWithWildLand() });
    const rich = town.addAgent({ persona: persona("Landed", 1) });
    const broke = town.addAgent({ persona: persona("Broke", 2) });
    rich.savings = 100; rich.coins = 0;
    broke.savings = 0; broke.coins = 0; broke.debt = 1000; broke.debtPrincipal = 1000; // borrowed to the hilt: no standing left to lend against

    const savingsBefore = rich.savings; const mintedBefore = town.minted;
    for (let i = 0; i < 80; i++) runLandNight(town);

    const parcel = town.places.get("backforty")!;
    expect(parcel.owner).toBe(rich.id); // the capitalized citizen bought it
    expect(parcel.owner).not.toBe(broke.id); // the broke one never could
    expect(rich.savings).toBe(savingsBefore - 20); // paid for out of savings
    expect(town.minted).toBeGreaterThan(mintedBefore); // new coin to the till, not conjured or taken from anyone else
    expect(town.events.some((e) => e.kind === "town.built" && e.actors[0] === rich.id && (e.payload as { land?: boolean } | undefined)?.land)).toBe(true);
  });

  it("does not sell pinewood or the quarry — wild land already put to work stays untouched", () => {
    const town = new Town({ seed: 61, brain: none }); // the plain default pack: no idle wild parcel of its own
    const rich = town.addAgent({ persona: persona("Eager", 1) });
    rich.savings = 100_000;
    for (let i = 0; i < 200; i++) runLandNight(town);
    expect(town.places.get("pinewood")!.owner).toBeNull();
    expect(town.places.get("quarry")!.owner).toBeNull();
  });

  it("is a graceful no-op on a town with no wild land to sell", () => {
    const town = new Town({ seed: 62, brain: none }); // default pack: no idle parcel
    const a = town.addAgent({ persona: persona("Hopeful", 1) });
    a.savings = 100_000;
    const before = town.snapshot();
    for (let i = 0; i < 100; i++) runLandNight(town);
    expect([...town.places.values()].some((p) => p.kind === "wild" && p.owner)).toBe(false);
    expect(town.events.some((e) => (e.payload as { land?: boolean } | undefined)?.land)).toBe(false);
    // nothing else about the town moved either
    expect(town.snapshot().places?.length).toBe(before.places?.length);
  });

  it("an owner schooled enough breaks bought land to the plough; a farm yields food, better for the more educated", () => {
    const town = new Town({ seed: 63, brain: none, pack: packWithWildLand() });
    const scholar = town.addAgent({ persona: persona("Scholar", 1), intelligence: 0.9, education: 0.9 });
    const parcel = town.places.get("backforty")!;
    parcel.owner = scholar.id;
    for (let i = 0; i < 40; i++) tryDevelopWildLandOf(town);
    expect(parcel.landUse).toBe("farm"); // schooled enough to put it to the plough

    const before = parcel.stock.vegetables ?? 0;
    tendFarmsOf(town);
    expect(parcel.stock.vegetables ?? 0).toBeGreaterThan(before); // a farm yields food

    // an educated, sharp owner draws more from the same parcel than a dull, unschooled one
    const dullTown = new Town({ seed: 63, brain: none, pack: packWithWildLand() });
    const dull = dullTown.addAgent({ persona: persona("Scholar", 1), intelligence: 0.2, education: 0 });
    const dullParcel = dullTown.places.get("backforty")!;
    dullParcel.owner = dull.id; dullParcel.landUse = "farm";
    tendFarmsOf(dullTown);
    expect(dullParcel.stock.vegetables ?? 0).toBeLessThan(parcel.stock.vegetables ?? 0);
  });

  it("an unschooled owner leaves bought land standing as a park instead of a farm", () => {
    const town = new Town({ seed: 64, brain: none, pack: packWithWildLand() });
    const plain = town.addAgent({ persona: persona("Plain", 1), intelligence: 0.3, education: 0.05 });
    const parcel = town.places.get("backforty")!;
    parcel.owner = plain.id;
    for (let i = 0; i < 40; i++) tryDevelopWildLandOf(town);
    expect(parcel.landUse).toBe("park");
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === plain.id && (e.payload as { park?: boolean } | undefined)?.park)).toBe(true);
  });

  it("a national park raises the island's visitor income, and cannot be farmed or built on", () => {
    const plainTown = new Town({ seed: 65, brain: none, pack: packWithWildLand() }); plainTown.weather = "clear";
    const parkTown = new Town({ seed: 65, brain: none, pack: packWithWildLand() }); parkTown.weather = "clear";
    const keeper = parkTown.addAgent({ persona: persona("Keeper", 1) });
    const parkParcel = parkTown.places.get("backforty")!;
    parkParcel.owner = keeper.id; parkParcel.landUse = "park";
    // dress the park up a little, the same way any attraction draws more of a look
    parkParcel.decorations = [{ kind: "flowers", by: keeper.id, name: "Keeper", why: "a nicer view", day: 1, t: 0 }, { kind: "bench", by: keeper.id, name: "Keeper", why: "a place to sit", day: 1, t: 0 }];

    const mintedBeforePlain = plainTown.minted; tourismOf(plainTown); const spentPlain = plainTown.minted - mintedBeforePlain;
    const mintedBeforePark = parkTown.minted; tourismOf(parkTown); const spentPark = parkTown.minted - mintedBeforePark;
    expect(spentPark).toBeGreaterThan(spentPlain); // the park is a draw the plain island doesn't have

    // it cannot be farmed: tending farms leaves it exactly as it was
    const stockBefore = parkParcel.stock.vegetables ?? 0;
    tendFarmsOf(parkTown);
    expect(parkParcel.stock.vegetables ?? 0).toBe(stockBefore);
    // it cannot be developed into a farm later either — once decided, it stays decided
    tryDevelopWildLandOf(parkTown);
    expect(parkParcel.landUse).toBe("park");
    // and it cannot be built on: "build" is never among a citizen's options on wild land, park or not
    const other = parkTown.addAgent({ persona: persona("Visitor", 2) });
    other.location = "backforty"; other.asleep = false;
    expect(parkTown.perceive(other).options).not.toContain("build");
  });

  it("survives a snapshot and restore intact: owner, and whether it became a farm or a park", () => {
    const town = new Town({ seed: 66, brain: none, pack: packWithWildLand() });
    const owner = town.addAgent({ persona: persona("Kept", 1) });
    const parcel = town.places.get("backforty")!;
    parcel.owner = owner.id; parcel.landUse = "farm"; parcel.stock.vegetables = 7;

    const town2 = new Town({ seed: 66, brain: none, pack: packWithWildLand() });
    town2.restore(town.snapshot());
    const restored = town2.places.get("backforty")!;
    expect(restored.owner).toBe(owner.id);
    expect(restored.landUse).toBe("farm");
    expect(restored.stock.vegetables).toBe(7);
  });
});
