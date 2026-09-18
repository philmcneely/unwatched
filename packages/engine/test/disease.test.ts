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
const persona = (name: string): Persona => ({ name, age: 33, origin: "the mainland", summary: "A person.", want: "to be well", fear: "sickness", secret: "none", strangers: "wary", advice: "considers it", traits: { warmth: 0.5, pride: 0.4, caution: 0.4, honesty: 0.6, ambition: 0.4 } });

// day-end only, exactly like the other day-end mechanics' own tests (bank, magnate, water): calling it directly,
// with no tick() in between, advances the body/disease bookkeeping one night at a time without habit walking
// anyone anywhere — the only way to hold two agents apart across many simulated nights on purpose.
function nightlyOf(town: Town) { return (town as unknown as { nightly(): Promise<void> }).nightly(); }

describe("disease", () => {
  it("spreads to a co-located agent, never touches someone elsewhere on the island, and the source recovers with a spell of immunity", async () => {
    const town = new Town({ seed: 40, brain: none });
    const patient = town.addAgent({ persona: persona("Patient Zero") });
    const near = town.addAgent({ persona: persona("Neighbour") });
    const far = town.addAgent({ persona: persona("Elsewhere") });
    patient.location = "harbor"; near.location = "harbor"; far.location = "market";
    expect(near.illness.sick).toBe(false);
    expect(far.illness.sick).toBe(false);

    // the source is kept infectious across the observation window (re-set each morning) so the test isolates
    // the SPREAD roll on its own, rather than depending on exactly when the source's own recovery happens to land
    for (let day = 0; day < 30 && !near.illness.sick; day++) {
      patient.illness = { sick: true, since: town.day, immuneUntil: 0 };
      await nightlyOf(town);
    }

    expect(near.illness.sick).toBe(true); // shared a place with someone sick, night after night
    expect(far.illness.sick).toBe(false); // never once shared a place with anyone sick
    const fellIll = town.events.find((e) => e.kind === "agent.weak" && e.actors[0] === near.id && (e.payload as { illness?: string } | undefined)?.illness === "sick");
    expect(fellIll).toBeDefined();

    // now leave the source alone: within the week it throws the illness off on its own and keeps a spell of immunity
    patient.illness = { sick: true, since: town.day, immuneUntil: 0 };
    for (let day = 0; day < 8; day++) await nightlyOf(town);
    expect(patient.illness.sick).toBe(false);
    expect(patient.illness.immuneUntil).toBeGreaterThan(town.day);
    const recovered = town.events.find((e) => e.kind === "town.notice" && e.actors[0] === patient.id && (e.payload as { illness?: string } | undefined)?.illness === "recovered");
    expect(recovered).toBeDefined();
  });

  it("rides the boat: a sick traveller arrives sick at the destination, and can infect a citizen there the same way", async () => {
    let north!: Town;
    const south = new Town({ seed: 50, brain: none, minutesPerTick: 1, name: "The island", idPrefix: "south", harbors: [{ id: "north", name: "Northreach" }], onDepart: async (p, to) => { if (to !== "north") return false; north.arrive(p); return true; } });
    north = new Town({ seed: 51, brain: none, minutesPerTick: 1, name: "Northreach", idPrefix: "north", harbors: [{ id: "south", name: "The island" }], onDepart: async () => false });
    const traveller = south.addAgent({ persona: persona("Typhoid Traveller") });
    traveller.illness = { sick: true, since: south.day, immuneUntil: 0 };
    traveller.location = "harbor"; traveller.coins = 20;
    const local = north.addAgent({ persona: persona("Northreach Local") }); local.location = "harbor";
    expect(local.illness.sick).toBe(false);

    while (south.hour < 9) await south.tick();
    traveller.location = "harbor";
    expect(south.apply(traveller, { kind: "leave", to: "Northreach", why: "seeking a cure" }, "test")).toBe(true);
    await south.tick();
    expect(south.agents.has(traveller.id)).toBe(false);

    const arrived = [...north.agents.values()].find((x) => x.persona.name === "Typhoid Traveller")!;
    expect(arrived).toBeTruthy();
    expect(arrived.location).toBe("harbor"); // same place the local is, so the next night can test the spread
    expect(arrived.illness.sick).toBe(true); // the illness rode the boat with them, the same in-process way a fugitive's name does
    expect(north.events.some((e) => e.kind === "town.notice" && e.actors[0] === arrived.id && /already sick/.test(e.text))).toBe(true);

    // and from there it spreads at the destination exactly as it would have at home
    for (let day = 0; day < 30 && !local.illness.sick; day++) {
      arrived.illness = { sick: true, since: north.day, immuneUntil: 0 };
      await nightlyOf(north);
    }
    expect(local.illness.sick).toBe(true);
  });

  it("survives a snapshot/restore round trip, sick or recovered-and-immune alike", () => {
    const town = new Town({ seed: 42, brain: none });
    const sick = town.addAgent({ persona: persona("Down With It") });
    sick.illness = { sick: true, since: 3, immuneUntil: 0 };
    const immune = town.addAgent({ persona: persona("Recovered") });
    immune.illness = { sick: false, since: 0, immuneUntil: 25 };
    const untouched = town.addAgent({ persona: persona("Never Sick") });

    const snap = town.snapshot();
    const town2 = new Town({ seed: 42, brain: none });
    town2.restore(snap);

    expect(town2.agents.get(sick.id)!.illness).toEqual({ sick: true, since: 3, immuneUntil: 0 });
    expect(town2.agents.get(immune.id)!.illness).toEqual({ sick: false, since: 0, immuneUntil: 25 });
    expect(town2.agents.get(untouched.id)!.illness).toEqual({ sick: false, since: 0, immuneUntil: 0 });
  });

  it("a snapshot from before illness existed restores a healthy, unmarked citizen", () => {
    const town = new Town({ seed: 43, brain: none });
    const a = town.addAgent({ persona: persona("Old Record") });
    const snap = town.snapshot();
    // simulate an older record that never had an `illness` field on the wire
    delete (snap.agents.find((s) => s.id === a.id)!.state as { illness?: unknown }).illness;
    const town2 = new Town({ seed: 43, brain: none });
    town2.restore(snap);
    expect(town2.agents.get(a.id)!.illness).toEqual({ sick: false, since: 0, immuneUntil: 0 });
  });
});
