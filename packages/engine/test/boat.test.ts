import { describe, it, expect } from "vitest";
import { Town, MINUTES_PER_DAY } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 33, origin: "the mainland", summary: "A restless person.", want: "somewhere better", fear: "staying", secret: "none", strangers: "curious", advice: "weighs it", traits: { warmth: 0.6, pride: 0.4, caution: 0.3, honesty: 0.7, ambition: 0.8 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

describe("the boat between islands", () => {
  it("carries a person, their coins, their memories and the news to another island; a harbor that does not answer keeps them home", async () => {
    // two islands in one process, each the other's harbor
    let north!: Town;
    const south = new Town({ seed: 1, brain: none, minutesPerTick: 1, name: "The island", idPrefix: "south", harbors: [{ id: "north", name: "Northreach" }], onDepart: async (p, to) => { if (to !== "north") return false; north.arrive(p); return true; } });
    north = new Town({ seed: 2, brain: none, minutesPerTick: 1, name: "Northreach", idPrefix: "north", harbors: [{ id: "south", name: "The island" }], onDepart: async () => false });
    south.papers.push({ edition: 1, date: "Day 1", weather: "rain", lead: { headline: "The mill roof came off", deck: "", body: "" }, briefs: [{ headline: "Bread at two coins", body: "" }], notices: [] });
    const a = south.addAgent({ persona: persona("Vera Lučić"), owner: "o1" });
    a.coins = 27; a.inventory.push("rope"); a.location = "harbor"; south.remember(a, "Rosa cheated me at the inn.", 0.9);
    const b = north.addAgent({ persona: persona("Local Northerner"), owner: null }); b.location = "harbor";
    while (south.hour < 9) await south.tick();
    a.location = "harbor";
    // a thought decides to cross; the crossing happens at the end of that minute
    expect(south.apply(a, { kind: "leave", to: "Northreach", why: "nothing left for me here" }, "test")).toBe(true);
    await south.tick();
    expect(south.agents.has(a.id)).toBe(false);
    expect(south.events.some((e) => e.kind === "agent.leave" && /for Northreach/.test(e.text))).toBe(true);
    const arrived = [...north.agents.values()].find((x) => x.persona.name === "Vera Lučić")!;
    expect(arrived).toBeTruthy();
    // she paid the 2-coin boat fare on the way out, so she arrives with 25 (fare routing to the harbor is asserted precisely in the tests below)
    expect(arrived.coins).toBe(25); expect(arrived.inventory).toContain("rope"); expect(arrived.owner).toBe("o1");
    expect(arrived.memory.some((m) => m.text.includes("Rosa cheated me"))).toBe(true);
    expect(arrived.memory.some((m) => m.text.includes("came here from The island"))).toBe(true);
    expect(north.events.some((e) => e.kind === "boat.news" && /mill roof/.test(e.text))).toBe(true);
    expect(north.events.some((e) => e.kind === "agent.arrive" && /from The island/.test(e.text))).toBe(true);
    expect(b.memory.some((m) => m.text.startsWith("News from The island"))).toBe(true);
    // and back the other way, to a harbor that does not answer: she stays
    arrived.location = "harbor";
    expect(north.apply(arrived, { kind: "leave", to: "south" }, "test")).toBe(true);
    await north.tick();
    expect(north.agents.has(arrived.id)).toBe(true);
    expect(north.events.some((e) => /did not sail today/.test(e.text))).toBe(true);
    // the boat never sailed, so her fare was refunded — she is no poorer for the try
    expect(arrived.coins).toBe(25);
    void MINUTES_PER_DAY;
  });

  it("routes the boat fare to whoever owns the harbor", async () => {
    // one island, no federation: the plain 'leave' still runs a boat, and its fare goes to the harbor's owner
    const town = new Town({ seed: 3, brain: none, minutesPerTick: 1, name: "The island", idPrefix: "solo" });
    const keeper = town.addAgent({ persona: persona("Harbor Keeper"), owner: "o0" });
    town.places.get("harbor")!.owner = keeper.id; // the keeper runs the quay
    const traveller = town.addAgent({ persona: persona("Wanderer"), owner: "o2" });
    traveller.coins = 10; traveller.location = "harbor";
    town.t = 9 * 60; town.weather = "clear"; // 09:00, fair weather — the boat runs; no economy ticks, so the till moves only by the fare
    const keeperBefore = keeper.coins;
    expect(town.apply(traveller, { kind: "leave", why: "off to see the world" }, "test")).toBe(true);
    expect(town.agents.has(traveller.id)).toBe(false); // they left
    expect(keeper.coins).toBe(keeperBefore + 2); // the fare reached the harbor's owner
  });

  it("never strands a broke traveller: the fare is capped at what they carry", async () => {
    const town = new Town({ seed: 4, brain: none, minutesPerTick: 1, name: "The island", idPrefix: "broke" });
    const pauper = town.addAgent({ persona: persona("Pauper"), owner: "o3" });
    pauper.coins = 1; pauper.location = "harbor"; // less than the 2-coin fare
    town.t = 9 * 60; town.weather = "clear";
    const tillBefore = town.places.get("harbor")!.treasury;
    expect(town.apply(pauper, { kind: "leave", why: "nothing here" }, "test")).toBe(true);
    expect(town.agents.has(pauper.id)).toBe(false); // still allowed to go
    expect(town.places.get("harbor")!.treasury).toBe(tillBefore + 1); // paid only the 1 coin they had
  });
});
