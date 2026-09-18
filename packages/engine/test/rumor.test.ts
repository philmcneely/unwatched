import { describe, it, expect } from "vitest";
import { Town } from "../src/index.ts";
import type { Brain, AgentState, Tier, Rumor } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};
const persona = (name: string): Persona => ({ name, age: 31, origin: "the mainland", summary: "A person.", want: "to be well thought of", fear: "a bad name", secret: "none", strangers: "wary", advice: "considers it", traits: { warmth: 0.5, pride: 0.4, caution: 0.4, honesty: 0.6, ambition: 0.4 } });

// day-end only, exactly like disease's own tests: calling it directly, with no tick() in between, advances the
// gossip bookkeeping one night at a time without habit walking anyone anywhere — the only way to hold agents
// apart across many simulated nights on purpose.
function nightlyOf(town: Town) { return (town as unknown as { nightly(): Promise<void> }).nightly(); }

describe("rumor & reputation propagation", () => {
  it("spreads from a knower to a co-located third party, but never to someone elsewhere, and shifts the hearer's trust in the subject", async () => {
    const town = new Town({ seed: 60, brain: none });
    const knower = town.addAgent({ persona: persona("Knower") });
    const neighbour = town.addAgent({ persona: persona("Neighbour") });
    const elsewhere = town.addAgent({ persona: persona("Elsewhere") });
    const target = town.addAgent({ persona: persona("Target") });
    knower.location = "harbor"; neighbour.location = "harbor"; elsewhere.location = "market"; target.location = "council";
    const baselineTrust = neighbour.relationships.get(target.id)?.trust ?? 0.3;

    // reseed the knower's claim about the target each morning, the same way the disease test re-sets the
    // source's infectiousness, so the test isolates the SPREAD roll rather than depending on exactly when
    // a chance-based hop happens to land
    for (let day = 0; day < 40 && !neighbour.gossip.some((r) => r.about === target.id); day++) {
      knower.gossip = [{ id: 1, about: target.id, claim: "Target has been taking more than a fair share at the mill.", strength: 0.9, heard: town.day, hops: 0 }];
      await nightlyOf(town);
    }

    const heard = neighbour.gossip.find((r) => r.about === target.id);
    expect(heard).toBeDefined(); // shared a place with the knower, night after night
    expect(elsewhere.gossip.some((r) => r.about === target.id)).toBe(false); // never once shared a place with the knower
    expect(neighbour.relationships.get(target.id)?.trust ?? 0.3).toBeLessThan(baselineTrust); // reputation propagated through the graph, not first-hand dealing
    const notice = town.events.find((e) => e.kind === "town.notice" && e.actors[0] === neighbour.id && (e.payload as { rumor?: string } | undefined)?.rumor === target.id);
    expect(notice).toBeDefined();
  });

  it("a rumor rides the boat: a traveller's own bad name arrives with them, and still spreads at the destination the same way", async () => {
    let north!: Town;
    const south = new Town({ seed: 61, brain: none, minutesPerTick: 1, name: "The island", idPrefix: "south", harbors: [{ id: "north", name: "Northreach" }], onDepart: async (p, to) => { if (to !== "north") return false; north.arrive(p); return true; } });
    north = new Town({ seed: 62, brain: none, minutesPerTick: 1, name: "Northreach", idPrefix: "north", harbors: [{ id: "south", name: "The island" }], onDepart: async () => false });
    const traveller = south.addAgent({ persona: persona("Talked-About Traveller") });
    traveller.gossip = [{ id: 1, about: traveller.id, claim: "word is Talked-About Traveller cannot be trusted with a debt.", strength: 0.8, heard: south.day, hops: 0 }];
    traveller.location = "harbor"; traveller.coins = 20;
    const local = north.addAgent({ persona: persona("Northreach Local") }); local.location = "harbor";
    expect(local.gossip.length).toBe(0);

    while (south.hour < 9) await south.tick();
    traveller.location = "harbor";
    expect(south.apply(traveller, { kind: "leave", to: "Northreach", why: "a fresh start" }, "test")).toBe(true);
    await south.tick();
    expect(south.agents.has(traveller.id)).toBe(false);

    const arrived = [...north.agents.values()].find((x) => x.persona.name === "Talked-About Traveller")!;
    expect(arrived).toBeTruthy();
    expect(arrived.location).toBe("harbor"); // same place the local is, so the next night can test the spread
    // their own name's trouble rode the boat with them, the same in-process way notoriety and fugitive status do
    const ownRumor = arrived.gossip.find((r) => r.about === arrived.id);
    expect(ownRumor).toBeDefined();
    expect(north.events.some((e) => e.kind === "town.notice" && e.actors[0] === arrived.id && /talk already following/.test(e.text))).toBe(true);

    // and from there it spreads to a citizen at the destination exactly as it would have at home
    for (let day = 0; day < 40 && !local.gossip.some((r) => r.about === arrived.id); day++) {
      arrived.gossip = [{ id: 99, about: arrived.id, claim: "word is this one cannot be trusted with a debt.", strength: 0.8, heard: north.day, hops: 1 }];
      await nightlyOf(north);
    }
    expect(local.gossip.some((r) => r.about === arrived.id)).toBe(true);
  });

  it("decays and is capped over days", async () => {
    const town = new Town({ seed: 63, brain: none });
    const a = town.addAgent({ persona: persona("Well-Talked-About") });
    // more than the cap, so the very first night's bookkeeping must trim it down to the strongest few
    a.gossip = Array.from({ length: 12 }, (_, i): Rumor => ({ id: i, about: `subject-${i}`, claim: `claim ${i}`, strength: 0.2 + i * 0.05, heard: town.day, hops: 0 }));
    await nightlyOf(town);
    expect(a.gossip.length).toBeLessThanOrEqual(8);

    // a single, middling rumor fades night after night and is eventually forgotten
    a.gossip = [{ id: 100, about: "someone", claim: "a claim", strength: 0.3, heard: town.day, hops: 0 }];
    const startStrength = a.gossip[0]!.strength;
    await nightlyOf(town);
    expect(a.gossip[0]!.strength).toBeLessThan(startStrength);
    for (let i = 0; i < 20 && a.gossip.length; i++) await nightlyOf(town);
    expect(a.gossip.length).toBe(0); // too faint to matter, the same way an old memory is forgotten
  });

  it("survives a snapshot/restore round trip", () => {
    const town = new Town({ seed: 64, brain: none });
    const a = town.addAgent({ persona: persona("Carries A Story") });
    a.gossip = [{ id: 7, about: "someone-else", claim: "a claim worth keeping", strength: 0.62, heard: town.day, hops: 2 }];
    const snap = town.snapshot();
    const town2 = new Town({ seed: 64, brain: none });
    town2.restore(snap);
    expect(town2.agents.get(a.id)!.gossip).toEqual([{ id: 7, about: "someone-else", claim: "a claim worth keeping", strength: 0.62, heard: town.day, hops: 2 }]);
  });

  it("a snapshot from before rumors existed restores an agent with no gossip", () => {
    const town = new Town({ seed: 65, brain: none });
    const a = town.addAgent({ persona: persona("Old Record") });
    const snap = town.snapshot();
    delete (snap.agents.find((s) => s.id === a.id)!.state as { gossip?: unknown }).gossip;
    const town2 = new Town({ seed: 65, brain: none });
    town2.restore(snap);
    expect(town2.agents.get(a.id)!.gossip).toEqual([]);
  });
});
