import type { AgentId } from "@unwatched/protocol";

/** A body that emerged from shared circumstance, not a charter anyone wrote: workers of a trade, owners who sell,
 * backers of a cause, the devout who keep turning up to the same graveside and the same table. It presses; it does
 * not command — the town still decides what it does with the pressure. */
export interface Faction {
  id: string;
  kind: "union" | "guild" | "party" | "faith";
  name: string;
  /** What actually ties the members together: a job id for a union, "trade" for the merchants' guild, a law's text for a party, "devout" for a faith. Kept so membership can be recomputed from the same real state night after night. */
  basis: string;
  members: AgentId[];
  founded: number;
  /** How strongly bound together, 0..1: rises the longer the circumstance holds and the more its members trust one another; fades when it doesn't. Never rolled. */
  cohesion: number;
  /** The day its collective action last fired, so it does not fire every night it could. Null before the first time. */
  lastActionDay: number | null;
}

const MIN_MEMBERS: Record<Faction["kind"], number> = { union: 2, guild: 2, party: 3, faith: 3 };

/** A faction's cohesion is the trust its members hold in one another, averaged, nudged toward that reading a little
 * each night the same way the island's culture drifts toward its day: no dice, just what the relationships actually
 * show. A lone member (or one the town has never let build any relationships) reads as modestly bound, not zero —
 * shared circumstance is itself a kind of tie. */
export function readCohesion(members: AgentId[], trustBetween: (a: AgentId, b: AgentId) => number): number {
  if (members.length <= 1) return 0.35;
  let sum = 0, n = 0;
  for (const a of members) for (const b of members) { if (a === b) continue; sum += trustBetween(a, b); n++; }
  return n ? Math.max(0, Math.min(1, sum / n)) : 0.35;
}

/** Nudge a faction's cohesion a fraction of the way toward what its members' trust actually reads today. */
export function driftCohesion(current: number, target: number, alpha = 0.08): number {
  return Math.max(0, Math.min(1, current + (target - current) * alpha));
}

export function minMembers(kind: Faction["kind"]): number { return MIN_MEMBERS[kind]; }
