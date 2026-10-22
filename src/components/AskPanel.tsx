import { useMemo, useRef, useState, type FormEvent } from "react";
import { useDispatch, useAppState, type Action } from "../state/store";
import type { AppData } from "../data/loaders";
import { ask, EXAMPLE_QUESTIONS, type AskAction, type AskAnswer } from "../engine/ask";
import { buildSearchIndex } from "../engine/search";
import { CONFIG } from "../config";
import { Icon } from "./Icon";

interface Message {
  role: "user" | "bot";
  text: string;
  eventIds?: string[];
  generated?: boolean;
}

function applyActions(actions: AskAction[], data: AppData, dispatch: (a: Action) => void): void {
  for (const action of actions) {
    switch (action.type) {
      case "set-year":
        dispatch({ type: "set-year", year: action.year });
        dispatch({ type: "camera-request", request: { kind: "era", year: action.year } });
        break;
      case "compare":
        dispatch({ type: "set-year", year: action.year });
        dispatch({ type: "compare", year: action.compareYear });
        break;
      case "select-event": {
        const event = data.eventsById.get(action.eventId);
        if (!event) break;
        dispatch({ type: "select-event", id: event.event_id });
        if (event.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: event.event_id, approach: action.approach } });
        break;
      }
      case "fit-events": {
        if (action.year !== undefined) dispatch({ type: "set-year", year: action.year });
        const points = action.eventIds
          .map((id) => data.eventsById.get(id))
          .filter((e) => e && e.longitude !== null && e.latitude !== null)
          .map((e) => [e?.longitude as number, e?.latitude as number] as [number, number]);
        if (points.length) dispatch({ type: "camera-request", request: { kind: "fit", points } });
        break;
      }
      case "start-tour":
        dispatch({ type: "tour", tour: { id: action.tourId, step: -1 } });
        break;
      case "fly-place": {
        const place = data.placesById.get(action.placeId);
        if (place) dispatch({ type: "camera-request", request: { kind: "look", target: [place.lon, place.lat], heading: 20, tilt: 68, range: 300 } });
        break;
      }
    }
  }
}

/** Ask the optional backend, sending only the retrieved, sourced records. */
async function askBackend(question: string, answer: AskAnswer, data: AppData): Promise<string | null> {
  if (!CONFIG.assistantEndpoint || answer.eventIds.length === 0) return null;
  const records = answer.eventIds
    .map((id) => data.eventsById.get(id))
    .filter((e) => e !== undefined)
    .map((e) => ({
      event_id: e.event_id,
      title: e.title,
      date: e.start_date,
      confidence: e.historical_confidence,
      status: e.interpretation_status,
      description: e.description,
      sources: e.source_ids.map((id) => ({ name: data.sources.get(id)?.name, url: data.sources.get(id)?.url })),
    }));
  const response = await fetch(CONFIG.assistantEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, records }),
  });
  if (!response.ok) throw new Error(`Assistant backend returned ${response.status}`);
  const body = (await response.json()) as { answer?: string };
  return body.answer ?? null;
}

export function AskPanel({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const index = useMemo(() => buildSearchIndex(data.events, data.places), [data]);
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", text: "Ask about places, people or years. Answers come from the sourced records in this app, and each one carries its evidence level — traditions are always marked as such." },
  ]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setQuestion("");
    const answer = ask(index, q);
    setMessages((m) => [...m, { role: "user", text: q }, { role: "bot", text: answer.text, eventIds: answer.eventIds }]);
    applyActions(answer.actions, data, dispatch);
    if (answer.open && CONFIG.assistantEndpoint) {
      setBusy(true);
      try {
        const generated = await askBackend(q, answer, data);
        if (generated) setMessages((m) => [...m, { role: "bot", text: generated, generated: true, eventIds: answer.eventIds }]);
      } catch (error) {
        console.warn(error);
        setMessages((m) => [...m, { role: "bot", text: "The optional assistant service is unavailable; the records above are the deterministic answer." }]);
      } finally {
        setBusy(false);
      }
    }
    window.setTimeout(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }), 30);
  };

  if (!state.askOpen) return null;
  return (
    <section className="ask glass" aria-label="Ask Belfast Rising">
      <div className="panel-head">
        <span className="kicker">Ask Belfast Rising</span>
        <button className="btn ghost icon-btn small" onClick={() => dispatch({ type: "panel", panel: "ask", open: false })} aria-label="Close assistant">
          <Icon name="close" />
        </button>
      </div>
      <div className="ask-log" ref={log} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.generated ? <span className="kicker" style={{ display: "block", marginBottom: 4 }}>Generated summary — verify against the sources</span> : null}
            {m.text}
            {m.eventIds && m.eventIds.length ? (
              <div className="chips" style={{ marginTop: 8 }}>
                {m.eventIds.slice(0, 8).map((id) => {
                  const e = data.eventsById.get(id);
                  if (!e) return null;
                  return (
                    <button key={id} className="chip" onClick={() => applyActions([{ type: "set-year", year: e.start_year + 0.002 }, { type: "select-event", eventId: id }], data, dispatch)}>
                      <span className={`glyph ${e.historical_confidence}`} style={{ marginTop: 0, marginRight: 6, verticalAlign: "middle" }} />
                      {e.title}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
        {messages.length < 3 ? (
          <div className="chips">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button key={q} className="chip" onClick={() => void submit(q)}>{q}</button>
            ))}
          </div>
        ) : null}
      </div>
      <form
        className="ask-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Where did the United Irishmen meet?" aria-label="Your question" />
        <button className="btn primary icon-btn" type="submit" disabled={busy} aria-label="Ask">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}
