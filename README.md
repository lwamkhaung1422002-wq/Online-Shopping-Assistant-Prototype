# Belle Online Shop

Public dashboard connected to the Belle POS API and local PostgreSQL. Content Admin is inside the sibling POS application. The earlier direct Firebase architecture is historical; original Firebase records remain read-only migration sources.

## Run locally

Run `npm run dev` here to launch `dashboard/`. Configure its ignored local environment with the local API and shop identity. The final local setup uses Dashboard5186, POS5173 and API3108, connected to PostgreSQL `belle_local_main`. Historical Firebase launch/seed scripts and the old disposable4101/5185runtime are not the current setup.

The command prints its Local URL and opens Chrome automatically. If this application's frontend is already running, it reuses it and opens its URL rather than launching a conflicting duplicate. An unrelated service occupying the same port is reported without stopping it. Frontend startup remains available even when the API is temporarily unavailable.

`npm run dev:demo` explicitly selects the isolated demo. See [demo setup](docs/reports/POS-PREVIEW.md). Main scripts require explicit action flags; they are not routine setup or test commands.

## Repository layout

- `dashboard/src/`: public pages, components, assets and presentation configuration.
- `dashboard/shared/`: client/domain contracts.
- `scripts/`: local launch, diagnostics and bounded import tools.
- `tests/`: domain/API/contract and browser verification.
- `docs/reports/`: feature and incident reports.
- `docs/evidence/`: structured results, reviews and provenance.
- `docs/screenshots/`: reviewed visuals.
- `docs/snapshots/`: historical drafts/reference material.
- `.local/`: ignored local media, service logs and generated artifacts.

Toolchain configs and package lockfiles remain at their expected root. [Structure conventions](docs/STRUCTURE.md) describe both projects and module ownership.

## Current state and data

Original Firebase data is preserved in private verified backups outside Git. Final local PostgreSQL cutover,85table backup/restore verification and normal local API/auth/catalogue reads have passed. Original24catalogue pictures and4size guides are retained. Actual disposable browser acceptance covered private phone tracking, typography/200%zoom, order/customer workflows and Cloudinary upload/unlink. A fresh post-cutover browser smoke was unavailable at the tool layer; it is not claimed as a new browser pass. No hosting deployment is authorized.

Read the [current local checkpoint](docs/LOCAL-POSTGRES-CHECKPOINT-2026-10-17.md) and the final local reports in the sibling Belle POS repository. Production deployment is deferred. The newly requested social-media-style post composer, per-post size guides and full image viewer are discussion only and have not been implemented yet.

## Checks

Use `npm run build`, `npm run lint` and the relevant affected tests. Reuse completed evidence; do not run artificial orders/payments against Main.
