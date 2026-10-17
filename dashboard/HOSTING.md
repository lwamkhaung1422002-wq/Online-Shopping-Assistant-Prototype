# Current Dashboard hosting — 2026-10-17

The current `dashboard/` application uses **Cloudflare Workers Static Assets → Railway API → PostgreSQL**. Historical root/admin Netlify, Supabase and direct-Firebase instructions are not the deployment path for this application.

- Git repository: `lwamkhaung1422002-wq/Online-Shopping-Assistant-Prototype`; service/build root: `dashboard`.
- Node 24; `npm ci`; explicitly set `VITE_SHOP_ID` to the imported POS shop ID; `npm run build:hosting` (same-origin `/api`).
- Configure the real API HTTPS origin in `wrangler.jsonc`, final domain/routes and Worker `API_PROXY_SECRET` secret. The API must allow the Dashboard origin in `CORS_ORIGIN`.
- `npm run test:hosting` checks gateway security/media portability. `npm run cloudflare:check` packages locally without deploying.
- `cloudflare:deploy` rebuilds with hosting variables and then deploys. Staging has a separate named Worker; configure isolated API/database and secrets.
- Never commit `.env`, `.dev.vars`, private backups or gateway/provider secrets. `VITE_` values are public.
- Imported original-media photos/guide images resolve on this domain; remote Cloudinary URLs retain their quality. No database rewrite is required.
- POS Admin's `VITE_PUBLIC_DASHBOARD_URL` must match this Dashboard domain at POS build time.

Preparation checks passed locally. Real domains/secrets, Railway database transfer, Linux image acceptance, staging acceptance and public abuse controls remain release work. Local packaging is not hosted acceptance. Consult the companion POS repository `docs/HOSTING-READINESS.md` for the full release sequence.
