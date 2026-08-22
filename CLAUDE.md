# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # ts-node-dev, respawn + transpile-only (primary dev loop)
npm run build            # tsc -> dist/
npm start                # node dist/server.js
npm run rag:create-index # one-off: create the Atlas Vector Search index (idempotent)
```

There is no test runner and no linter configured. `npx tsc --noEmit` is the only
automated check available — run it after edits. The `test-*.js` files at the repo
root are ad-hoc reCAPTCHA/Firebase scratch scripts (`node test-recaptcha.js`), not
a test suite.

The env file in the working tree is `src/.env`, but every `dotenv.config()` call
is bare, so dotenv resolves `.env` against the process CWD — a root `.env` (copy
or symlink) is what actually gets loaded when running from the repo root.
`src/config/validateEnv.ts` runs at boot: a missing `ANTHROPIC_API_KEY` only warns
(AI features degrade), but a placeholder ScanFleet credential is a fatal startup
error.

## Architecture

Express 5 + TypeScript + Mongoose (MongoDB Atlas) backend for a Honda dealership
(Golaghat). CommonJS, strict TS, `rootDir: src`. Everything is a single process:
`src/server.ts` mounts ~30 route modules under `/api/*`, then `routeNotFound` and
`errorHandler`.

Layering is `routes/ -> controllers/ -> service/ -> models/`. Directories are
grouped by feature area (`Parts/`, `ServiceJobcard/`, `SalesReport/`,
`CounterSale/`, `VASnStock/`, `CustomerSystem/`, `Rag/`, ...), and that grouping
is mirrored across all four layers — a new feature usually adds one file in each.
Controllers use `express-async-handler` and throw `ErrorResponse(message, status)`
(`src/utils/errorResponse.ts`); the central `errorMiddleware` converts that to the
`{ success, message, stack }` envelope.

### Two independent auth systems

1. **Staff/admin (JWT)** — `middleware/authmiddleware.ts`. Six *separate*
   Mongoose collections back six roles: `Admin` (Super-Admin), `BranchManager`
   (Branch-Admin), `ServiceAdmin`, `PartAdmin`, `Developer`, `Staff`. `protect`
   resolves the JWT subject by trying each collection in that fixed precedence
   order and stamping a non-writable `role` onto the doc. `authorize(...roles)`
   gates by role. Access token is a short-lived Bearer token; the refresh token is
   an httpOnly cookie scoped to `/api/auth` (`config/authCookie.ts`), stored
   hashed per-device on the user doc via `RefreshTokenSessionSchema`.
   `utils/roleModels.ts` holds the canonical role→model list; use it (and
   `findAccountByPhone`) rather than re-listing the six models.
2. **Customers (Firebase)** — `middleware/customerMiddleware.ts` verifies a
   Firebase ID token (phone OTP) against `BaseCustomer.firebaseUid` and populates
   `req.customer`. Separate from `req.user`; the two never mix.

### Branch scoping — the core invariant

Almost every entity is scoped to a `Branch`. The rule, repeated at every read
site: **Super-Admin (and Developer) are project-wide and may pass `?branchId=` or
get `"all"`; every other role is forced to its own branch regardless of what it
requests.** Derive scope only through `types/user.types.ts` helpers
(`getUserBranch`, `isAdmin`, `canAccessBranch`, `extractBranchId`) — see
`branchFilter()` in `controllers/Parts/partsStats.controller.ts` and
`service/rag/scope.ts` for the two canonical implementations. Never apply scope as
a post-query filter.

`types/user.types.ts` also globally augments `Express.Request` with `user`, and
`customerMiddleware.ts` augments it with `customer`.

### Spreadsheet import pipeline (Parts, ServiceJobcard, SalesReport, CounterSale)

The dealership uploads XLSX/CSV/PDF exports. `service/dataImport.service.ts` is the
shared parser (format detection, encoding/delimiter sniffing, header-row
detection, `parsePdfTable`, `computeRowHash`). Each domain then owns its own
column matcher (`utils/partsColumnMatcher.ts`,
`utils/serviceJobcardColumnMatcher.ts`, `utils/salesReportColumnMatcher.ts`) that
maps real-world header aliases onto canonical fields — deliberately *not* shared
with the generic DataImport registry.

Each domain follows the same **snapshot-diff** shape, which is important to
preserve:

- A `*Batch` document per upload (counts, revenue before/after, rendered
  `changesMarkdown`), plus one row document per record referencing `batchId`.
- Rows carry both `isActive` (batch-level soft delete) and `isCurrent` (row is
  the live value for its join key). An upload diffs against the current snapshot
  keyed by a business key (Part Number / Job Card Number); only added/changed rows
  are inserted, superseded rows flip `isCurrent: false` and are **never deleted**,
  so history stays intact. A partial unique index on
  `(branchId, normalized.<key>, isCurrent)` enforces one current row per key.
- Stats aggregations distinguish "current state" (`isCurrent: true`) from
  "activity volume" (all rows) — read the comments in `partsStats.controller.ts`
  before changing a pipeline.

`models/DataImport/datasetRegistry.ts` is a *separate*, generic multi-dataset
module (`vehicle-stock`, `service-timetrack`, `invoice`) under `/api/data-import`.
Parts and ServiceJobcard used to live there and were extracted; don't re-merge them.

Uploads are synchronous within the request. `docs/parts-import-background-jobs.md`
records the (unimplemented) plan for backgrounding them.

### RAG layer (`src/service/rag/`, `/api/rag`)

A shared retrieval assistant over dealership data, plugin-style:

- `sourceRegistry.ts` — every retrievable domain registers a `RetrievableSource`
  (`toChunk`, `listForIndex`, and a `scope` with `branchField`/`allowedRoles`).
  **Adding a source = one new `sources/*.source.ts` calling `registerSource()` +
  one side-effect import at the bottom of `sourceRegistry.ts`.** Nothing in
  `rag.service.ts`, `queryRouter.ts`, or the embedding pipeline changes, and those
  files must never import a Mongoose model directly.
- `queryRouter.ts` splits queries into a **structured** path (routes to existing
  aggregations via `statsAdapters.ts`, which call the same `compute*Stats`
  functions the dashboards use — RAG and dashboards must never disagree) and a
  **semantic** path (Atlas Vector Search over `EmbeddingChunk`).
- Scope is a *pre-filter*: each `EmbeddingChunk` stores `branchId` and
  `allowedRoles` so Atlas filters before the ANN search.
- Embeddings come from Voyage AI (`embedding.service.ts`), heavily throttled
  (`MIN_CALL_INTERVAL_MS`) because free-tier accounts are capped at 3 RPM.
  Narration uses Anthropic: Haiku for the structured path, Sonnet for semantic,
  overridable via `ANTHROPIC_RAG_STRUCTURED_MODEL` / `ANTHROPIC_RAG_SEMANTIC_MODEL`.
- `POST /api/rag/reindex` is Super-Admin only. The vector index itself is
  environment infrastructure, created by `npm run rag:create-index`, not at boot.

### Other cross-cutting pieces

- **Notifications** — `service/pushNotification.service.ts` is the single entry
  point (`notify()`): resolves recipients from the role collections (so history
  exists even without a registered device), writes durable `Notification` rows,
  then best-effort FCM via Firebase Admin. It never throws into the request path;
  call sites fire-and-forget with `.catch()`. Audience definitions live in
  `service/notificationTargeting.ts`.
- **File uploads** — multer memory storage, per-feature configs in
  `config/multerConfig.ts`, always paired with `handleMulterError` in the route.
  Images go to Cloudinary (`utils/cloudinaryHelper.ts`).
- **IDs** — `models/Counter.ts` (`nextSeq`) is the only atomic sequence generator;
  older id generation in `JobCardInvoice`/`StockConcept` uses racy
  `countDocuments()` scans. Prefer `nextSeq` for anything new.
- **Logging** — winston (`utils/logger.ts`) writes `error.log`/`combined.log` at
  the repo root, plus console outside production.
- **Third party** — ScanFleet (`lib/setting.scanfleet.ts`, throws at import time if
  its env vars are missing), Google Places, nodemailer SMTP
  (`utils/emailService.ts`), reCAPTCHA Enterprise (`middleware/recaptchaMiddleware.ts`).
- Rate limiting is applied only to `/api/auth`. `POST /api/auth/seed` is
  registered only when `NODE_ENV === "development"`.

Deployment notes (Hostinger VPS + Nginx + PM2, migrating off Cloud Run) are in
`host.md`.
