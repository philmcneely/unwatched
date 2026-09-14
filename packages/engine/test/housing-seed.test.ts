import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 30, origin: "here", summary: "A soul.", want: "a home", fear: "the street", secret: "none", strangers: "open", advice: "gets on", traits: { warmth: 0.5, pride: 0.5, caution: 0.5, honesty: 0.6, ambition: 0.6 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

describe("a fresh island houses its people as a mix, not a dormitory", () => {
  it("gives owner-occupiers, landlords with more than one, renters, and a few inn-lodgers", () => {
    const town = new Town({ seed: 7, brain: none });
    for (let i = 0; i < 20; i++) town.addAgent({ persona: persona(`P${i}`), owner: null });
    town.settleInitialHousing();
    const citizens = [...town.agents.values()];
    const homePlaces = [...town.places.values()].filter((p) => p.kind === "home");

    // most people live in a real home, not the inn
    const inRealHome = citizens.filter((a) => a.home && a.home.place !== "inn").length;
    expect(inRealHome).toBeGreaterThan(citizens.length * 0.5);

    // some own the roof they sleep under
    const ownerOccupiers = citizens.filter((a) => a.home && town.places.get(a.home.place)?.owner === a.id).length;
    expect(ownerOccupiers).toBeGreaterThan(0);

    // some own MORE than one home (landlords)
    const owned = new Map<string, number>();
    for (const p of homePlaces) if (p.owner) owned.set(p.owner, (owned.get(p.owner) ?? 0) + 1);
    const landlords = [...owned.values()].filter((c) => c >= 2).length;
    expect(landlords).toBeGreaterThanOrEqual(1);

    // some rent — their home is owned by someone else (rent flows to that owner)
    const renters = citizens.filter((a) => { const h = a.home && town.places.get(a.home.place); return !!h && !!h.owner && h.owner !== a.id; }).length;
    expect(renters).toBeGreaterThan(0);

    // never over-full: no home holds more residents than it has beds
    for (const p of homePlaces) { const here = citizens.filter((a) => a.home?.place === p.id).length; expect(here, `${p.id} over capacity`).toBeLessThanOrEqual(p.beds?.capacity ?? 0); }
  });
});
