import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

/**
 * "Create a person, give them a purpose ... and let them do what they do, or fall in love instead."
 *
 * These tests never let a brain decide anything: they drive the capability directly through `town.apply`,
 * exactly the discipline `crime.test.ts` and `rumor.test.ts` already use for deterministic engine tests. A
 * seeded purpose is only ever a felt want (see `perceive()`/`feels`) — it must never, on its own, change what
 * happens. The teeth (`harm`, `sabotage`) are ordinary actions any agent could take; only a real `apply` call
 * ever fires them.
 */
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); },
  async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string): Persona => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "A room.", fear: "Debt.", secret: "None.", strangers: "Polite.", advice: "Considers it.", traits: { warmth: 0.4, pride: 0.4, caution: 0.4, honesty: 0.6, ambition: 0.3 } });

describe("seeded-purpose provocateurs: influence, not command", () => {
  it("a stranger can be seeded with a purpose that appears in AgentState and in what they perceive, as a felt want", async () => {
    const town = new Town({ seed: 70, brain: none, minutesPerTick: 1 });
    const res = town.nudge("stranger", { persona: persona("Seed"), purpose: { kind: "harm", intensity: 0.9, target: "a rival at the bakery" }, delayMinutes: 0 });
    expect(res.ok).toBe(true);
    await town.tick();
    const seeded = [...town.agents.values()].find((a) => a.persona.name === "Seed")!;
    expect(seeded).toBeTruthy();
    expect(seeded.purpose).toEqual({ kind: "harm", intensity: 0.9, target: "a rival at the bakery", since: town.day });

    const p = town.perceive(seeded);
    expect(p.self.purpose).toEqual({ kind: "harm", intensity: 0.9, target: "a rival at the bakery" });
    expect(p.self.feels?.purpose).toMatch(/a rival at the bakery/);
    expect(p.self.feels?.purpose).toMatch(/yours to act on, ignore, or turn into something else entirely/); // the seed says out loud that it is not a command
  });

  it("seeding a purpose alone changes no outcome: a 'none' brain never acts on it, so nothing in the record moves", async () => {
    const town = new Town({ seed: 71, brain: none, minutesPerTick: 60 });
    const provocateur = town.addAgent({ persona: persona("Quiet Seed"), purpose: { kind: "harm", intensity: 1, target: "everyone" } });
    const bystander = town.addAgent({ persona: persona("Bystander") });
    provocateur.location = bystander.location = "market";
    const startDay = town.day;
    while (town.day < startDay + 3) await town.tick(); // three full days of a "none" brain: only habit runs, decide() is never called

    expect(town.events.some((e) => e.kind === "agent.harm" || e.kind === "agent.sabotage")).toBe(false);
    expect(provocateur.notoriety).toBe(0);
    expect(bystander.needs.rest).toBeLessThan(0.95); // untouched by any violence
  });

  it("the harm capability injures the target, is witnessed, raises notoriety and spawns rumor — none of it auto-fired, only invoked", () => {
    const town = new Town({ seed: 72, brain: none });
    const attacker = town.addAgent({ persona: persona("Attacker"), purpose: { kind: "harm", intensity: 0.5, target: "Victim" } });
    const victim = town.addAgent({ persona: persona("Victim") });
    const witness = town.addAgent({ persona: persona("Witness") });
    attacker.location = victim.location = witness.location = "market";
    const restBefore = victim.needs.rest;

    expect(town.apply(attacker, { kind: "harm", who: victim.id, how: "shoved them into the stalls" }, "test")).toBe(true);

    expect(victim.needs.rest).toBeGreaterThan(restBefore); // the physical toll
    expect(attacker.notoriety).toBeGreaterThan(0); // seen doing it
    expect(witness.gossip.some((r) => r.about === attacker.id)).toBe(true); // spawns rumor through the existing gossip layer
    const event = town.events.find((e) => e.kind === "agent.harm");
    expect(event).toBeTruthy();
    expect(event!.actors).toEqual([attacker.id, victim.id]); // witnessable: both actors on the record
    expect(town.agents.has(victim.id)).toBe(true); // a modest blow does not kill
  });

  it("a strong enough blow against a body already failing can kill — the same physics a hungry, roofless night already carries", () => {
    const town = new Town({ seed: 73, brain: none });
    const attacker = town.addAgent({ persona: persona("Killer"), purpose: { kind: "harm", intensity: 1, target: "Mark" } });
    const mark = town.addAgent({ persona: persona("Mark") });
    attacker.location = mark.location = "market";
    mark.starving = 2; // already weak with hunger

    expect(town.apply(attacker, { kind: "harm", who: mark.id, how: "struck them down" }, "test")).toBe(true);

    expect(town.agents.has(mark.id)).toBe(false); // removed from the living town
    expect(town.events.some((e) => e.kind === "agent.died" && e.actors[0] === mark.id)).toBe(true);
    expect(town.events.some((e) => e.kind === "agent.harm" && (e.payload as { lethal?: boolean }).lethal)).toBe(true);
  });

  it("the sabotage capability breaks the workplace, empties its shelves, and is witnessed the same way", () => {
    const town = new Town({ seed: 74, brain: none });
    const saboteur = town.addAgent({ persona: persona("Saboteur"), purpose: { kind: "sabotage", intensity: 0.8, target: "the bakery" } });
    const witness = town.addAgent({ persona: persona("Baker's Friend") });
    saboteur.location = witness.location = "bakery";
    const bakery = town.places.get("bakery")!;
    expect(bakery.stock.flour).toBeGreaterThan(0);

    expect(town.apply(saboteur, { kind: "sabotage", how: "loosed the millstone and salted the flour" }, "test")).toBe(true);

    expect(bakery.brokenUntil).toBeGreaterThan(town.day);
    expect(bakery.stock.flour).toBe(0);
    expect(bakery.stock.bread).toBe(0);
    expect(saboteur.notoriety).toBeGreaterThan(0);
    expect(witness.gossip.some((r) => r.about === saboteur.id)).toBe(true);
    expect(town.events.some((e) => e.kind === "agent.sabotage" && e.actors[0] === saboteur.id)).toBe(true);
  });

  it("without a seeded purpose the same capability still works, only more mildly — the purpose sharpens it, it does not gate it", () => {
    const town = new Town({ seed: 75, brain: none });
    const ordinary = town.addAgent({ persona: persona("No Purpose") }); // no purpose at all
    const victim = town.addAgent({ persona: persona("Someone") });
    ordinary.location = victim.location = "market";
    expect(ordinary.purpose ?? null).toBeNull();

    expect(town.apply(ordinary, { kind: "harm", who: victim.id, how: "a shove in a bad temper" }, "test")).toBe(true);
    expect(town.agents.has(victim.id)).toBe(true); // never lethal without a seed sharpening it this far
    expect(ordinary.notoriety).toBeGreaterThan(0); // but it still counts, still costs standing — the world does not need a purpose to have consequences
  });

  it("a sabotage witnessed is a sabotage accusable: the council's own guilt count now weighs it, and boarding the boat before the hearing marks the trail a hub would follow", async () => {
    const town = new Town({ seed: 76, brain: none, minutesPerTick: 1 });
    const accuser = town.addAgent({ persona: persona("Accuser") });
    const saboteur = town.addAgent({ persona: persona("Fled Saboteur") });
    while (town.weekday === 0) await town.tick(); // the council does not sit on Sunday

    accuser.location = saboteur.location = "bakery"; accuser.asleep = false; saboteur.asleep = false;
    expect(town.apply(saboteur, { kind: "sabotage", how: "broke the mill wheel" }, "test")).toBe(true);
    expect(saboteur.fugitive ?? false).toBe(false);

    accuser.location = "council";
    while (town.hour < 9 || town.hour >= 14) await town.tick();
    accuser.location = "council"; accuser.asleep = false;
    expect(town.apply(accuser, { kind: "accuse", who: saboteur.persona.name, of: "sabotaging the bakery" }, "test")).toBe(true);

    // before the council can hear it, the accused boards the boat: the charge cannot follow them, but their notoriety and, now, their fugitive flag would — the exact signal the hub's watchlist wants
    saboteur.location = "harbor"; saboteur.asleep = false;
    while (town.hour < 6 || town.hour > 20) await town.tick();
    expect(town.apply(saboteur, { kind: "leave" }, "test")).toBe(true);
    expect(town.agents.has(saboteur.id)).toBe(false);

    // the guilt an eventual hearing would have counted already includes the sabotage itself, not only theft or debt
    const guiltEvents = town.events.filter((e) => e.actors[0] === saboteur.id && e.kind === "agent.sabotage");
    expect(guiltEvents.length).toBeGreaterThan(0);
    expect(town.events.some((e) => e.kind === "town.notice" && e.actors[0] === saboteur.id && (e.payload as { fugitive?: boolean }).fugitive)).toBe(true);
  });

  it("purpose, and the trouble it left behind, survive a snapshot/restore round trip", () => {
    const town = new Town({ seed: 77, brain: none });
    const a = town.addAgent({ persona: persona("Marked Seed"), purpose: { kind: "agitate", intensity: 0.7, target: "the mill workers" } });
    a.notoriety = 0.4; a.fugitive = true;
    const snap = town.snapshot();
    const town2 = new Town({ seed: 77, brain: none });
    town2.restore(snap);
    const restored = town2.agents.get(a.id)!;
    expect(restored.purpose).toEqual({ kind: "agitate", intensity: 0.7, target: "the mill workers", since: a.purpose!.since });
    expect(restored.notoriety).toBeCloseTo(0.4, 5);
    expect(restored.fugitive).toBe(true);
  });

  it("a purpose still pending on the water (not yet a person) survives a snapshot/restore round trip too", () => {
    const town = new Town({ seed: 78, brain: none });
    town.nudge("stranger", { persona: persona("On The Water"), purpose: { kind: "sabotage", intensity: 0.6, target: "the smithy" }, delayMinutes: 500 });
    const snap = town.snapshot();
    expect(snap.pendingStrangers?.[0]?.purpose).toEqual({ kind: "sabotage", intensity: 0.6, target: "the smithy" });
    const town2 = new Town({ seed: 78, brain: none });
    town2.restore(snap);
    expect(town2.snapshot().pendingStrangers?.[0]?.purpose).toEqual({ kind: "sabotage", intensity: 0.6, target: "the smithy" });
  });
});
