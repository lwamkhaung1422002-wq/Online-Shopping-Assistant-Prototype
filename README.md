# Belle Online Shop

Public dashboard connected to the Belle POS API and local PostgreSQL. Content Admin is inside the sibling POS application. The earlier direct Firebase architecture is historical; original Firebase records remain read-only migration sources.

## Run locally

Run `npm run dev` here to launch `dashboard/`. Configure its ignored local environment with the reviewed local API and shop identity. The current review uses Dashboard5186, POS5185 and API4101; revalidate listeners before starting another instance. Historical Firebase launch/seed scripts are not the current setup.

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

Original Firebase data is preserved in private verified backups outside Git. The local PostgreSQL review and final local cutover are separate stages. Original catalogue pictures and size guides are retained. Phone tracking, Dashboard typography, new-media upload and browser acceptance are covered by the current POS goal; final cutover remains incomplete. No hosting deployment is authorized.

Read [scope](docs/GOAL.md), [progress](docs/PROGRESS.md), [workflow checklist](docs/WORKFLOW-CHECKLIST.md) and [completion audit](docs/LOCAL-COMPLETION-AUDIT.md). Production deployment is deferred.

## Checks

Use `npm run build`, `npm run lint` and the relevant affected tests. Reuse completed evidence; do not run artificial orders/payments against Main.
