import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
void ({} as Persona);

describe("the fishery — a renewable that overfishing can crash", () => {
  it("depletes as it is fished, caps the catch when thin, and recovers when rested", () => {
    const town = new Town({ seed: 1, brain: none });
    town.weather = "clear"; // the sea is worked
    const fh = town.places.get("fishhouse")!;
    const P = town as unknown as { produce(p: typeof fh): void; regenFishery(): void };
    const max = town.fisheryMax;
    expect(max).toBeGreaterThan(0); expect(town.fishery).toBe(max);

    // overfish: catch and catch and catch, with no time for the sea to recover
    for (let i = 0; i < 40; i++) P.produce(fh);
    expect(town.fishery).toBeLessThan(max * 0.3); // the grounds are thinned

    // when thin, the catch can't exceed what's left in the sea
    fh.stock.fish = 0; town.fishery = 3;
    P.produce(fh);
    expect(fh.stock.fish).toBeLessThanOrEqual(3);
    expect(town.fishery).toBe(0);

    // rest the grounds: they grow back
    town.fishery = Math.round(max * 0.1);
    for (let d = 0; d < 60; d++) P.regenFishery();
    expect(town.fishery).toBeGreaterThan(max * 0.5);
  });
});
