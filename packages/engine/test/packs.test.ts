import { describe, it, expect } from "vitest";
import { Town, PACKS } from "../src/index.ts";
import type { WorldPack } from "../src/index.ts";
import type { Brain, AgentState, Tier } from "../src/index.ts";
import type { Perception, ActionProposal, Persona } from "@unwatched/protocol";

const persona = (name: string): Persona => ({ name, age: 30, origin: "here", summary: "A soul.", want: "a life", fear: "a bad end", secret: "none", strangers: "open", advice: "get on with it", traits: { warmth: 0.5, pride: 0.5, caution: 0.5, honesty: 0.6, ambition: 0.6 } });
const none: Brain = {
  name: "none",
  async decide(_p: Perception, _a: AgentState, _t: Tier): Promise<ActionProposal> { return { action: { kind: "wait" }, remember: [] }; },
  async converse() { throw new Error("no"); }, async reflect() { throw new Error("no"); }, async plan() { throw new Error("no"); },
  async digest() { return { text: "", headline: "" }; }, async child() { throw new Error("no"); }, async writePaper() { throw new Error("no"); }, async life() { throw new Error("no"); }, async judge() { return { happened: "it passed", plausible: true, coins_spent: 0, item_gained: null, item_lost: null, eases: null, trust: [] }; },
};

// the ids the habit engine falls back on: every pack must have them, and they must be reachable from the harbor
const HABIT = ["harbor", "inn", "market", "bakery", "fields", "chapel", "tavern"] as const;

const reachableFrom = (pack: WorldPack, start: string): Set<string> => {
  const byId = new Map(pack.places.map((p) => [p.id, p]));
  const seen = new Set<string>([start]); const q = [start];
  while (q.length) { const cur = q.shift()!; for (const nx of byId.get(cur)?.exits ?? []) if (byId.has(nx) && !seen.has(nx)) { seen.add(nx); q.push(nx); } }
  return seen;
};

describe("every world pack is well-formed", () => {
  for (const [id, pack] of Object.entries(PACKS)) {
    describe(`${id} (${pack.name})`, () => {
      const ids = new Set(pack.places.map((p) => p.id));

      it("has the habit-critical places", () => {
        for (const h of HABIT) expect(ids.has(h), `${id} is missing "${h}"`).toBe(true);
      });

      it("every exit, job, produce, supply, feast and float points at a real place", () => {
        for (const p of pack.places) for (const e of p.exits) expect(ids.has(e), `${id}: ${p.id} exits to unknown "${e}"`).toBe(true);
        for (const j of pack.jobs) expect(ids.has(j.place), `${id}: job ${j.id} at unknown "${j.place}"`).toBe(true);
        for (const pr of pack.produce) expect(ids.has(pr.place), `${id}: produce at unknown "${pr.place}"`).toBe(true);
        for (const s of pack.supply) { expect(ids.has(s.from), `${id}: supply from unknown "${s.from}"`).toBe(true); expect(ids.has(s.to), `${id}: supply to unknown "${s.to}"`).toBe(true); }
        for (const f of pack.feasts) expect(ids.has(f.place), `${id}: feast at unknown "${f.place}"`).toBe(true);
        for (const k of Object.keys(pack.float)) expect(ids.has(k), `${id}: float for unknown "${k}"`).toBe(true);
      });

      it("job ids are unique and place ids are unique", () => {
        expect(new Set(pack.places.map((p) => p.id)).size).toBe(pack.places.length);
        expect(new Set(pack.jobs.map((j) => j.id)).size).toBe(pack.jobs.length);
      });

      it("the habit-critical places are all reachable from the harbor", () => {
        const seen = reachableFrom(pack, "harbor");
        for (const h of HABIT) expect(seen.has(h), `${id}: "${h}" is not reachable from the harbor`).toBe(true);
      });

      it("a producer's inputs can be had (produced here or brought in by a supply line)", () => {
        const madeHere = new Set(pack.produce.map((pr) => pr.makes));
        const suppliedIn = new Set(pack.supply.map((s) => s.item));
        for (const pr of pack.produce) if (pr.needs) expect(madeHere.has(pr.needs.item) || suppliedIn.has(pr.needs.item), `${id}: ${pr.place} needs "${pr.needs.item}" but nothing makes or brings it`).toBe(true);
      });

      it("builds a town and runs a few days without throwing", async () => {
        const town = new Town({ seed: 5, brain: none, pack });
        for (let i = 0; i < 8; i++) town.addAgent({ persona: persona(`P${i}`) });
        await town.run(2);
        expect(town.day).toBeGreaterThanOrEqual(2);
        for (const p of town.places.values()) for (const [k, v] of Object.entries(p.stock)) expect(v, `${id}: ${p.id} ${k} went negative`).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
