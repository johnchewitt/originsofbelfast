/**
 * Lightweight search across events, people and places.
 *
 * Deliberately simple and deterministic: tokenised matching with weights
 * for titles, names and tags. Good enough for a curated dataset of a few
 * hundred records and fully testable.
 */
import type { HistoricalEvent } from "../types/history";

export interface PlaceRecord {
  id: string;
  name: string;
  historical_name: string;
  lon: number;
  lat: number;
  uncertainty_m: number;
  basis: string;
}

export type SearchResult =
  | { kind: "event"; id: string; label: string; detail: string; score: number }
  | { kind: "person"; id: string; label: string; detail: string; score: number; eventIds: string[] }
  | { kind: "place"; id: string; label: string; detail: string; score: number };

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "and", "for", "with", "by", "from", "was", "were", "is", "show", "me",
  "where", "what", "did", "take", "fly", "all", "belfast", "s",
]);

/** Lower-case, strip accents and punctuation, split into meaningful tokens. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function scoreText(tokens: string[], text: string, weight: number): number {
  if (!text) return 0;
  const hay = ` ${tokenize(text).join(" ")} `;
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(` ${t} `)) score += weight;
    else if (t.length >= 4 && hay.includes(` ${t}`)) score += weight * 0.6;
  }
  return score;
}

export interface SearchIndex {
  events: HistoricalEvent[];
  places: PlaceRecord[];
  people: Map<string, string[]>;
}

export function buildSearchIndex(events: HistoricalEvent[], places: PlaceRecord[]): SearchIndex {
  const people = new Map<string, string[]>();
  for (const e of events) {
    for (const person of e.people) {
      const list = people.get(person) ?? [];
      list.push(e.event_id);
      people.set(person, list);
    }
  }
  return { events, places, people };
}

/** Ranked search results (best first), at most `limit`. */
export function search(index: SearchIndex, query: string, limit = 12): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const results: SearchResult[] = [];

  for (const [person, eventIds] of index.people) {
    const s = scoreText(tokens, person, 6);
    if (s >= tokens.length * 4) {
      results.push({ kind: "person", id: person, label: person, detail: `${eventIds.length} event${eventIds.length === 1 ? "" : "s"}`, score: s + 2, eventIds });
    }
  }
  for (const p of index.places) {
    const s = scoreText(tokens, p.name, 5) + scoreText(tokens, p.historical_name, 5);
    if (s > 0) results.push({ kind: "place", id: p.id, label: p.historical_name || p.name, detail: p.name, score: s });
  }
  for (const e of index.events) {
    const s =
      scoreText(tokens, e.title, 5) +
      scoreText(tokens, e.historical_location_name ?? "", 3) +
      scoreText(tokens, e.location_name ?? "", 2) +
      scoreText(tokens, e.tags.join(" "), 3) +
      scoreText(tokens, e.people.join(" "), 2) +
      scoreText(tokens, e.description, 0.5);
    if (s > 0) {
      results.push({ kind: "event", id: e.event_id, label: e.title, detail: String(Math.floor(e.start_year)), score: s + e.timeline_importance * 0.2 });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Events that mention a person (case-insensitive substring of the name). */
export function eventsForPerson(index: SearchIndex, name: string): HistoricalEvent[] {
  const needle = tokenize(name).join(" ");
  return index.events.filter((e) => e.people.some((p) => tokenize(p).join(" ").includes(needle)));
}
