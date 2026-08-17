# pprcts

A React and Express application for discovering research across disciplines, producing evidence-grounded AI summaries and audio, saving works, and creating personalized research briefings. OpenAlex provides the scholarly catalog and full-text resolution; Supabase provides authentication, PostgreSQL data, and private audio storage.

## Local development

Requirements: Node.js 20 or newer and access to the `papercuts-v2` Supabase project.

1. Install both dependency sets:

   ```sh
   npm install
   npm --prefix server install
   ```

2. Copy `.env.example` to `.env` and `server/.env.example` to `server/.env`.
3. Fill in the Supabase publishable key in both files. Put the Supabase secret key only in `server/.env`.
4. Generate the server encryption key:

   ```sh
   openssl rand -base64 32
   ```

   Store the result as `APP_ENCRYPTION_KEY` in `server/.env`. Do not rotate this key without first re-encrypting users' stored OpenAI and OpenAlex keys.

5. Generate an independent salt for hashing rate-limit identities:

   ```sh
   openssl rand -hex 32
   ```

   Store the result as `RATE_LIMIT_HASH_SALT` in `server/.env`. Do not reuse the encryption key.

6. Start the API and frontend in separate terminals:

   ```sh
   npm --prefix server start
   npm run dev
   ```

The frontend runs at `http://localhost:5173` and expects the API at `http://localhost:5001` by default.

## Grounded summaries

Search, recommendations, and research-briefing discovery use OpenAlex Works across journal articles, conference papers, books, dissertations, and trusted preprint repositories. Before generating a summary, the API resolves the work by its OpenAlex ID and checks for parsed full text. Clearly reusable full text is processed transiently; when it is unavailable or its license is unclear, the system falls back to the indexed abstract and visibly labels the result `Abstract only`.

The model first creates a structured evidence map with exact supporting quotations. The server verifies those quotations against the retrieved source before a second model call writes the briefing. Summary length scales with the verified evidence available, so an abstract is never stretched into a 20-minute script. Raw article text and evidence quotations are not stored—only the generated summary, a fingerprint, and source provenance.

Users can save their own OpenAlex key in Settings; it is encrypted server-side and used for their searches, recommendations, full-text retrieval, and briefings. `OPENALEX_API_KEY` in `server/.env` is an optional application-wide fallback. `OPENALEX_ALLOW_UNLICENSED_FULLTEXT` defaults to `false`; enable it only after confirming that your content-rights policy permits that processing.

## Security model

- The browser receives only the Supabase publishable key.
- The Supabase secret key and application encryption key are server-only values and must never use a `VITE_` prefix.
- User OpenAI and OpenAlex keys are encrypted with AES-256-GCM and are never returned to the browser after saving.
- API requests that access user data validate the Supabase bearer token.
- AI endpoints are rate-limited and validate request sizes.
- Supabase row-level security restricts user-owned rows, and audio buckets are private.

Production must set an explicit comma-separated HTTPS `ALLOWED_ORIGINS` value and an independent `RATE_LIMIT_HASH_SALT` of at least 32 characters. The API refuses to start in production without the server secret, a valid encryption key, the rate-limit salt, and the HTTPS origin allowlist. `ENABLE_SCHEDULER=true` starts the in-process research briefing scheduler. It evaluates each user's daily or weekly cadence, weekday, local time, and IANA time zone once per minute. Keep it disabled when another platform owns scheduling or when running multiple API instances.

## Database changes

Database changes are recorded in `supabase/migrations/`. Apply migrations through the Supabase CLI or your normal deployment pipeline; do not paste server secrets into migration files.

## Verification

```sh
npm run lint
npm run build
npm --prefix server test
npm audit --omit=dev
npm --prefix server audit --omit=dev
```

## Project structure

- `src/` — Vite, React, and TypeScript frontend
- `server/` — authenticated Express API and briefing scheduler
- `supabase/migrations/` — database security and schema migrations

## License

[MIT](LICENSE)
