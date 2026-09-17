import { describe, it, expect } from "vitest";
import { Town, MINUTES_PER_DAY } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "A room.", fear: "Debt.", secret: "None.", strangers: "Polite.", advice: "Considers it.", traits: { warmth: 0.4, pride: 0.4, caution: 0.4, honesty: 0.6, ambition: 0.3 } });

describe("crime & notoriety", () => {
  it("a fresh citizen starts at 0", () => {
    const town = new Town({ seed: 30, brain: none });
    const fresh = town.addAgent({ persona: persona("Fresh Face") });
    expect(fresh.notoriety).toBe(0);
  });

  it("an accusation nudges notoriety a little, and a guilty verdict raises it more", async () => {
    const town = new Town({ seed: 31, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Accuser") });
    const c = town.addAgent({ persona: persona("Culprit") });
    expect(c.notoriety).toBe(0);
    while (town.weekday === 0) await town.tick(); // the council does not sit on Sunday

    // c takes bread from a, on the record
    c.location = a.location = "market"; c.coins = 20; a.inventory.push("bread", "bread"); c.asleep = false; a.asleep = false;
    expect(town.apply(c, { kind: "take", item: "bread", from: a.id }, "test")).toBe(true);

    // a brings the accusation before the council, between nine and two
    a.location = "council";
    while (town.hour < 9 || town.hour >= 14) await town.tick();
    a.location = "council"; a.asleep = false;
    expect(town.apply(a, { kind: "accuse", who: c.persona.name, of: "taking my bread" }, "test")).toBe(true);
    expect(c.notoriety).toBeCloseTo(0.1, 5); // a mere accusation, unproven, still nudges it

    // the hearing is heard the same day, at three
    while (!(town.hour === 15 && town.minuteOfDay % 60 === 0)) await town.tick();
    expect(c.convictions).toBe(1);
    expect(town.events.some((e) => e.kind === "town.gathering" && (e.payload as { verdict?: string }).verdict === "fine")).toBe(true);
    expect(c.notoriety).toBeCloseTo(0.4, 5); // 0.1 from the charge, 0.3 more for the guilty verdict
  });

  it("crossing the notable threshold is noted in the record, and notoriety fades over quiet days", async () => {
    const town = new Town({ seed: 33, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Accuser") });
    const d = town.addAgent({ persona: persona("Already Talked About") });
    while (town.weekday === 0) await town.tick(); // the council does not sit on Sunday
    d.notoriety = 0.45; // already most of the way there, from earlier trouble

    a.location = "council";
    while (town.hour < 9 || town.hour >= 14) await town.tick();
    a.location = "council"; a.asleep = false;
    expect(town.apply(a, { kind: "accuse", who: d.persona.name, of: "something" }, "test")).toBe(true);
    expect(d.notoriety).toBeCloseTo(0.55, 5); // crossed 0.5
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === d.id)).toBe(true);

    // with no further offence, notoriety fades a little each quiet day
    const peak = d.notoriety;
    for (let day = 0; day < 8; day++) for (let t = 0; t < MINUTES_PER_DAY; t++) await town.tick();
    expect(d.notoriety).toBeLessThan(peak);
    expect(d.notoriety).toBeGreaterThanOrEqual(0);
  });

  it("notoriety survives a snapshot/restore round trip", () => {
    const town = new Town({ seed: 32, brain: none });
    const a = town.addAgent({ persona: persona("Marked") });
    a.notoriety = 0.42;
    const snap = town.snapshot();
    const town2 = new Town({ seed: 32, brain: none });
    town2.restore(snap);
    expect(town2.agents.get(a.id)!.notoriety).toBeCloseTo(0.42, 5);
  });
});
