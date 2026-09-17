import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal } from "@unwatched/protocol";

/** Habit alone: proves the wealth-shock layer is engine physics, not something a mind has to be told to do. */
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "a quiet living", fear: "ruin", secret: "none", strangers: "wary", advice: "counts twice", traits: { warmth: 0.4, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.5 } });

/** A day-end pass, driven directly, exactly the way bank.test.ts and education.test.ts drive the engine's own clock without a real tick loop. */
function nightlyOf(town: Town) { return (town as unknown as { nightly(): Promise<void> }).nightly(); }
function coinsOnIsland(town: Town): number {
  let s = 0; for (const a of town.agents.values()) s += a.coins; for (const p of town.places.values()) s += p.treasury; return s;
}

describe("a magnate dropped onto the island", () => {
  it("arrives with a fortune, and the books still balance to the coin, over days of it going to work", async () => {
    const town = new Town({ seed: 101, brain: none, minutesPerTick: 1 });
    for (let i = 0; i < 6; i++) town.addAgent({ persona: persona(`Local ${i}`) });
    const magnate = town.addAgent({ persona: persona("Bill"), coins: 5000, magnate: true });
    expect(magnate.coins).toBe(5000);
    expect(magnate.magnate).toBe(true);
    const start = coinsOnIsland(town) - town.minted; // minted already counts every arrival's purse, the magnate's included
    for (let d = 0; d < 8; d++) await nightlyOf(town);
    // every coin is still accounted for: what is on the island equals what arrived plus what the mainland paid, minus what left
    expect(coinsOnIsland(town)).toBe(start + town.minted - town.burned);
    for (const a of town.agents.values()) expect(a.coins).toBeGreaterThanOrEqual(0);
    for (const p of town.places.values()) expect(p.treasury).toBeGreaterThanOrEqual(0);
    // the fortune did not just sit there: some of it left the magnate's purse and went to work
    expect(magnate.coins).toBeLessThan(5000);
  });

  it("puts surplus capital to work at the bank, raising what an ordinary citizen already on the island can borrow — a control island with no magnate stays exactly as it was", async () => {
    const control = new Town({ seed: 102, brain: none });
    const shocked = new Town({ seed: 102, brain: none });
    const bareControl = control.addAgent({ persona: persona("Bare Name") });
    const bareShocked = shocked.addAgent({ persona: persona("Bare Name") });
    bareControl.coins = 0; bareShocked.coins = 0;
    const capBefore = control.loanCap(bareControl);
    expect(shocked.loanCap(bareShocked)).toBe(capBefore); // identical islands so far — the magnate is the only difference about to be introduced

    shocked.addAgent({ persona: persona("Bill"), coins: 5000, magnate: true });
    await nightlyOf(shocked); // one day-end pass: the magnate already puts a first slice of capital to work
    await nightlyOf(control); // the control island gets a day-end pass too, with nothing new to react to

    expect(control.loanCap(bareControl)).toBe(capBefore); // no magnate, no change
    expect(shocked.loanCap(bareShocked)).toBeGreaterThan(capBefore); // the bank can now carry more on this citizen's name alone

    // concretely: a loan refused on the control island is one the shocked island's bank can now make good, for the very same citizen
    const ask = capBefore + 50;
    expect(control.borrowFromBank(bareControl, ask)).toBe(false);
    expect(shocked.borrowFromBank(bareShocked, ask)).toBe(true);
    expect(shocked.events.some((e) => e.kind === "town.notice" && /capital the bank can now lend/.test(e.text))).toBe(true);
  });

  it("deploys capital gradually across nights, and the headroom it grants everyone tops out rather than growing forever", async () => {
    const town = new Town({ seed: 105, brain: none });
    const fresh = town.addAgent({ persona: persona("Fresh") }); // never borrows and never qualifies for anything else — a clean read on the pool alone
    fresh.coins = 0;
    town.addAgent({ persona: persona("Bill"), coins: 5000, magnate: true });
    const capBefore = town.loanCap(fresh);

    await nightlyOf(town);
    const capNight1 = town.loanCap(fresh);
    expect(capNight1).toBeGreaterThan(capBefore); // one night in, already more room to borrow

    for (let d = 0; d < 10; d++) await nightlyOf(town);
    const capLater = town.loanCap(fresh);
    expect(capLater).toBeGreaterThan(capNight1); // more nights, more of the fortune banked, more headroom for everyone

    for (let d = 0; d < 60; d++) await nightlyOf(town); // well past the point the pool should have capped
    const capCeiling = town.loanCap(fresh);
    await nightlyOf(town);
    expect(town.loanCap(fresh)).toBe(capCeiling); // it tops out: one fortune does not remake the bank forever
  });

  it("bankrolls a shop outright and pays its help better than the going rate — a ripple a plain island of the same size never shows", async () => {
    const plain = new Town({ seed: 103, brain: none });
    plain.addAgent({ persona: persona("Passerby") });
    const shocked = new Town({ seed: 103, brain: none });
    shocked.addAgent({ persona: persona("Passerby") });
    const magnate = shocked.addAgent({ persona: persona("Bill"), coins: 5000, magnate: true });

    await nightlyOf(plain);
    await nightlyOf(shocked);

    const plainFoundedShop = [...plain.places.values()].find((p) => p.kind === "shop" && p.owner);
    expect(plainFoundedShop).toBeUndefined(); // nobody on the plain island is educated or capitalized enough to found one (the pack's own unowned chandlery aside)

    const shop = [...shocked.places.values()].find((p) => p.kind === "shop" && p.owner === magnate.id);
    expect(shop).toBeTruthy();
    const job = [...shocked.jobs.values()].find((j) => j.place === shop!.id);
    expect(job).toBeTruthy();
    expect(job!.wage).toBeGreaterThan(2); // pays better than an ordinary founder's shop would post
    expect(shocked.events.some((e) => e.kind === "town.built" && e.actors[0] === magnate.id && (e.payload as { magnate?: boolean } | undefined)?.magnate)).toBe(true);
  });

  it("survives a snapshot and restore intact, and leaves an ordinary citizen exactly as they were", () => {
    const town = new Town({ seed: 104, brain: none });
    const citizen = town.addAgent({ persona: persona("Ordinary") });
    citizen.coins = 0;
    const magnate = town.addAgent({ persona: persona("Bill"), coins: 5000, magnate: true });
    expect(citizen.magnate).toBeFalsy();
    expect(town.loanCap(citizen)).toBe(30); // untouched: no magnate has put anything to work yet, so the base cap is exactly what it always was

    const town2 = new Town({ seed: 104, brain: none });
    town2.restore(town.snapshot());
    expect(town2.agents.get(magnate.id)!.magnate).toBe(true);
    expect(town2.agents.get(magnate.id)!.coins).toBe(5000);
    expect(town2.agents.get(citizen.id)!.magnate).toBeFalsy();
  });
});
