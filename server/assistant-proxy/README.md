# Optional assistant proxy

Belfast Rising answers its example questions deterministically in the browser, from the sourced records. This optional proxy adds a short generated summary for open-ended questions. It is **off** unless you deploy it and set `VITE_ASSISTANT_ENDPOINT`.

## How it stays honest

- The browser never holds an API key. The key lives only in the worker's secret store.
- The app sends the question plus the records its own retrieval selected — titles, dates, evidence levels, descriptions and source links. The model sees nothing else.
- The system prompt requires answers drawn only from those records, with `[event_id]` citations, traditions marked as traditions, disputes flagged, neutral language for sensitive subjects, and a plain "the records don't answer this" when that is the case.
- The app shows the reply beneath the deterministic answer, headed "Generated summary — verify against the sources".
- Requests are accepted only from `ALLOWED_ORIGIN`, and the payload is validated and size-limited.

## Deploy (Cloudflare Workers)

```bash
cd server/assistant-proxy
# edit ALLOWED_ORIGIN in wrangler.toml to your site, e.g. https://jane.github.io
npx wrangler@latest login
npx wrangler@latest secret put ANTHROPIC_API_KEY
npx wrangler@latest deploy
```

Then set the repository variable `VITE_ASSISTANT_ENDPOINT` to the worker URL (Settings → Secrets and variables → Actions → Variables) and re-run the Pages workflow.

Add rate limiting in front of the worker (Cloudflare's Rate Limiting rules, for example) before publicising the site, since each question costs a model call.

`handle(request, env)` uses only the Fetch API, so the same file runs on Deno, Bun or Node 20+ behind a small adapter if you prefer another host.

> Not executed in the build environment: this folder was written and type-checked as code, but no worker was deployed and no model was called.
