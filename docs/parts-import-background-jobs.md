# Future: Background processing for parts-report uploads

## Problem

`importPartsReport` (`src/controllers/Parts/partsUpload.controller.ts`) parses
the uploaded XLSX/CSV/PDF and inserts every row into MongoDB **synchronously,
within the same HTTP request**. For large files the client blocks until every
row is deduped and written. We want the upload to return immediately while
rows are processed in the background, with the UI able to poll for progress
and show a "processing → completed" state.

## Options considered

1. **In-process background job (recommended starting point)**
   - Keep the uploaded buffer, respond `202` immediately with a `jobId`.
   - Continue row-processing in the same Node process after the response is
     sent.
   - Track progress in a new `PartsImportJob` collection (status, totalRows,
     processedRows, successCount, failureCount, errors, batchId).
   - Frontend polls `GET /api/parts/import/:jobId/status`.
   - No new infra/dependencies.
   - **Caveat**: Cloud Run throttles CPU after the response is sent unless
     the service has "CPU always allocated" enabled — need to verify/enable
     that setting for `server3`, otherwise background work can stall.

2. **GCP Cloud Tasks queue**
   - Upload endpoint enqueues a Cloud Task that calls an internal
     `/api/parts/import/process` endpoint.
   - Each unit of work is its own request, unaffected by Cloud Run CPU
     throttling; retries/durability come for free.
   - Adds `@google-cloud/tasks`, a queue, and IAM/service-account setup in
     GCP.

3. **BullMQ + Redis**
   - Standard Node job-queue library, full retry/concurrency/scheduling
     control.
   - Requires provisioning Redis (GCP Memorystore or Upstash) — a new paid
     dependency and the heaviest infra lift of the three.

## Decision

Not implemented yet. Revisit when upload volume/file size makes the
synchronous flow a real problem. Option 1 is the lowest-effort starting
point if/when we pick this up; options 2/3 are the more robust fallbacks if
Cloud Run CPU allocation turns out to be a blocker.
