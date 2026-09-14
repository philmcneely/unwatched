import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 35, origin: "here", summary: "A local.", want: "a good season", fear: "an empty harbor", secret: "none", strangers: "welcoming", advice: "be kind", traits: { warmth: 0.7, pride: 0.5, caution: 0.4, honesty: 0.7, ambition: 0.5 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

const island = (town: Town) => [...town.agents.values()].reduce((s, x) => s + x.coins, 0) + [...town.places.values()].reduce((s, p) => s + p.treasury, 0);
const run = (town: Town) => (town as unknown as { tourism(): void }).tourism();

describe("tourism", () => {
  it("brings visitors who leave mainland coins at the inn, the attractions and the market — conserving the island's own coins", () => {
    const town = new Town({ seed: 31, brain: none });
    town.weather = "clear"; // the boat crosses
    const inn = town.places.get("inn")!; const market = town.places.get("market")!;
    const before = island(town); const mintedBefore = town.minted;
    const innTill = inn.treasury, marketTill = market.treasury;

    run(town);

    const spent = town.minted - mintedBefore;
    expect(spent).toBeGreaterThan(0); // visitors came and spent
    // every coin the island gained came from the mainland (minted); nothing was taken from the island's own purses
    expect(island(town)).toBe(before + spent);
    // the money landed on hospitality: the inn and the market took some
    expect(inn.treasury + market.treasury).toBeGreaterThan(innTill + marketTill);
    expect(town.events.some((e) => e.kind === "boat.dock" && /visitor/.test(e.text))).toBe(true);
  });

  it("a decorated island and a feast draw a bigger crowd", () => {
    const plain = new Town({ seed: 32, brain: none }); plain.weather = "clear";
    const mintPlain = plain.minted; run(plain); const spentPlain = plain.minted - mintPlain;

    const decked = new Town({ seed: 32, brain: none }); decked.weather = "clear";
    // dress up every attraction: more to see, more visitors
    for (const p of decked.places.values()) if (p.kind === "public" || p.kind === "civic") p.decorations = [{ kind: "flowers", by: "x", name: "X", why: "pretty", day: 1, t: 0 }, { kind: "bench", by: "x", name: "X", why: "rest", day: 1, t: 0 }, { kind: "flowers", by: "x", name: "X", why: "more", day: 1, t: 0 }];
    const mintDecked = decked.minted; run(decked); const spentDecked = decked.minted - mintDecked;

    expect(spentDecked).toBeGreaterThan(spentPlain);
  });

  it("no visitors in a storm — the boat is not crossing", () => {
    const town = new Town({ seed: 33, brain: none });
    town.weather = "storm";
    const before = island(town); const mintedBefore = town.minted;
    run(town);
    expect(town.minted).toBe(mintedBefore); // nothing minted
    expect(island(town)).toBe(before); // nothing moved
  });
});
