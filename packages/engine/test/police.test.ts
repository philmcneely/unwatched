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
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "A room.", fear: "Debt.", secret: "None.", strangers: "Polite.", advice: "Considers it.", traits: { warmth: 0.4, pride: 0.4, caution: 0.4, honesty: 0.6, ambition: 0.3 } });

/** Get everyone past Sunday, when the council does not sit, and wake the given agents. */
async function pastSundayAwake(town: Town, ...agents: AgentState[]): Promise<void> {
  while (town.weekday === 0) await town.tick();
  for (const a of agents) a.asleep = false;
}

describe("police, and the delay a boat crossing buys a fugitive", () => {
  it("a fresh citizen is not a fugitive", () => {
    const town = new Town({ seed: 60, brain: none });
    const fresh = town.addAgent({ persona: persona("Fresh Face") });
    expect(fresh.fugitive ?? false).toBe(false);
    expect(town.police).toBe(0);
    expect(town.isCapital).toBe(false);
  });

  it("on a federated island with no resident police, the council's hearing waits for the boat to cross — giving the accused a window to flee and become a fugitive, notoriety intact", async () => {
    const town = new Town({ seed: 61, brain: none, minutesPerTick: 1, harbors: [{ id: "capital", name: "Aurelia" }] }); // federated, but not the capital: no police of its own
    expect(town.police).toBe(0);
    const a = town.addAgent({ persona: persona("Accuser") });
    const c = town.addAgent({ persona: persona("Culprit") });
    await pastSundayAwake(town, a, c);

    // c takes bread from a, on the record, same as any other theft
    c.location = a.location = "market"; c.coins = 20; a.inventory.push("bread", "bread");
    expect(town.apply(c, { kind: "take", item: "bread", from: a.id }, "test")).toBe(true);

    // a accuses c well before three in the afternoon — on a capital or a lone island this would be heard the same day
    a.location = "council";
    while (town.hour < 9 || town.hour >= 12) await town.tick();
    a.location = "council"; a.asleep = false;
    const dayOfCharge = town.day;
    expect(town.apply(a, { kind: "accuse", who: c.persona.name, of: "taking my bread" }, "test")).toBe(true);
    expect(c.notoriety).toBeCloseTo(0.1, 5); // the charge alone nudges it, same as anywhere

    // the hearing is NOT today: word has to cross the water to whoever has police, so it waits for tomorrow
    const hearing = town.gatherings.find((g) => g.kind === "hearing" && !g.held)!;
    expect(hearing).toBeTruthy();
    expect(hearing.day).toBe(dayOfCharge + 1);

    // in the delay this buys, c walks to the harbor and boards the boat before the council ever hears the charge
    c.location = "harbor"; c.asleep = false;
    while (town.hour < 6 || town.hour > 20 || town.weather === "storm") await town.tick();
    c.location = "harbor"; c.asleep = false;
    expect(town.apply(c, { kind: "leave", why: "nothing left for me here" }, "test")).toBe(true);
    await town.tick();

    expect(town.agents.has(c.id)).toBe(false); // gone from the island
    expect(c.fugitive).toBe(true); // but marked, on the same record they carry with them
    expect(c.notoriety).toBeCloseTo(0.1, 5); // notoriety survives the flight untouched
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === c.id && (e.payload as { fugitive?: boolean } | undefined)?.fugitive === true)).toBe(true);

    // the hearing itself, held the next day against an empty chair, records that the accused is gone
    while (!(town.day === dayOfCharge + 1 && town.hour === 15 && town.minuteOfDay % 60 === 0)) await town.tick();
    expect(town.events.some((e) => e.kind === "town.gathering" && e.kind === "town.gathering" && /accused is gone/.test(e.text))).toBe(true);
  });

  it("on the capital, the council has its own police and enforces at once: no crossing delay, no escape window", async () => {
    // identical federation, identical timing, except this island IS the capital
    const town = new Town({ seed: 61, brain: none, minutesPerTick: 1, harbors: [{ id: "outpost", name: "Kestrel" }], isCapital: true });
    expect(town.police).toBeGreaterThan(0);
    const a = town.addAgent({ persona: persona("Accuser") });
    const c = town.addAgent({ persona: persona("Culprit") });
    await pastSundayAwake(town, a, c);

    c.location = a.location = "market"; c.coins = 20; a.inventory.push("bread", "bread");
    expect(town.apply(c, { kind: "take", item: "bread", from: a.id }, "test")).toBe(true);

    a.location = "council";
    while (town.hour < 9 || town.hour >= 12) await town.tick();
    a.location = "council"; a.asleep = false;
    const dayOfCharge = town.day;
    expect(town.apply(a, { kind: "accuse", who: c.persona.name, of: "taking my bread" }, "test")).toBe(true);

    // heard THE SAME DAY: the capital's police do not need a boat to reach their own council
    const hearing = town.gatherings.find((g) => g.kind === "hearing" && !g.held)!;
    expect(hearing.day).toBe(dayOfCharge);

    while (!(town.hour === 15 && town.minuteOfDay % 60 === 0)) await town.tick();
    expect(c.convictions).toBe(1); // held, and settled, the same day it was brought
    expect(c.fugitive ?? false).toBe(false);
  });

  it("fugitive status survives a snapshot/restore round trip, alongside the notoriety that travels with it", () => {
    const town = new Town({ seed: 62, brain: none });
    const a = town.addAgent({ persona: persona("On the Run") });
    a.fugitive = true; a.notoriety = 0.37;
    const snap = town.snapshot();
    const town2 = new Town({ seed: 62, brain: none });
    town2.restore(snap);
    const restored = town2.agents.get(a.id)!;
    expect(restored.fugitive).toBe(true);
    expect(restored.notoriety).toBeCloseTo(0.37, 5);
  });

  it("a fugitive who reaches the capital is caught on the pier; the same fugitive reaching an ordinary island stays free, but is met with wariness", async () => {
    let capital!: Town, plain!: Town;
    const origin = new Town({
      seed: 63, brain: none, minutesPerTick: 1, name: "Outpost", idPrefix: "origin",
      harbors: [{ id: "capital", name: "Aurelia" }, { id: "plain", name: "Backwater" }],
      onDepart: async (p, to) => { if (to === "capital") { capital.arrive(p); return true; } if (to === "plain") { plain.arrive(p); return true; } return false; },
    });
    capital = new Town({ seed: 64, brain: none, minutesPerTick: 1, name: "Aurelia", idPrefix: "capital", isCapital: true, harbors: [{ id: "origin", name: "Outpost" }], onDepart: async () => false });
    plain = new Town({ seed: 65, brain: none, minutesPerTick: 1, name: "Backwater", idPrefix: "plain", harbors: [{ id: "origin", name: "Outpost" }], onDepart: async () => false });
    const resident = plain.addAgent({ persona: persona("Local") }); resident.location = "harbor";

    const a = origin.addAgent({ persona: persona("Accuser") });
    const c = origin.addAgent({ persona: persona("Fugitive-to-be") });
    await pastSundayAwake(origin, a, c);
    c.location = a.location = "market"; c.coins = 20; a.inventory.push("bread", "bread");
    expect(origin.apply(c, { kind: "take", item: "bread", from: a.id }, "test")).toBe(true);
    a.location = "council";
    while (origin.hour < 9 || origin.hour >= 12) await origin.tick();
    a.location = "council"; a.asleep = false;
    expect(origin.apply(a, { kind: "accuse", who: c.persona.name, of: "taking my bread" }, "test")).toBe(true);
    const notorietyAtFlight = c.notoriety;

    // c flees to the capital, and is caught the moment the boat docks
    c.location = "harbor"; c.asleep = false;
    while (origin.hour < 6 || origin.hour > 20 || origin.weather === "storm") await origin.tick();
    c.location = "harbor"; c.asleep = false;
    expect(origin.apply(c, { kind: "leave", to: "Aurelia", why: "away from here" }, "test")).toBe(true);
    await origin.tick();
    const caught = [...capital.agents.values()].find((x) => x.persona.name === c.persona.name)!;
    expect(caught).toBeTruthy();
    expect(caught.fugitive).toBe(false); // caught, not still running
    expect(caught.convictions).toBe(1);
    expect(capital.events.some((e) => e.kind === "town.notice" && e.actors[0] === caught.id && (e.payload as { caught?: boolean } | undefined)?.caught === true)).toBe(true);

    // a second fugitive, this time bound for an ordinary island with no police of its own
    const d = origin.addAgent({ persona: persona("Second Fugitive") });
    d.asleep = false; d.notoriety = notorietyAtFlight; d.fugitive = false;
    const g = origin.gather("hearing", "council", origin.day, 15, [a.id, d.id], "something else");
    void g;
    d.location = "harbor";
    while (origin.hour < 6 || origin.hour > 20 || origin.weather === "storm") await origin.tick();
    d.location = "harbor"; d.asleep = false;
    expect(origin.apply(d, { kind: "leave", to: "Backwater", why: "somewhere quieter" }, "test")).toBe(true);
    await origin.tick();
    const arrived = [...plain.agents.values()].find((x) => x.persona.name === d.persona.name)!;
    expect(arrived).toBeTruthy();
    expect(arrived.fugitive).toBe(true); // not caught: this island has no police of its own either
    expect(arrived.notoriety).toBeCloseTo(notorietyAtFlight, 5);
    // the resident on the pier grows a little wary of a name already known for trouble
    const rel = resident.relationships.get(arrived.id);
    expect(rel).toBeTruthy();
    expect(rel!.trust).toBeLessThan(0.3);
  });
});
