import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal } from "@unwatched/protocol";

/** The physics of a death alone, on habit — no LLM needed to move a coin or a deed. */
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string) => ({ name, age: 40, origin: "the mainland", summary: "A settled person.", want: "to leave something behind", fear: "dying with debts unpaid", secret: "none", strangers: "polite", advice: "listens", traits: { warmth: 0.6, pride: 0.4, caution: 0.5, honesty: 0.7, ambition: 0.4 } });

/** Every coin on the island: what agents carry, plus what tills hold. Savings and bank debt are off this ledger by design (a deposit already left circulation; a loan is never minted) — inheritance must never touch that count. */
function coinsOnIsland(town: Town): number {
  let s = 0; for (const a of town.agents.values()) s += a.coins; for (const p of town.places.values()) s += p.treasury; return s;
}

/** Get a fresh town, past Sunday (so the council would be in session were it needed) with everyone awake and idle, the same setup bank.test.ts and crime.test.ts use before hand-driving state. */
async function freshTown(seed: number): Promise<Town> {
  const town = new Town({ seed, brain: none, minutesPerTick: 1 });
  while (town.weekday === 0) await town.tick(); // the council does not sit on Sunday
  for (const a of town.agents.values()) a.asleep = false;
  return town;
}

describe("inheritance & legacy on death", () => {
  it("a partner inherits the house, the coins, and the debt that came with it", async () => {
    const town = await freshTown(1);
    const owner = town.addAgent({ persona: persona("Owner Kos") });
    const partner = town.addAgent({ persona: persona("Partner Kos") });
    const house = town.places.get("lane-1")!; house.kind = "home"; house.owner = owner.id; house.name = "the Kos house"; house.beds = { price: 2, capacity: 2 }; house.freeBeds = 2;
    owner.home = { place: house.id, nightsPaid: 36500 }; partner.home = { place: house.id, nightsPaid: 30 };
    owner.location = house.id; partner.location = house.id; owner.asleep = false; partner.asleep = false;
    owner.coins = 50; owner.savings = 20; owner.debt = 12; owner.debtPrincipal = 12;
    partner.coins = 5;
    const before = coinsOnIsland(town);

    town.removeAgent(owner.id, "died", "test");

    expect(town.agents.has(owner.id)).toBe(false);
    expect(house.owner).toBe(partner.id);
    expect(partner.coins).toBe(5 + 50); // the estate's coins, moved whole to the sole heir
    expect(partner.savings).toBe(0 + 20);
    expect(partner.debt).toBe(0 + 12); // the debt rode along with the estate
    expect(partner.debtPrincipal).toBe(12);
    // not a mint, not a burn: what was on the island stays on the island
    expect(coinsOnIsland(town)).toBe(before);
    const ev = town.events.find((e) => e.kind === "agent.inherit" && e.actors[0] === partner.id);
    expect(ev).toBeTruthy();
    expect(ev!.text).toMatch(/Partner Kos/); expect(ev!.text).toMatch(/50 coins/); expect(ev!.text).toMatch(/debt/i);
  });

  it("with no partner, a single grown child inherits the shop and the debt", async () => {
    const town = await freshTown(2);
    const parent = town.addAgent({ persona: persona("Widow Reyes") });
    const child = town.addAgent({ persona: persona("Reyes Child") });
    child.parents = [parent.id]; // set at coming of age, normally — here, directly, the same fact
    const shop = town.places.get("market")!; const priorShopOwner = shop.owner; shop.owner = parent.id;
    parent.coins = 44; parent.debt = 6; parent.debtPrincipal = 6;
    child.coins = 3;
    const before = coinsOnIsland(town);

    town.removeAgent(parent.id, "died", "test");

    expect(shop.owner).toBe(child.id);
    expect(child.coins).toBe(3 + 44);
    expect(child.debt).toBe(6);
    expect(coinsOnIsland(town)).toBe(before);
    const ev = town.events.find((e) => e.kind === "agent.inherit" && e.actors[0] === child.id);
    expect(ev).toBeTruthy(); expect(ev!.text).toMatch(/Reyes Child/);
    shop.owner = priorShopOwner; // leave the shared pack place as we found it
  });

  it("multiple children split the estate evenly, remainder to the first, and nothing is lost to rounding", async () => {
    const town = await freshTown(3);
    const parent = town.addAgent({ persona: persona("Magnate Vance") });
    const c1 = town.addAgent({ persona: persona("Vance Elder") });
    const c2 = town.addAgent({ persona: persona("Vance Younger") });
    c1.parents = [parent.id]; c2.parents = [parent.id];
    const land = town.places.get("field-1") ?? [...town.places.values()].find((p) => p.kind === "wild" || p.kind === "plot");
    if (land) land.owner = parent.id;
    // the magnate dies rich: a large, odd-numbered estate to make sure the split is exact
    parent.coins = 100_001; parent.savings = 4_001; parent.debt = 101; parent.debtPrincipal = 101;
    c1.coins = 0; c2.coins = 0;
    const before = coinsOnIsland(town);

    town.removeAgent(parent.id, "died", "test");

    const heirs = [c1, c2];
    const totalCoinsToHeirs = heirs.reduce((s, h) => s + h.coins, 0);
    const totalDebtToHeirs = heirs.reduce((s, h) => s + (h.debt ?? 0), 0);
    const totalSavingsToHeirs = heirs.reduce((s, h) => s + (h.savings ?? 0), 0);
    expect(totalCoinsToHeirs).toBe(100_001); // exact — the odd coin does not vanish
    expect(totalDebtToHeirs).toBe(101);
    expect(totalSavingsToHeirs).toBe(4_001);
    expect(c1.coins).toBeGreaterThan(0); expect(c2.coins).toBeGreaterThan(0);
    if (land) expect([c1.id, c2.id]).toContain(land.owner);
    expect(coinsOnIsland(town)).toBe(before);
  });

  it("with no heir at all, the estate escheats to the council and the place stands free", async () => {
    const town = await freshTown(4);
    const loner = town.addAgent({ persona: persona("Loner Frost") });
    const house = town.places.get("lane-2")!; house.kind = "home"; house.owner = loner.id; house.beds = { price: 9, capacity: 1 }; house.freeBeds = 1;
    loner.home = { place: house.id, nightsPaid: 30 }; loner.location = house.id; loner.asleep = false;
    loner.coins = 33; loner.savings = 10; loner.debt = 4;
    const council = town.places.get("council")!;
    const treasuryBefore = council.treasury;
    const before = coinsOnIsland(town);

    town.removeAgent(loner.id, "died", "test");

    expect(house.owner).toBeNull();
    expect(house.beds!.price).toBe(2); // stands free, at the ordinary price, the same as any abandoned home
    expect(council.treasury).toBe(treasuryBefore + 33); // real coins escheat — a transfer, not a mint
    expect(coinsOnIsland(town)).toBe(before);
    const ev = town.events.find((e) => e.kind === "agent.inherit" && e.actors[0] === loner.id);
    expect(ev).toBeTruthy(); expect(ev!.text).toMatch(/Nobody came/);
  });

  it("survives a snapshot and restore: the heir link persists, and a death in the restored town still inherits correctly", async () => {
    const town = await freshTown(5);
    const parent = town.addAgent({ persona: persona("Sailor Wren") });
    const child = town.addAgent({ persona: persona("Wren Child") });
    child.parents = [parent.id];
    parent.coins = 22; child.coins = 0;

    const town2 = new Town({ seed: 5, brain: none, minutesPerTick: 1 });
    town2.restore(town.snapshot());
    const restoredChild = town2.agents.get(child.id)!;
    expect(restoredChild.parents).toEqual([parent.id]);

    town2.removeAgent(parent.id, "died", "test");
    const restoredHeir = town2.agents.get(child.id)!;
    expect(restoredHeir.coins).toBe(22);
    expect(town2.events.some((e) => e.kind === "agent.inherit" && e.actors[0] === child.id)).toBe(true);
  });

  it("leaves a normal, living citizen untouched", async () => {
    const town = await freshTown(6);
    const a = town.addAgent({ persona: persona("Ordinary Pike") });
    a.coins = 17; a.savings = 3; a.debt = 0;
    for (let t = 0; t < 50; t++) await town.tick();
    expect(town.agents.has(a.id)).toBe(true);
    expect(a.coins).toBeGreaterThanOrEqual(0);
    expect(a.parents ?? null).toBeNull();
    expect(town.events.some((e) => e.kind === "agent.inherit")).toBe(false);
  });
});
