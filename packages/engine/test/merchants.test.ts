import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 40, origin: "here", summary: "A merchant.", want: "a fat purse", fear: "a dead market", secret: "none", strangers: "shrewd", advice: "buy the glut", traits: { warmth: 0.4, pride: 0.6, caution: 0.5, honesty: 0.6, ambition: 0.9 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

// how much money is on the island, to prove the merchant conserves it (bar what the mainland mints)
const island = (town: Town) => [...town.agents.values()].reduce((s, x) => s + x.coins, 0) + [...town.places.values()].reduce((s, p) => s + p.treasury, 0);
const run = (town: Town) => (town as unknown as { merchants(): void }).merchants();

describe("the trade house merchant", () => {
  it("buys a glut cheap and ships it to the mainland for the spread, conserving coins bar what the mainland mints", () => {
    const town = new Town({ seed: 21, brain: none });
    town.weather = "clear"; // the boat crosses, so the merchant can reach the mainland
    const house = town.places.get("tradehouse")!; // the island's own trade house (from the pack)
    const merchant = town.addAgent({ persona: persona("Ada Vance"), owner: "m0" });
    house.owner = merchant.id; merchant.coins = 100; // the trade house's purse
    // a glutted shelf of timber at the inn: 20 in stock against a plain target of 8, base 2, so its price is discounted and its half-shelf buy price is a coin
    const shelf = town.places.get("inn")!; shelf.owner = null; shelf.treasury = 50;
    shelf.sells = [{ item: "timber", base: 2 }]; shelf.stock = { timber: 20 };
    expect(town.buyPrice(shelf, "timber")).toBe(1); // the glut has made it a bargain
    const before = island(town); const mintedBefore = town.minted;

    run(town);

    // it took 4 (capped per item), paying the shelf 4, and shipped them to the mainland at the export price (2 each = 8)
    expect(shelf.stock.timber).toBe(16);
    expect(shelf.treasury).toBe(50 + 4); // the shelf was paid for its glut
    expect(merchant.coins).toBe(100 - 4 + 8); // spent 4, took 8 from the mainland (harbor cut of 8/10 rounds to 0)
    // the only new coins came from the mainland (this.minted); the island otherwise conserves
    expect(town.minted - mintedBefore).toBe(8);
    expect(island(town)).toBe(before + (town.minted - mintedBefore));
    expect(town.events.some((e) => e.kind === "boat.depart" && /shipped it to the mainland/.test(e.text))).toBe(true);
  });

  it("does no mainland trade in a storm — the boat is not crossing", () => {
    const town = new Town({ seed: 22, brain: none });
    town.weather = "storm";
    const house = town.places.get("tradehouse")!; const merchant = town.addAgent({ persona: persona("Storm-bound"), owner: "m1" });
    house.owner = merchant.id; merchant.coins = 100;
    const shelf = town.places.get("inn")!; shelf.sells = [{ item: "timber", base: 2 }]; shelf.stock = { timber: 20 };
    run(town);
    expect(shelf.stock.timber).toBe(20); // nothing moved
    expect(merchant.coins).toBe(100);
  });

  it("leaves a glut alone when there is no spread to be had", () => {
    const town = new Town({ seed: 23, brain: none });
    town.weather = "clear";
    const house = town.places.get("tradehouse")!; const merchant = town.addAgent({ persona: persona("No-margin"), owner: "m2" });
    house.owner = merchant.id; merchant.coins = 100;
    // bread exports at a coin and buys at a coin: the merchant would pay as much as it earns, so it does not bother
    const shelf = town.places.get("inn")!; shelf.owner = null; shelf.sells = [{ item: "bread", base: 1 }]; shelf.stock = { bread: 20 };
    const shelfTill = shelf.treasury;
    run(town);
    expect(shelf.stock.bread).toBe(20);
    expect(merchant.coins).toBe(100); // no spread anywhere means the purse never moves
    expect(shelf.treasury).toBe(shelfTill);
  });
});
