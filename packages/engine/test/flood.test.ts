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

describe("tsunami — a disaster that wrecks the farms and coast", () => {
  it("breaks the harbour and fields for days, washes their stores away, and stops production until they recover", () => {
    const town = new Town({ seed: 2, brain: none });
    const fields = town.places.get("fields")!, harbor = town.places.get("harbor")!;
    fields.stock.grain = 50; harbor.treasury = 30;
    const burnedBefore = town.burned;

    town.flood();

    expect(fields.brokenUntil).toBeGreaterThan(town.day); // wrecked for days
    expect(harbor.brokenUntil).toBeGreaterThan(town.day);
    expect(fields.stock.grain).toBe(0); // stores lost to the water
    expect(harbor.treasury).toBe(0);
    expect(town.burned).toBeGreaterThanOrEqual(burnedBefore + 30); // the coins (harbour's + the other coastal tills) went into the sea
    expect(town.events.some((e) => e.payload?.disaster === "tsunami")).toBe(true);

    // a broken field makes nothing until it recovers
    town.weather = "clear";
    (town as unknown as { produce(p: typeof fields): void }).produce(fields);
    expect(fields.stock.grain ?? 0).toBe(0);
  });
});
