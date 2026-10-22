/**
 * "Ask Belfast Rising" — deterministic question answering over the sourced
 * dataset.
 *
 * Every answer is assembled from event records and carries their evidence
 * level, so the assistant can never present a tradition as fact. An
 * optional language-model backend (see server/assistant-proxy) can be
 * consulted for open questions; it receives only retrieved records.
 */
import type { HistoricalConfidence, HistoricalEvent } from "../types/history";
import { eventsForPerson, search, tokenize, type SearchIndex } from "./search";

export type AskAction =
  | { type: "set-year"; year: number }
  | { type: "compare"; year: number; compareYear: number }
  | { type: "select-event"; eventId: string; approach?: "high-street" }
  | { type: "fit-events"; eventIds: string[]; year?: number }
  | { type: "start-tour"; tourId: string }
  | { type: "fly-place"; placeId: string };

export interface AskAnswer {
  intent: string;
  text: string;
  /** Event ids cited in the answer, shown with their evidence badges. */
  eventIds: string[];
  actions: AskAction[];
  /** True when nothing matched and an LLM backend could be consulted. */
  open: boolean;
}

const CONFIDENCE_NOTE: Record<HistoricalConfidence, string> = {
  documented: "documented",
  probable: "probable",
  approximate: "approximately located",
  tradition: "reported tradition — not confirmed",
};

const MIN_YEAR = 600;
const MAX_YEAR = 2026;

function byId(index: SearchIndex, id: string): HistoricalEvent | undefined {
  return index.events.find((e) => e.event_id === id);
}

function cite(index: SearchIndex, ids: string[]): string {
  return ids
    .map((id) => byId(index, id))
    .filter((e): e is HistoricalEvent => Boolean(e))
    .map((e) => `• ${e.title} (${Math.floor(e.start_year)}) — ${CONFIDENCE_NOTE[e.historical_confidence]}`)
    .join("\n");
}

function yearsIn(text: string): number[] {
  return [...text.matchAll(/\b(\d{3,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= MIN_YEAR && y <= MAX_YEAR);
}

const MEETING_EVENTS = ["rev-founding-1791", "rev-peggy-barclays", "rev-thatched-house", "rev-vicinage", "rev-cave-hill-1795"];
const DOCK_EVENTS = [
  "georgian-ballast-board-1785", "ind-victoria-channel", "metro-clarendon-1851", "metro-docks-1897",
  "edw-thompson-dock-1911", "conf-lagan-weir-1994", "regen-titanic-quarter",
];

/**
 * Answer a question. Patterns are checked from most to least specific.
 */
export function ask(index: SearchIndex, question: string): AskAnswer {
  const q = question.trim().toLowerCase();
  const years = yearsIn(q);

  // Compare two years.
  if (/\bcompare\b|\bversus\b|\bvs\.?\b/.test(q) && years.length >= 2) {
    const [a, b] = years as [number, number];
    return {
      intent: "compare",
      text: `Comparing ${a} (left) with ${b} (right). Both views share the same camera; buildings, streets and shorelines are drawn for each date. Remember that massing is illustrative — compare the pattern of growth rather than individual buildings.`,
      eventIds: [],
      actions: [{ type: "compare", year: a, compareYear: b }],
      open: false,
    };
  }

  // Execution site of Henry Joy McCracken.
  if (/(execut|hang|hanged|gallows)/.test(q) && /mccracken|henry joy/.test(q)) {
    const e = byId(index, "rev-execution-1798");
    return {
      intent: "mccracken-execution",
      text: `Henry Joy McCracken was hanged on 17 July 1798, aged 30, in front of the Market House at the corner of High Street and Corn Market, after a court-martial in the Assembly Rooms the same day. The Market House was demolished about 1810; the marker is placed from published descriptions and the adjacent excavated block, so its position is approximate (±${e?.location_uncertainty_m ?? 40} m). Flying down High Street now.`,
      eventIds: ["rev-execution-1798", "rev-court-martial-1798"],
      actions: [{ type: "set-year", year: 1798.54 }, { type: "select-event", eventId: "rev-execution-1798", approach: "high-street" }],
      open: false,
    };
  }

  // Morning Star / wake tradition.
  if (/morning star|pottinger|\bwake\b|waked/.test(q)) {
    return {
      intent: "morning-star",
      text: "A local tradition says McCracken was waked in a public house in Pottinger's Entry, now associated with the Morning Star. This is a reported tradition: no contemporary source for it was found, and the Morning Star is recorded as licensed only from about 1810 — so it should not be taken as evidence that the present pub existed in 1798. What is documented is his burial in the High Street churchyard (St George's).",
      eventIds: ["rev-wake-tradition", "rev-burial-1798"],
      actions: [{ type: "set-year", year: 1798.55 }, { type: "select-event", eventId: "rev-wake-tradition" }],
      open: false,
    };
  }

  // Crown Tavern / founding.
  if (/crown (tavern|entry)/.test(q) || (/found/.test(q) && /united irish/.test(q))) {
    return {
      intent: "crown-tavern",
      text: "The Society of United Irishmen was founded in Belfast in October 1791 — 14 October in Wikipedia's chronology. Local tradition and the Belfast Entries project place the meeting in the Crown Tavern in Crown Entry; another local account points to Joy's Entry, and the main reference article names no tavern. The tavern building does not survive, so only its approximate setting is shown — no façade is reconstructed.",
      eventIds: ["rev-founding-1791"],
      actions: [{ type: "set-year", year: 1791.79 }, { type: "select-event", eventId: "rev-founding-1791" }],
      open: false,
    };
  }

  // United Irishmen meeting places.
  if (/united irish/.test(q) && /(meet|met|meeting|tavern|where)/.test(q)) {
    return {
      intent: "united-irish-meetings",
      text: `Places associated with United Irish meetings in and around Belfast, with the strength of evidence for each:\n${cite(index, MEETING_EVENTS)}\nOnly the founding itself and the Cave Hill oath are documented events; the taverns are known from later recollections and local accounts.`,
      eventIds: MEETING_EVENTS,
      actions: [{ type: "fit-events", eventIds: MEETING_EVENTS, year: 1795 }],
      open: false,
    };
  }

  // Blitz.
  if (/blitz|air raid|1941/.test(q)) {
    const ids = index.events.filter((e) => e.event_category === "blitz").map((e) => e.event_id);
    return {
      intent: "blitz",
      text: `Four German raids hit Belfast in April and May 1941; about 1,000 people were killed, most of them in the Easter Tuesday raid. Mapped sites:\n${cite(index, ids)}\nSome sites are placed approximately — their uncertainty discs are shown.`,
      eventIds: ids,
      actions: [{ type: "fit-events", eventIds: ids.filter((id) => byId(index, id)?.longitude !== null), year: 1941.3 }],
      open: false,
    };
  }

  // Docks and harbour change.
  if (/\b(dock|harbour|harbor|quay|channel|shipyard)/.test(q) && /(chang|grow|develop|\bhow\b)/.test(q) && !/before (the )?shipyard/.test(q)) {
    return {
      intent: "docks",
      text: `How the port changed:\n${cite(index, DOCK_EVENTS)}\nThe shoreline and reclamation outlines in the scene are schematic; the dates are sourced. The 'City of Shipbuilders' tour walks through this sequence.`,
      eventIds: DOCK_EVENTS,
      actions: [{ type: "start-tour", tourId: "tour-shipbuilders" }],
      open: false,
    };
  }

  // Before the shipyards.
  if (/before (the )?shipyard/.test(q)) {
    return {
      intent: "before-shipyards",
      text: "Showing Belfast in 1840, before the channel was cut. Robert Hickson opened the first Queen's Island shipyard in 1853 on land made from the dredging spoil of 1841–46; Harland & Wolff followed in 1861.",
      eventIds: ["ind-victoria-channel", "metro-hickson-1853", "metro-hw-1861"],
      actions: [{ type: "set-year", year: 1840 }],
      open: false,
    };
  }

  // Person lookup, e.g. Mary Ann McCracken.
  const personMatch =
    /associated with\s+(.+)$/.exec(q) ?? /(?:about|for|of)\s+(.+)$/.exec(q) ?? /show\s+(.+)$/.exec(q);
  const personName = (personMatch?.[1] ?? q).replace(/^(all\s+)?(the\s+)?(locations|places|sites)\s+/, "").replace(/[?.!]+$/, "");
  const personEvents = tokenize(personName).length >= 2 ? eventsForPerson(index, personName) : [];
  if (personEvents.length > 0 && /(mary ann|mccracken|tone|russell|neilson|mccabe|munro|orr|drennan|harland|lanyon|[a-z]+ [a-z]+)/.test(personName)) {
    const ids = personEvents.map((e) => e.event_id);
    const mapped = personEvents.filter((e) => e.longitude !== null).map((e) => e.event_id);
    return {
      intent: "person",
      text: `${personEvents.length} event${personEvents.length === 1 ? "" : "s"} mention ${personName.replace(/\b\w/g, (c) => c.toUpperCase())}:\n${cite(index, ids)}`,
      eventIds: ids,
      actions: mapped.length ? [{ type: "fit-events", eventIds: mapped }] : [],
      open: false,
    };
  }

  // Show Belfast in a given year.
  if (years.length >= 1 && /(show|go|take|belfast|see|year|in)/.test(q)) {
    const year = years[0] as number;
    return {
      intent: "set-year",
      text: `Showing Belfast in ${year}. Streets, shorelines and documented landmarks are drawn for that date; the surrounding massing is an illustrative model.`,
      eventIds: [],
      actions: [{ type: "set-year", year: year === 1798 ? 1798.45 : year }],
      open: false,
    };
  }

  // Fallback: keyword retrieval.
  const hits = search(index, question, 6).filter((r) => r.kind === "event");
  if (hits.length > 0) {
    const ids = hits.map((h) => h.id);
    return {
      intent: "retrieval",
      text: `These records match your question:\n${cite(index, ids)}`,
      eventIds: ids,
      actions: [{ type: "select-event", eventId: ids[0] as string }],
      open: true,
    };
  }
  return {
    intent: "none",
    text: "I couldn't find that in the sourced records. Try a year (\"Show Belfast in 1850\"), a person (\"Mary Ann McCracken\") or a place (\"Crown Entry\").",
    eventIds: [],
    actions: [],
    open: true,
  };
}

/** Example questions shown in the panel. */
export const EXAMPLE_QUESTIONS: readonly string[] = [
  "Show Belfast in 1798",
  "Where did the United Irishmen meet?",
  "Show the Crown Tavern",
  "Take me to where Henry Joy McCracken was executed",
  "What is the connection between the Morning Star and 1798?",
  "Show Belfast before the shipyards",
  "Compare 1850 with 1900",
  "How did Belfast's docks change?",
  "Show all locations associated with Mary Ann McCracken",
  "Fly to the Belfast Blitz sites",
];
