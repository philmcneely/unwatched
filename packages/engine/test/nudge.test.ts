import { describe, it, expect } from "vitest";
import { Town, MINUTES_PER_DAY } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string): Persona => ({ name, age: 30, origin: "the mainland", summary: "A person.", want: "somewhere to belong", fear: "being forgotten", secret: "none", strangers: "wary", advice: "weighs it slowly", traits: { warmth: 0.5, pride: 0.4, caution: 0.5, honesty: 0.6, ambition: 0.5 } });
const stranger = (name: string, cameBecause?: string): Persona => ({ ...persona(name), cameBecause });

describe("the reader's lever — nudges that influence, never command", () => {
  it("seeds a rumor with a few islanders: they know it and may repeat it, but nothing forces them to", () => {
    const town = new Town({ seed: 1, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Ana") });
    const b = town.addAgent({ persona: persona("Bosko") });
    const r = town.nudge("rumor", { text: "The old lighthouse keeper buried something on the point.", agentIds: [a.id, b.id] });
    expect(r.ok).toBe(true);
    expect(a.rumors).toContain("The old lighthouse keeper buried something on the point.");
    expect(b.rumors).toContain("The old lighthouse keeper buried something on the point.");
    // it is knowledge, not an order: nothing about the agent's own action is touched by seeding it
    expect(a.memory.some((m) => m.kind === "rumor" && m.text.includes("lighthouse keeper"))).toBe(true);
    expect(town.events.some((e) => e.kind === "town.nudge" && e.payload?.nudgeKind === "rumor")).toBe(true);
  });

  it("without named agents, a rumor still lands with a handful of islanders, chosen from the town's own dice", () => {
    const town = new Town({ seed: 2, brain: none, minutesPerTick: 1 });
    for (const n of ["Ana", "Bosko", "Cveta", "Duje", "Ela"]) town.addAgent({ persona: persona(n) });
    const r = town.nudge("rumor", { text: "There is fish running thick off the north point tonight." });
    expect(r.ok).toBe(true);
    const heard = [...town.agents.values()].filter((x) => x.rumors.includes("There is fish running thick off the north point tonight."));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.length).toBeLessThanOrEqual(3);
  });

  it("rate-limits rumors: seeding a second one too soon is refused, and the cooldown is measured against the world's own clock", () => {
    const town = new Town({ seed: 3, brain: none, minutesPerTick: 1 });
    town.addAgent({ persona: persona("Ana") });
    expect(town.nudge("rumor", { text: "First rumor." }).ok).toBe(true);
    const again = town.nudge("rumor", { text: "Second rumor, too soon." });
    expect(again.ok).toBe(false);
    town.skip(6 * 60);
    expect(town.nudge("rumor", { text: "Third rumor, later." }).ok).toBe(true);
  });

  it("schedules a stranger's arrival: they land later, as themselves, with nothing about their persona forcing what they do next", async () => {
    const town = new Town({ seed: 4, brain: none, minutesPerTick: 1 });
    const before = town.agents.size;
    const r = town.nudge("stranger", { persona: stranger("Ivo Marić", "looking for honest work"), coins: 30, delayMinutes: 5 });
    expect(r.ok).toBe(true);
    // not there yet — the boat hasn't landed
    expect(town.agents.size).toBe(before);
    for (let i = 0; i <= 5; i++) await town.tick();
    const arrived = [...town.agents.values()].find((a) => a.persona.name === "Ivo Marić");
    expect(arrived).toBeTruthy();
    expect(arrived!.coins).toBe(30);
    expect(town.events.some((e) => e.kind === "agent.arrive" && e.actors[0] === arrived!.id)).toBe(true);
    expect(town.events.some((e) => e.kind === "town.nudge" && e.payload?.nudgeKind === "stranger" && e.actors[0] === arrived!.id)).toBe(true);
    // arriving minted the coins they carried, same as any other arrival — nothing conjured off the books
    expect(town.minted).toBeGreaterThanOrEqual(30);
  });

  it("rejects a stranger whose persona doesn't hold up, and rate-limits how often one can be sent for", () => {
    const town = new Town({ seed: 5, brain: none, minutesPerTick: 1 });
    const bad = town.nudge("stranger", { persona: { name: "" } as unknown as Persona });
    expect(bad.ok).toBe(false);
    expect(town.nudge("stranger", { persona: stranger("First Arrival") }).ok).toBe(true);
    expect(town.nudge("stranger", { persona: stranger("Second Arrival") }).ok).toBe(false);
  });

  it("a scheduled stranger survives a snapshot/restore: the record carries the boat still on the water", async () => {
    const town = new Town({ seed: 6, brain: none, minutesPerTick: 1 });
    expect(town.nudge("stranger", { persona: stranger("Restored Arrival"), delayMinutes: 10 }).ok).toBe(true);
    const town2 = new Town({ seed: 6, brain: none, minutesPerTick: 1 });
    town2.restore(town.snapshot());
    for (let i = 0; i <= 10; i++) await town2.tick();
    expect([...town2.agents.values()].some((a) => a.persona.name === "Restored Arrival")).toBe(true);
  });

  it("gives a small windfall as minted coin — clamped, and it does not force the agent to do anything with it", () => {
    const town = new Town({ seed: 7, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Windfall Ana") });
    a.coins = 10;
    const mintedBefore = town.minted;
    const r = town.nudge("windfall", { agentId: a.id, amount: 9999 }); // clamped, not a jackpot
    expect(r.ok).toBe(true);
    expect(a.coins).toBe(10 + 12); // NUDGE_WINDFALL_MAX
    expect(town.minted - mintedBefore).toBe(12);
    expect(town.events.some((e) => e.kind === "town.nudge" && e.payload?.nudgeKind === "windfall" && e.actors[0] === a.id)).toBe(true);
    // the agent's own decide loop is untouched — a coin nudge is not an action nudge
  });

  it("a hardship burns coin conservingly, clamps at a modest floor, and never drives a purse negative", () => {
    const town = new Town({ seed: 8, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Hardship Bosko") });
    a.coins = 5;
    const burnedBefore = town.burned;
    const tooMuch = town.nudge("windfall", { agentId: a.id, amount: -9999 });
    expect(tooMuch.ok).toBe(false); // would drive the purse negative even after clamping to -8
    expect(a.coins).toBe(5);
    const ok = town.nudge("windfall", { agentId: a.id, amount: -3 });
    expect(ok.ok).toBe(true);
    expect(a.coins).toBe(2);
    expect(town.burned - burnedBefore).toBe(3);
  });

  it("rate-limits a windfall/hardship per person, independent of another person's own cooldown", () => {
    const town = new Town({ seed: 9, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Ana") });
    const b = town.addAgent({ persona: persona("Bosko") });
    a.coins = 10; b.coins = 10;
    expect(town.nudge("windfall", { agentId: a.id, amount: 5 }).ok).toBe(true);
    expect(town.nudge("windfall", { agentId: a.id, amount: 5 }).ok).toBe(false);
    expect(town.nudge("windfall", { agentId: b.id, amount: 5 }).ok).toBe(true);
  });

  it("a whisper reaches the agent as an unread letter, not a forced action — it is there to be read, heeded, ignored, or defied", () => {
    const town = new Town({ seed: 10, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Whispered Ana") });
    const r = town.nudge("whisper", { agentId: a.id, text: "Bosko has been asking after you." });
    expect(r.ok).toBe(true);
    expect(a.letters.some((l) => l.text === "Bosko has been asking after you." && !l.read)).toBe(true);
    expect(town.events.some((e) => e.kind === "town.nudge" && e.payload?.nudgeKind === "whisper" && e.actors[0] === a.id)).toBe(true);
    // the letter is delivered, not acted on: the agent's own next thought decides what, if anything, comes of it
    expect(a.letters.find((l) => l.text === "Bosko has been asking after you.")?.read).toBe(false);
  });

  it("rate-limits whispers per agent", () => {
    const town = new Town({ seed: 11, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Ana") });
    expect(town.nudge("whisper", { agentId: a.id, text: "First." }).ok).toBe(true);
    expect(town.nudge("whisper", { agentId: a.id, text: "Second, too soon." }).ok).toBe(false);
    expect(a.letters.filter((l) => !l.read).length).toBe(1);
  });

  it("a whisper's letter survives a snapshot/restore, exactly as any other owner letter already does", () => {
    const town = new Town({ seed: 12, brain: none, minutesPerTick: 1 });
    const a = town.addAgent({ persona: persona("Ana") });
    town.nudge("whisper", { agentId: a.id, text: "Something worth noticing." });
    const town2 = new Town({ seed: 12, brain: none, minutesPerTick: 1 });
    town2.restore(town.snapshot());
    const restored = town2.agents.get(a.id)!;
    expect(restored.letters.some((l) => l.text === "Something worth noticing." && !l.read)).toBe(true);
  });

  it("refuses a nudge aimed at nobody, and a rumor or whisper with no words", () => {
    const town = new Town({ seed: 13, brain: none, minutesPerTick: 1 });
    expect(town.nudge("whisper", { agentId: "ag_no_such_person", text: "hello" }).ok).toBe(false);
    expect(town.nudge("windfall", { agentId: "ag_no_such_person", amount: 5 }).ok).toBe(false);
    const a = town.addAgent({ persona: persona("Ana") });
    expect(town.nudge("whisper", { agentId: a.id, text: "   " }).ok).toBe(false);
    expect(town.nudge("rumor", { text: "" }).ok).toBe(false);
  });

  void MINUTES_PER_DAY;
});
