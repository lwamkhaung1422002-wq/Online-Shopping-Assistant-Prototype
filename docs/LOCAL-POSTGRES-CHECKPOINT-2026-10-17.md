# Local PostgreSQL checkpoint — 2026-10-17

Dashboard now connects to the same local PostgreSQL-backed POS API through its
normal `/api` Vite proxy. Normal `npm run dev` in `dashboard/` uses port5186.
The ignored local environment selects shop `belle-online`; it contains no server
credentials. API3108 and POS5173 are started separately in the Belle repository.

This update includes Myanmar/international phone normalization before order-form
validation, fresh private-tracking reads with30second refresh, the ordinary local
API proxy configuration and the form regression test. Earlier actual disposable
browser acceptance covered submit/accept/reject, private-token phone tracking,
Cloudinary media attachment/unlink and real200%zoom. Final normal proxy/catalogue
reads verified4posts,24images and4guides from `belle_local_main`.

No database dump, environment file, original Firebase data, credentials or
historical snapshot directories are included in this checkpoint. No deployment
or hosting change is performed by this update.

The user's subsequent social-media-style Admin composer request is DISCUSSION
ONLY at this checkpoint: simpler title/description/multiple-photo upload,
post-specific editable size guides, visual sorting and a full image viewer.
Those new UX changes have not been implemented. Existing stored originals and
the currently configured incoming upload transformations need separate review
before changing the media workflow.
