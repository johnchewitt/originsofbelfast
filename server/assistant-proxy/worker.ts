/**
 * Belfast Rising — optional "Ask" assistant proxy (Cloudflare Worker).
 *
 * The static site never holds an LLM key. When VITE_ASSISTANT_ENDPOINT is set,
 * the app POSTs { question, records } here, where `records` are the sourced
 * event records its own deterministic retrieval selected. This worker:
 *
 *   - accepts requests only from ALLOWED_ORIGIN (CORS + Origin check),
 *   - validates and size-limits the payload,
 *   - asks the model to answer ONLY from those records, cite event ids,
 *     keep evidence levels and traditions explicit, and say when the
 *     records do not answer the question,
 *   - returns { answer } — the app labels it "Generated summary — verify
 *     against the sources" beneath the deterministic answer.
 *
 * Secrets / vars (wrangler):
 *   ANTHROPIC_API_KEY   secret — `wrangler secret put ANTHROPIC_API_KEY`
 *   ALLOWED_ORIGIN      e.g. https://<user>.github.io
 *   MODEL               optional, default below
 *
 * Runs on any runtime with the Fetch API (Workers, Deno, Bun, Node 20+ via an
 * adapter) — `handle(request, env)` is the whole contract.
 */

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
  MODEL?: string;
}

interface RecordIn {
  event_id: string;
  title: string;
  date: string;
  confidence: string;
  status: string;
  description: string;
  sources: { name?: string; url?: string | null }[];
}

const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_QUESTION_CHARS = 500;
const MAX_RECORDS = 12;
const MAX_FIELD_CHARS = 2000;
const MAX_ANSWER_TOKENS = 600;

const SYSTEM_PROMPT = `You answer questions about the history of Belfast for the "Belfast Rising" app.

Rules:
- Use ONLY the event records supplied in the user message. Do not add facts, dates, names, numbers, quotations or sources that are not in them, even if you believe them to be true.
- Cite the event_id in square brackets after each claim, e.g. [rev-execution-1798].
- Keep each record's evidence level visible. Records with confidence "tradition" or status "tradition-unverified" are reported traditions: say so plainly and never present them as established fact. Where status is "disputed" or "competing-dates", say that accounts differ.
- If the records do not answer the question, say so in one sentence and suggest what the user could search for instead. Do not speculate.
- For politically sensitive subjects (the 1798 rebellion, sectarian violence, the Troubles), use neutral, explanatory language and attribute judgements to the sources.
- Be concise: at most about 150 words, plain prose, no headings.`;

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders(env) } });
}

const clip = (value: unknown, max = MAX_FIELD_CHARS): string => String(value ?? "").slice(0, max);

/** Validate and normalise the request body; returns null when it is unusable. */
function parseBody(raw: unknown): { question: string; records: RecordIn[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const { question, records } = raw as { question?: unknown; records?: unknown };
  if (typeof question !== "string" || question.trim().length === 0) return null;
  if (!Array.isArray(records) || records.length === 0) return null;
  return {
    question: clip(question.trim(), MAX_QUESTION_CHARS),
    records: records.slice(0, MAX_RECORDS).map((r) => {
      const rec = (r ?? {}) as Record<string, unknown>;
      return {
        event_id: clip(rec.event_id, 80),
        title: clip(rec.title, 200),
        date: clip(rec.date, 40),
        confidence: clip(rec.confidence, 20),
        status: clip(rec.status, 30),
        description: clip(rec.description),
        sources: Array.isArray(rec.sources)
          ? rec.sources.slice(0, 6).map((s) => ({ name: clip((s as Record<string, unknown>)?.name, 200), url: clip((s as Record<string, unknown>)?.url, 400) }))
          : [],
      };
    }),
  };
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY || !env.ALLOWED_ORIGIN) return json({ error: "Proxy is not configured." }, 500, env);
  const origin = request.headers.get("Origin");
  if (origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405, env);

  let parsed: ReturnType<typeof parseBody>;
  try {
    parsed = parseBody(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return json({ error: "Expected { question, records[] }." }, 400, env);

  const userContent = `Question: ${parsed.question}\n\nEvent records (JSON):\n${JSON.stringify(parsed.records, null, 1)}`;
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!upstream.ok) {
    console.error("Upstream error", upstream.status, await upstream.text());
    return json({ error: "The assistant service is unavailable." }, 502, env);
  }
  const body = (await upstream.json()) as { content?: { type: string; text?: string }[] };
  const answer = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
  return json({ answer: answer || null }, 200, env);
}

export default { fetch: handle };
