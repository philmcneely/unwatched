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
const persona = (name: string) => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "a clean drink", fear: "a dry throat", secret: "none", strangers: "plain", advice: "waits its turn", traits: { warmth: 0.5, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.4 } });

function nightlyOf(town: Town) { return (town as unknown as { nightly(): Promise<void> }).nightly(); }
function decayOf(town: Town, a: AgentState) { (town as unknown as { decayNeeds(a: AgentState): void }).decayNeeds(a); }

describe("water — thirst, wells, and hoarding", () => {
  it("finds a water source, even on a pack that never named a well", () => {
    const town = new Town({ seed: 1, brain: none });
    const src = town.waterPlace();
    expect(src).toBeTruthy();
    expect(town.places.get(src.id)).toBe(src);
  });

  it("thirst rises on its own over time and is a real, persisted need", () => {
    const town = new Town({ seed: 2, brain: none });
    const a = town.addAgent({ persona: persona("Dry") });
    expect(a.needs.thirst).toBeCloseTo(0.3, 5);
    for (let i = 0; i < 600; i++) decayOf(town, a);
    expect(a.needs.thirst!).toBeGreaterThan(0.3);
  });

  it("a drink at the water source relieves thirst", () => {
    const town = new Town({ seed: 3, brain: none });
    const a = town.addAgent({ persona: persona("Thirsty") });
    a.needs.thirst = 0.9;
    expect(town.drinkWater(a)).toBe(true);
    expect(a.needs.thirst!).toBeLessThan(0.9);
  });

  it("free access by default: nobody is turned away when the source has no owner", () => {
    const town = new Town({ seed: 4, brain: none });
    const a = town.addAgent({ persona: persona("Passerby") });
    a.coins = 0; a.needs.thirst = 0.9;
    expect(town.drinkWater(a)).toBe(true);
  });

  it("an owner who hoards the source can charge a fee, and turns away whoever cannot pay it", () => {
    const town = new Town({ seed: 5, brain: none });
    const owner = town.addAgent({ persona: persona("Owner") });
    const stranger = town.addAgent({ persona: persona("Stranger") });
    const src = town.waterPlace();
    src.owner = owner.id; src.water = { hoarded: true, fee: 3 };
    // the owner drinks free at their own source
    owner.needs.thirst = 0.9; owner.coins = 0;
    expect(town.drinkWater(owner)).toBe(true);
    expect(owner.needs.thirst!).toBeLessThan(0.9);
    // the stranger, without the fee, is turned away and stays thirsty
    stranger.coins = 2; stranger.needs.thirst = 0.9;
    const ownerCoinsBefore = owner.coins;
    expect(town.drinkWater(stranger)).toBe(false);
    expect(stranger.needs.thirst).toBe(0.9);
    expect(owner.coins).toBe(ownerCoinsBefore);
    // paying it, the stranger drinks, and the owner is paid
    stranger.coins = 5;
    expect(town.drinkWater(stranger)).toBe(true);
    expect(stranger.needs.thirst!).toBeLessThan(0.9);
    expect(stranger.coins).toBe(2);
    expect(owner.coins).toBe(ownerCoinsBefore + 3);
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors.includes(stranger.id) && /paid/.test(e.text))).toBe(true);
  });

  it("hoarding is real pressure: denied access, thirst keeps climbing where free access would have let it fall", () => {
    const town = new Town({ seed: 6, brain: none });
    const owner = town.addAgent({ persona: persona("Hoarder") });
    const poor = town.addAgent({ persona: persona("Denied") });
    const src = town.waterPlace();
    src.owner = owner.id; src.water = { hoarded: true, fee: 50 }; // far past what "poor" ever has
    poor.coins = 0; poor.needs.thirst = 0.5;
    const before = poor.needs.thirst;
    for (let i = 0; i < 600; i++) { decayOf(town, poor); expect(town.drinkWater(poor)).toBe(false); }
    expect(poor.needs.thirst!).toBeGreaterThan(before!);
  });

  it("going without water long enough is a real hardship, parallel to hunger, and does not kill on its own", async () => {
    const town = new Town({ seed: 7, brain: none });
    const a = town.addAgent({ persona: persona("Parched") });
    a.needs.thirst = 0.9; // already dehydrated when the night falls
    for (let i = 0; i < 10; i++) await nightlyOf(town);
    expect(a.parched).toBeGreaterThanOrEqual(2);
    expect(town.events.some((e) => e.kind === "agent.weak" && e.actors[0] === a.id && /thirst/.test(e.text))).toBe(true);
    // thirst is real hardship, not a death sentence: the agent is still here
    expect(town.agents.has(a.id)).toBe(true);
    expect(town.events.some((e) => e.kind === "agent.died" && e.actors[0] === a.id)).toBe(false);
  });

  it("a good drink resets the count of dehydrated nights", async () => {
    const town = new Town({ seed: 8, brain: none });
    const a = town.addAgent({ persona: persona("Recovering") });
    a.needs.thirst = 0.9;
    await nightlyOf(town); await nightlyOf(town);
    expect(a.parched).toBeGreaterThanOrEqual(2);
    town.drinkWater(a); // needs.thirst falls well under the dehydration line
    await nightlyOf(town);
    expect(a.parched).toBe(0);
  });

  it("survives a snapshot and restore: thirst, the dehydrated-nights count, and a hoarded source's owner and fee", () => {
    const town = new Town({ seed: 9, brain: none });
    const owner = town.addAgent({ persona: persona("Keeper") });
    const a = town.addAgent({ persona: persona("Carried Over") });
    a.needs.thirst = 0.77; a.parched = 1;
    const src = town.waterPlace();
    src.owner = owner.id; src.water = { hoarded: true, fee: 4 };
    const town2 = new Town({ seed: 9, brain: none });
    town2.restore(town.snapshot());
    const b = town2.agents.get(a.id)!;
    expect(b.needs.thirst).toBeCloseTo(0.77, 5);
    expect(b.parched).toBe(1);
    const src2 = town2.waterPlace();
    expect(src2.id).toBe(src.id);
    expect(src2.owner).toBe(owner.id);
    expect(src2.water).toEqual({ hoarded: true, fee: 4 });
  });
});
