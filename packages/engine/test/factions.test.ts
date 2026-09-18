import { describe, it, expect } from "vitest";
import { Town, Rng } from "../src/index.ts";
import type { Brain } from "../src/index.ts";

/** A brain that never thinks. Habit, and whatever the test itself drives with direct state, is the whole story —
 * exactly the discipline `culture.test.ts` and `institutions.test.ts` already use for deterministic engine tests. */
const none: Brain = {
  name: "none",
  async decide() { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); },
  async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

function persona(name: string, rng: Rng) {
  return { name, age: 30, origin: "the mainland", summary: "A person.", want: "A fair wage.", fear: "Debt.", secret: "None.", strangers: "Polite.", advice: "Considers it.", traits: { warmth: rng.next(), pride: rng.next(), caution: rng.next(), honesty: rng.next(), ambition: rng.next() } };
}

/** Deep, mutual trust — the kind `institutions.test.ts` hands the council election directly, since a "none" brain
 * never converses and so never builds a relationship on its own. */
function bond(a: ReturnType<Town["addAgent"]>, b: ReturnType<Town["addAgent"]>, trust: number): void {
  a.relationships.set(b.id, { trust, affection: 0.5, lastSeen: 0, opinion: "", lastPlace: null });
  b.relationships.set(a.id, { trust, affection: 0.5, lastSeen: 0, opinion: "", lastPlace: null });
}

async function runOneDay(town: Town): Promise<void> {
  const startDay = town.day;
  while (town.day === startDay) await town.tick();
}

describe("factions: bodies that emerge from shared circumstance", () => {
  it("a union forms among agents who share a job, and not among unrelated agents", async () => {
    const town = new Town({ seed: 41, brain: none, minutesPerTick: 60 });
    const rng = new Rng(41);
    const cook1 = town.addAgent({ persona: persona("Ada", rng) });
    const cook2 = town.addAgent({ persona: persona("Bea", rng) });
    const lone = town.addAgent({ persona: persona("Cleo", rng) }); // the only one at her job: no union of one
    const idle = town.addAgent({ persona: persona("Del", rng) }); // holds no job at all

    const cookJob = town.jobs.get("bakery.cook")!;
    cookJob.holders.push(cook1.id, cook2.id); cook1.job = cookJob.id; cook2.job = cookJob.id;
    const innJob = town.jobs.get("inn.help")!;
    innJob.holders.push(lone.id); lone.job = innJob.id;

    await runOneDay(town); // nightly fires at the rollover; factions are recomputed there

    const union = town.factions.find((f) => f.kind === "union" && f.basis === "bakery.cook");
    expect(union).toBeTruthy();
    expect(new Set(union!.members)).toEqual(new Set([cook1.id, cook2.id]));
    expect(union!.founded).toBeGreaterThan(0);

    // shared circumstance, not proximity or headcount: a single job-holder does not unionize, and nobody unrelated is swept in
    expect(town.factions.some((f) => f.basis === "inn.help")).toBe(false);
    expect(town.factions.some((f) => f.members.includes(lone.id))).toBe(false);
    expect(town.factions.some((f) => f.members.includes(idle.id))).toBe(false);

    // it was reported, in the town's own voice
    expect(town.events.some((e) => e.kind === "town.notice" && (e.payload as { faction?: string } | undefined)?.faction === union!.id && (e.payload as { formed?: boolean } | undefined)?.formed)).toBe(true);
  });

  it("a union's strike withholds a day's wage and fires a visible event; the owner may concede or hold firm, never forced", async () => {
    const town = new Town({ seed: 43, brain: none, minutesPerTick: 60 });
    const rng = new Rng(43);
    const ada = town.addAgent({ persona: persona("Ada", rng) });
    const bea = town.addAgent({ persona: persona("Bea", rng) });
    bond(ada, bea, 0.9); // real cohesion: trust the town actually holds, not a die roll

    const job = town.jobs.get("bakery.cook")!;
    job.holders.push(ada.id, bea.id); ada.job = job.id; bea.job = job.id;
    const bakery = town.places.get("bakery")!;
    bakery.treasury = 100; // enough that a concession is at least on the table

    // real hardship, not asserted: nobody who cannot buy a meal and has none in hand goes hungry by choice
    // (both are left without coin so neither can eat their way out mid-test and confound the wage check below)
    ada.coins = 0; ada.inventory = []; bea.coins = 0; bea.inventory = [];
    const wageBefore = job.wage;

    await runOneDay(town); // the first nightly finds the union already at 0.9 cohesion and a member gone hungry: the strike is same-night

    const union = town.factions.find((f) => f.kind === "union" && f.basis === "bakery.cook");
    expect(union).toBeTruthy();
    expect(union!.cohesion).toBeGreaterThanOrEqual(0.55);
    expect(bakery.strikeUntil).toBeGreaterThan(town.day);

    const strikeEvent = town.events.find((e) => e.kind === "town.notice" && (e.payload as { action?: string } | undefined)?.action === "strike" && (e.payload as { faction?: string } | undefined)?.faction === union!.id);
    expect(strikeEvent).toBeTruthy();
    expect(strikeEvent!.actors).toEqual(expect.arrayContaining([ada.id, bea.id]));
    expect(typeof (strikeEvent!.payload as { conceded?: boolean }).conceded).toBe("boolean"); // an owner's choice, recorded either way — never a forced outcome

    // a shift attempted while the strike stands is paid nothing, and costs nobody the job
    const coinsBefore = bea.coins, treasuryBefore = bakery.treasury;
    while (town.hour < 11) await town.tick();
    ada.workedToday = true; bea.workedToday = true;
    await town.tick(); // crosses into the shift's end hour
    expect(bea.coins).toBe(coinsBefore);
    expect(bakery.treasury).toBe(treasuryBefore);
    expect(job.holders).toEqual(expect.arrayContaining([ada.id, bea.id]));
    expect([wageBefore, wageBefore + 1]).toContain(job.wage);

    // it survives a snapshot and comes back exactly what it was
    const snap = town.snapshot();
    const restored = new Town({ seed: 99, brain: none });
    restored.restore(snap);
    const restoredUnion = restored.factions.find((f) => f.id === union!.id);
    expect(restoredUnion).toEqual(union);
    expect(restored.places.get("bakery")!.strikeUntil).toBe(bakery.strikeUntil);
  });

  it("is sane with no members: an empty faction is not restored, and one that loses every member is dropped, not left a zombie", () => {
    const town = new Town({ seed: 5, brain: none });
    const a = town.addAgent({ persona: persona("A", new Rng(5)) });
    const b = town.addAgent({ persona: persona("B", new Rng(5)) });
    const job = town.jobs.get("bakery.cook")!;
    job.holders.push(a.id, b.id); a.job = job.id; b.job = job.id;
    town.factions.push({ id: "union:bakery.cook", kind: "union", name: "Bakery Workers' Union", basis: "bakery.cook", members: [a.id, b.id], founded: town.day, cohesion: 0.6, lastActionDay: null });
    // a stray faction with nobody in it, as an old or hand-built record might carry
    town.factions.push({ id: "party:ghost", kind: "party", name: "Nobody's Party", basis: "ghost", members: [], founded: town.day, cohesion: 0, lastActionDay: null });

    const snap = town.snapshot();
    const restored = new Town({ seed: 99, brain: none });
    restored.restore(snap);
    expect(restored.factions.find((f) => f.id === "party:ghost")).toBeUndefined();
    const restoredUnion = restored.factions.find((f) => f.id === "union:bakery.cook");
    expect(restoredUnion?.members.slice().sort()).toEqual([a.id, b.id].sort());

    // the whole membership leaves: the faction goes with them
    restored.removeAgent(a.id, "left");
    restored.removeAgent(b.id, "left");
    expect(restored.factions).toEqual([]);
  });

  it("is sane on an empty island: no factions form, and nothing throws through a nightly cycle", async () => {
    const town = new Town({ seed: 6, brain: none, minutesPerTick: 60 });
    expect(town.factions).toEqual([]);
    await runOneDay(town);
    expect(town.factions).toEqual([]);
  });
});
