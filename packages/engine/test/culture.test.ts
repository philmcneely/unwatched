import { describe, it, expect } from "vitest";
import { Town, Rng } from "../src/index.ts";
import type { Brain, AgentState } from "../src/index.ts";

/** A brain that never thinks. Habit, and whatever the test itself drives with `apply`, is the whole story. */
const none: Brain = {
  name: "none",
  async decide() { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); },
  async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

function persona(name: string, rng: Rng) {
  return { name, age: 30, origin: "the mainland", summary: "A person.", want: "A room.", fear: "Debt.", secret: "None.", strangers: "Polite.", advice: "Considers it.", traits: { warmth: rng.next(), pride: rng.next(), caution: rng.next(), honesty: rng.next(), ambition: rng.next() } };
}

/** Runs one calendar day of a town, calling `tick(t)` before every tick so a test can drive that day's history. */
async function day(town: Town, onTick: () => void): Promise<void> {
  const startDay = town.day;
  while (town.day === startDay) { onTick(); await town.tick(); }
}

describe("culture drift", () => {
  it("a fresh town has sane, neutral defaults", () => {
    const town = new Town({ seed: 1, brain: none });
    expect(town.culture.lean).toBeNull();
    expect(town.culture.signature).toBeNull();
    expect(town.culture.notable).toBeNull();
    expect(town.culture.updatedDay).toBe(0);
    for (const v of Object.values(town.culture.values)) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
    expect(town.cultureRecord.descriptor).toBe("an island still finding what it is");
    expect(town.cultureRecord.sayings).toEqual([]);
  });

  it("two islands with different histories drift toward different, stable-ish cultures — and it survives a snapshot", async () => {
    const DAYS = 30;
    // island A: everyone has a trade and works it, every day the record shows it
    const townA = new Town({ seed: 21, brain: none, minutesPerTick: 15 });
    // island B: work is never on offer; what the record shows instead is trading, day after day
    const townB = new Town({ seed: 22, brain: none, minutesPerTick: 15 });
    const rngA = new Rng(21), rngB = new Rng(22);

    const peopleA: AgentState[] = []; for (let i = 0; i < 6; i++) peopleA.push(townA.addAgent({ persona: persona(`A${i}`, rngA) }));
    const peopleB: AgentState[] = []; for (let i = 0; i < 6; i++) peopleB.push(townB.addAgent({ persona: persona(`B${i}`, rngB) }));

    const jobIds = ["bakery.cook", "inn.help", "fields.hand", "mill.hand", "harbor.dock", "fishhouse.gutter"];
    for (let i = 0; i < peopleA.length; i++) { const job = townA.jobs.get(jobIds[i]!)!; peopleA[i]!.job = job.id; job.holders.push(peopleA[i]!.id); }
    for (const job of townB.jobs.values()) job.slots = 0; // nobody on island B is ever hired
    for (const a of peopleB) a.coins = 500;

    // island B's real commerce: neighbors trading with each other, not the town's own shops. Three pairs, twice a day.
    const pairs: [AgentState, AgentState][] = [[peopleB[0]!, peopleB[1]!], [peopleB[2]!, peopleB[3]!], [peopleB[4]!, peopleB[5]!]];
    let tradedOnDay = -1;
    for (let d = 0; d < DAYS; d++) {
      await day(townA, () => { for (const a of peopleA) if (a.needs.hunger > 0.8) a.needs.hunger = 0.3; });
      await day(townB, () => {
        for (const a of peopleB) if (a.needs.hunger > 0.8) a.needs.hunger = 0.3;
        if (townB.hour === 10 && tradedOnDay !== townB.day) {
          tradedOnDay = townB.day;
          for (const [seller, buyer] of pairs) {
            seller.location = "market"; buyer.location = "market"; seller.asleep = false; buyer.asleep = false;
            for (let round = 0; round < 2; round++) { seller.inventory.push("bread"); townB.apply(seller, { kind: "trade", with: buyer.id, sell: "bread" }, "test"); }
          }
        }
      });
    }

    // divergence: each island leans toward what its own days actually held, not the other's
    expect(townA.culture.lean).toBe("industrious");
    expect(townB.culture.lean).toBe("mercantile");
    expect(townA.culture.values.industrious).toBeGreaterThan(0.6);
    expect(townB.culture.values.mercantile).toBeGreaterThan(0.6);
    expect(townA.culture.values.industrious).toBeGreaterThan(townB.culture.values.industrious);
    expect(townB.culture.values.mercantile).toBeGreaterThan(townA.culture.values.mercantile);
    expect(townA.cultureRecord.descriptor).not.toBe(townB.cultureRecord.descriptor);
    expect(townA.cultureRecord.descriptor).toContain("industrious");
    expect(townB.cultureRecord.descriptor).toContain("mercantile");

    // stable-ish: once the record clearly supports a lean, it does not flap back and forth
    const leanFlips = (t: Town) => t.events.filter((e) => e.kind === "town.notice" && (e.payload as { lean?: string | null } | undefined)?.lean !== undefined).length;
    expect(leanFlips(townA)).toBeLessThanOrEqual(2);
    expect(leanFlips(townB)).toBeLessThanOrEqual(2);

    // it persists through a snapshot/restore, unrolled and untouched
    const snap = townA.snapshot();
    const restored = new Town({ seed: 99, brain: none });
    restored.restore(snap);
    expect(restored.culture).toEqual(townA.culture);
    expect(restored.cultureRecord.lean).toBe("industrious");
  });

  it("an older snapshot with no culture on it restores to sane defaults, not a crash", () => {
    const town = new Town({ seed: 3, brain: none });
    town.addAgent({ persona: persona("Nobody", new Rng(3)) });
    const snap = town.snapshot();
    const { culture: _drop, ...civicWithoutCulture } = snap.civic!;
    const bare = { ...snap, civic: civicWithoutCulture };

    const restored = new Town({ seed: 3, brain: none });
    restored.restore(bare);
    expect(restored.culture.lean).toBeNull();
    expect(restored.culture.notable).toBeNull();
    for (const v of Object.values(restored.culture.values)) expect(v).toBeCloseTo(0.3);
  });
});
