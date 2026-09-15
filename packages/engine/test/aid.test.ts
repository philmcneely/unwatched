import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

describe("distress signal + food aid", () => {
  it("a healthy island is not in distress; a wrecked one is", () => {
    const town = new Town({ seed: 3, brain: none });
    expect(town.distressed).toBe(false);
    town.flood(); // wrecks the fields/harbour
    expect(town.distressed).toBe(true);
  });

  it("foodAid offers a gift of spare food off the shelves, keeping a reserve", () => {
    const town = new Town({ seed: 3, brain: none });
    const market = town.places.get("market")!;
    market.stock.bread = 12; market.stock.fish = 2; // fish under the reserve, bread over
    const aid = town.foodAid();
    const bread = aid.find((x) => x.item === "bread" && x.place === "market");
    expect(bread).toBeTruthy();
    expect(bread!.price).toBe(0); // a gift, not a sale
    expect(bread!.qty).toBeGreaterThan(0);
    expect(bread!.qty).toBeLessThanOrEqual(6); // a modest parcel
    // the 2 fish are under the reserve, so they are not given away
    expect(aid.some((x) => x.item === "fish" && x.place === "market")).toBe(false);
  });
});
