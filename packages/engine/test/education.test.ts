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
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "to get on", fear: "staying poor", secret: "none", strangers: "wary", advice: "weighs it", traits: { warmth: 0.4, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.5 } });

/** Direct calls to the engine's own private hooks, exactly the way bank.test.ts drives `nightly()`: no tick loop, no habit noise, just the mechanism itself. */
function schoolHourOf(town: Town) { return (town as unknown as { schoolHour(): void }).schoolHour(); }
function tryEntrepreneurshipOf(town: Town) { return (town as unknown as { tryEntrepreneurship(): void }).tryEntrepreneurship(); }
function hourlyOf(town: Town) { return (town as unknown as { hourly(): void }).hourly(); }

describe("education, intelligence, and what they earn a citizen", () => {
  it("gives a fresh citizen sensible defaults: an innate spread of sharpness, and next to no schooling", () => {
    const town = new Town({ seed: 40, brain: none });
    const a = town.addAgent({ persona: persona("Fresh Face") });
    expect(a.intelligence).toBeGreaterThanOrEqual(0.2);
    expect(a.intelligence).toBeLessThanOrEqual(0.9);
    expect(a.education).toBeGreaterThan(0);
    expect(a.education).toBeLessThan(0.1);
  });

  it("rises with time spent at the school, faster for the sharper", () => {
    const town = new Town({ seed: 41, brain: none });
    const dull = town.addAgent({ persona: persona("Dull"), intelligence: 0.2, education: 0 });
    const sharp = town.addAgent({ persona: persona("Sharp"), intelligence: 0.9, education: 0 });
    const school = town.schoolPlace();
    dull.location = school.id; dull.asleep = false;
    sharp.location = school.id; sharp.asleep = false;
    for (let i = 0; i < 20; i++) schoolHourOf(town);
    expect(dull.education).toBeGreaterThan(0);
    expect(sharp.education).toBeGreaterThan(dull.education);
    expect(sharp.education).toBeLessThanOrEqual(1);
  });

  it("does not grow for someone asleep, or not at the school", () => {
    const town = new Town({ seed: 42, brain: none });
    const school = town.schoolPlace();
    const asleep = town.addAgent({ persona: persona("Asleep"), intelligence: 0.9, education: 0 });
    const elsewhere = town.addAgent({ persona: persona("Elsewhere"), intelligence: 0.9, education: 0 });
    asleep.location = school.id; asleep.asleep = true;
    elsewhere.location = "harbor"; elsewhere.asleep = false;
    expect(elsewhere.location).not.toBe(school.id);
    schoolHourOf(town);
    expect(asleep.education).toBe(0);
    expect(elsewhere.education).toBe(0);
  });

  it("marks a milestone, once, when a young citizen becomes properly schooled", () => {
    const town = new Town({ seed: 43, brain: none });
    const pupil = town.addAgent({ persona: { ...persona("Pupil"), age: 17 }, intelligence: 0.8, education: 0.48 });
    const school = town.schoolPlace();
    pupil.location = school.id; pupil.asleep = false;
    schoolHourOf(town);
    expect(pupil.education).toBeGreaterThanOrEqual(0.5);
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === pupil.id && /schooled/.test(e.text))).toBe(true);
    // it does not fire twice for the same crossing
    const before = town.events.length;
    schoolHourOf(town);
    expect(town.events.filter((e) => e.kind === "town.notice" && e.actors[0] === pupil.id && /schooled/.test(e.text)).length).toBe(1);
    expect(town.events.length).toBeGreaterThanOrEqual(before); // schooling keeps going, just no second milestone
  });

  it("pays a schooled, sharp worker a bonus above the posted wage, minted rather than drawn from anyone's purse", () => {
    const town = new Town({ seed: 44, brain: none });
    town.day = 2; // a weekday; nobody is paid on the island's Sunday
    const job = town.jobs.get("bakery.cook")!;
    const plain = town.addAgent({ persona: persona("Plain"), intelligence: 0.5, education: 0 });
    const scholar = town.addAgent({ persona: persona("Scholar"), intelligence: 0.9, education: 0.9 });
    for (const a of [plain, scholar]) { a.job = job.id; job.holders.push(a.id); a.workedToday = true; }
    town.t = (town.day - 1) * 1440 + job.hours[1] * 60; // exactly the hour a shift is paid
    const mintedBefore = town.minted;
    hourlyOf(town);
    expect(plain.coins).toBe(40 + job.wage); // unschooled, ordinary sharpness: the posted wage, nothing more
    expect(scholar.coins).toBeGreaterThan(plain.coins); // schooled and sharp: paid more for the same shift
    expect(town.minted).toBeGreaterThan(mintedBefore); // the extra came from the mainland's own ledger, not a till or an owner
  });

  it("lets an educated, sharp, capitalized citizen start a business of their own; not an uneducated or a broke one", () => {
    const town = new Town({ seed: 45, brain: none });
    const broke = town.addAgent({ persona: persona("Broke Scholar"), intelligence: 0.9, education: 0.9 });
    broke.savings = 0; broke.coins = 0; broke.debt = 30; broke.debtPrincipal = 30; // already borrowed to the hilt: no standing left to lend against
    const uneducated = town.addAgent({ persona: persona("Rich but Unschooled"), intelligence: 0.9, education: 0.1 });
    uneducated.savings = 1000;
    const founder = town.addAgent({ persona: persona("Founder"), intelligence: 0.9, education: 0.9 });
    founder.savings = 100;
    for (let i = 0; i < 60; i++) tryEntrepreneurshipOf(town);
    expect([...town.places.values()].some((p) => p.owner === broke.id)).toBe(false);
    expect([...town.places.values()].some((p) => p.owner === uneducated.id)).toBe(false);
    const opened = [...town.places.values()].find((p) => p.owner === founder.id && p.kind === "shop");
    expect(opened).toBeTruthy();
    expect(founder.savings).toBeLessThan(100); // paid for out of savings
    expect(town.events.some((e) => e.kind === "town.built" && e.actors[0] === founder.id && (e.payload as { entrepreneur?: boolean } | undefined)?.entrepreneur)).toBe(true);
  });

  it("survives a snapshot and restore intact", () => {
    const town = new Town({ seed: 46, brain: none });
    const a = town.addAgent({ persona: persona("Persisted"), intelligence: 0.73, education: 0.42 });
    const town2 = new Town({ seed: 46, brain: none });
    town2.restore(town.snapshot());
    const b = town2.agents.get(a.id)!;
    expect(b.intelligence).toBe(a.intelligence);
    expect(b.education).toBe(a.education);
  });

  it("defaults intelligence and education gracefully when restoring a record from before they existed", () => {
    const town = new Town({ seed: 47, brain: none });
    const a = town.addAgent({ persona: persona("Legacy") });
    const snap = town.snapshot();
    const state = snap.agents[0]!.state as Record<string, unknown>;
    delete state.intelligence; delete state.education;
    const town2 = new Town({ seed: 47, brain: none });
    town2.restore(snap);
    const b = town2.agents.get(a.id)!;
    expect(b.intelligence).toBe(0.5);
    expect(b.education).toBe(0);
  });
});
