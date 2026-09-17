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
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "a full purse", fear: "ruin", secret: "none", strangers: "wary", advice: "counts twice", traits: { warmth: 0.4, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.5 } });

/** A day-end pass, with none of the thinking the "none" brain can't do: exactly what fishery.test.ts and others do to drive the engine's own clock forward without a real tick loop. */
function nightlyOf(town: Town) { return (town as unknown as { nightly(): Promise<void> }).nightly(); }

describe("the bank — deposits, interest, loans", () => {
  it("finds a place to do its business, even on a pack with no counting house of its own", () => {
    const town = new Town({ seed: 1, brain: none });
    const bank = town.bankPlace();
    // the default island pack has no bank or exchange, so the market's till stands in for it
    expect(bank.id).toBe("market");
    expect(town.places.get(bank.id)).toBe(bank);
  });

  it("a deposit leaves the purse and draws a modest interest, night after night", async () => {
    const town = new Town({ seed: 2, brain: none });
    const a = town.addAgent({ persona: persona("Saver") });
    a.coins = 100;
    expect(town.depositToBank(a, 60)).toBe(true);
    expect(a.coins).toBe(40);
    expect(a.savings).toBe(60);
    // too much, or nothing, or a fraction: all refused
    expect(town.depositToBank(a, 1000)).toBe(false);
    expect(town.depositToBank(a, 0)).toBe(false);
    expect(town.depositToBank(a, -5)).toBe(false);
    for (let i = 0; i < 10; i++) await nightlyOf(town);
    expect(a.savings).toBeGreaterThan(60);
    // modest: ten nights of a hundredth a night does not double a balance
    expect(a.savings).toBeLessThan(90);
    expect(a.coins).toBe(40); // interest is credited to savings, not spent from anywhere
  });

  it("a withdrawal returns exactly what was asked, and no more than what is there", () => {
    const town = new Town({ seed: 3, brain: none });
    const a = town.addAgent({ persona: persona("Thrifty") });
    a.coins = 50;
    town.depositToBank(a, 50);
    expect(town.withdrawFromBank(a, 20)).toBe(true);
    expect(a.savings).toBe(30); expect(a.coins).toBe(20);
    expect(town.withdrawFromBank(a, 31)).toBe(false);
    expect(town.withdrawFromBank(a, 30)).toBe(true);
    expect(a.savings).toBe(0); expect(a.coins).toBe(50);
  });

  it("lends up to a cap tied to standing, and refuses past it", () => {
    const town = new Town({ seed: 4, brain: none });
    const bare = town.addAgent({ persona: persona("Bare Name") });
    bare.coins = 0;
    const cap = town.loanCap(bare);
    expect(cap).toBeGreaterThan(0);
    expect(town.borrowFromBank(bare, cap + 1)).toBe(false);
    expect(bare.debt).toBe(0);
    expect(town.borrowFromBank(bare, cap)).toBe(true);
    expect(bare.coins).toBe(cap);
    expect(bare.debt).toBe(cap);
    // what's left to lend has shrunk now that it must be paid back; more than that is still refused
    const capAfter = town.loanCap(bare);
    expect(capAfter).toBeLessThan(cap);
    expect(town.borrowFromBank(bare, capAfter + 1)).toBe(false);

    // savings raise the cap: a saver can borrow more on the strength of what they have put by
    const saver = town.addAgent({ persona: persona("Has Savings") });
    saver.coins = 200; town.depositToBank(saver, 200);
    expect(town.loanCap(saver)).toBeGreaterThan(town.loanCap(bare));
  });

  it("a loan is repaid down to nothing, and a big one is on the town's record", () => {
    const town = new Town({ seed: 5, brain: none });
    const a = town.addAgent({ persona: persona("Borrower") });
    a.coins = 500; // ample standing coin-in-hand, so the loan is well inside the cap
    expect(town.borrowFromBank(a, 40)).toBe(true);
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === a.id && /loan/.test(e.text))).toBe(true);
    const before = a.coins;
    const paid = town.repayLoan(a, 40);
    expect(paid).toBe(40);
    expect(a.debt).toBe(0);
    expect(a.coins).toBe(before - 40);
    // nothing left to repay
    expect(town.repayLoan(a, 10)).toBe(0);
  });

  it("what is not repaid grows like any debt and caps at twice what was borrowed, never past it, and never invents a new punishment", async () => {
    const town = new Town({ seed: 6, brain: none });
    const a = town.addAgent({ persona: persona("In Over Their Head") });
    a.coins = 1000; // ample standing, so borrowing is well inside the cap
    town.borrowFromBank(a, 100);
    expect(a.debt).toBe(100);
    const notorietyBefore = a.notoriety;
    let peakNotoriety = notorietyBefore;
    for (let i = 0; i < 60; i++) { await nightlyOf(town); peakNotoriety = Math.max(peakNotoriety, a.notoriety); }
    // capped at twice the principal, and it stops there rather than growing forever
    expect(a.debt).toBe(200);
    // no coin is seized — the bank does not invent a punishment the world doesn't already have
    expect(a.coins).toBe(1100);
    // the consequence it does feed is reputational, the same ledger an accusation would move, and it fades the same quiet way notoriety always does
    expect(peakNotoriety).toBeGreaterThan(notorietyBefore);
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === a.id && /twice what was borrowed/.test(e.text))).toBe(true);
  });

  it("the Bill Gates case: an enormous deposit is handled without overflow, misbehaviour, or breaking the books", async () => {
    const town = new Town({ seed: 7, brain: none });
    const rich = town.addAgent({ persona: persona("Improbably Rich") });
    rich.coins = 5_000_000;
    expect(town.depositToBank(rich, 4_500_000)).toBe(true);
    expect(rich.coins).toBe(500_000);
    expect(rich.savings).toBe(4_500_000);
    await nightlyOf(town);
    expect(Number.isFinite(rich.savings)).toBe(true);
    expect(rich.savings).toBeGreaterThan(4_500_000); // interest, proportionate to the balance
    expect(rich.savings).toBeLessThan(4_500_000 * 1.02); // still modest as a rate, even on a fortune
    // such standing can carry a large loan without the cap breaking down
    const cap = town.loanCap(rich);
    expect(cap).toBeGreaterThan(1_000_000);
    expect(Number.isFinite(cap)).toBe(true);
    // and it all comes back out cleanly
    expect(town.withdrawFromBank(rich, rich.savings)).toBe(true);
    expect(rich.savings).toBe(0);
    expect(rich.coins).toBeGreaterThan(5_000_000); // the original pile, plus what interest it drew before being pulled back out
  });

  it("survives a snapshot and restore intact: savings, debt, and the principal it was measured against", () => {
    const town = new Town({ seed: 8, brain: none });
    const a = town.addAgent({ persona: persona("Persisted") });
    a.coins = 300;
    town.depositToBank(a, 100);
    town.borrowFromBank(a, 20);
    const savingsBefore = a.savings, debtBefore = a.debt, coinsBefore = a.coins;
    const town2 = new Town({ seed: 8, brain: none });
    town2.restore(town.snapshot());
    const b = town2.agents.get(a.id)!;
    expect(b.savings).toBe(savingsBefore);
    expect(b.debt).toBe(debtBefore);
    expect(b.coins).toBe(coinsBefore);
    // and the restored town still grows interest and debt exactly as the live one would
    expect(town2.loanCap(b)).toBe(town.loanCap(a));
  });
});
