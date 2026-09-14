import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 30, origin: "here", summary: "A trader.", want: "a good price", fear: "a glut", secret: "none", strangers: "curious", advice: "buy low", traits: { warmth: 0.5, pride: 0.5, caution: 0.5, honesty: 0.6, ambition: 0.7 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

describe("supply and demand at the shelf", () => {
  it("a bare shelf asks more, a piled-high one asks less, and it stays within a coin of the base", () => {
    const town = new Town({ seed: 7, brain: none });
    const market = town.places.get("market")!;
    market.owner = null; market.treasury = 0; // no owner, empty till: neither ownership nor a full till skews the price
    market.sells = [{ item: "widget", base: 4 }]; // no supply line feeds this, so the shelf target is the plain default (8)
    // mid stock: the base price stands
    market.stock = { widget: 8 };
    expect(town.price(market, "widget")).toBe(4);
    // nearly bare (at or below a fifth of the target): a coin more
    market.stock = { widget: 1 };
    expect(town.price(market, "widget")).toBe(5);
    // piled past double the target: a coin less
    market.stock = { widget: 16 };
    expect(town.price(market, "widget")).toBe(3);
    // the swing is bounded — even a huge pile only takes off one coin, never below a coin
    market.stock = { widget: 999 };
    expect(town.price(market, "widget")).toBe(3);
    market.sells = [{ item: "widget", base: 1 }]; market.stock = { widget: 999 };
    expect(town.price(market, "widget")).toBe(1); // a glut can't push a cheap thing below one coin
  });

  it("follows the supply line's own target when a cart feeds the shelf", () => {
    const town = new Town({ seed: 8, brain: none });
    const market = town.places.get("market")!;
    market.owner = null; market.treasury = 0;
    // bread on the island market is fed by a cart with its own upTo; scarcity keys off that target, not the default
    const bread = market.sells.find((s) => s.item === "bread");
    if (bread) { const base = bread.base; market.stock = { bread: 1 }; expect(town.price(market, "bread")).toBe(base + 1); }
  });
});
