# Flownote Documents Preview (PDF/Image) — Plan (Revised)

**Summary**
- Store original files in Supabase Storage, cache them locally in Electron with explicit invalidation, and expose a local-file URL for previews.
- Add pdfjs thumbnails and image previews while preserving Flownote’s minimal dark card style.

**Implementation Changes**
1. **Document storage + metadata**
   - Extend `documents` table to include:
     - `file_path` (text, nullable)
     - `file_type` (text, nullable)
     - `size_bytes` (bigint/int, nullable)
     - `file_etag` (text, nullable) or `file_updated_at` (timestamptz, nullable)
   - Update `electron/services/rag.storeDocument` to accept and store these fields.
   - Update `ipc/documents.ts` upload flow:
     - Upload to Supabase Storage at a unique path (e.g. `${userId}/${collectionId}/${timestamp}-${fileName}`).
     - Capture ETag (or last modified) from storage response.
     - Extract text + embed as today.
     - Insert document row with `file_path`, `file_type`, `size_bytes`, and `file_etag` (or `file_updated_at`).

2. **Local cache + invalidation**
   - Add `electron/services/documentCache.ts`:
     - Cache root: `app.getPath('userData')/document-cache/`.
     - Cache key: derived from storage `file_path`.
     - Store a small sidecar JSON per cached file with `file_etag` (or `file_updated_at`).
     - `ensureCached(file_path, etag)`:
       - If cache missing or etag mismatch → download and update sidecar.
       - If match → use cached file.
   - Add IPC handler `doc:get-file-url` that takes `file_path` + `file_etag` (from renderer doc) and returns `flownote-file://...`.
     - No DB lookup in IPC; renderer passes `file_path` (cleaner and avoids extra query).

3. **Custom protocol setup**
   - In `electron/main.ts`, call `protocol.registerSchemesAsPrivileged` **before** `app.whenReady()`:
     - Mark `flownote-file` as `secure`, `standard`, `supportFetchAPI`, `corsEnabled`.
   - Register the protocol handler to serve only from the cache directory (path traversal-safe).

4. **Renderer preview UI**
   - Add `pdfjs-dist` dependency.
   - Copy worker explicitly: place `pdf.worker.min.mjs` in `flownote/public/`.
   - In `PDFThumbnail.tsx`, set:
     - `pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`.
   - Create `src/components/documents/PDFThumbnail.tsx` adapted from task app, but with dark-themed loading/error visuals.
   - Update `DocumentsPage.tsx`:
     - On document load, fetch `previewUrl` via `getDocumentFileUrl(file_path, file_etag)` when `file_path` exists.
     - Render:
       - PDF: `<PDFThumbnail url={previewUrl} />`
       - Image: `<img src={previewUrl} />`
       - Other: existing icon preview
     - Keep card layout + typography consistent with Flownote design (subtle, low-contrast, minimal).

**Public API / IPC Changes**
- Update `uploadDocument` signature to include `fileType` and `sizeBytes`.
- Replace `getDocumentFileUrl(docId)` with:
  - `getDocumentFileUrl(file_path, file_etag?)`

**Test Plan**
1. Upload a PDF → first-page thumbnail appears.
2. Upload a PNG/JPG → image preview appears.
3. Upload a DOCX → fallback icon appears.
4. Replace an existing file (same `file_path` but new upload) → cache invalidation triggers and preview updates.
5. Rename a document (name only) → preview still works.
6. Restart app → cached previews load without re-downloading, unless etag changed.
7. Legacy documents without `file_path` still show icon preview.

**Assumptions**
- Supabase Storage bucket `documents` exists (or will be created) with auth policies for user-owned files.
- Cache invalidation uses `file_etag` (preferred) or `file_updated_at`; renderer supplies this to cache utility.
- Legacy docs without `file_path` remain icon-only.
