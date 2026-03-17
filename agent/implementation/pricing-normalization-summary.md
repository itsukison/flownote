# Pricing Normalization Summary (20% API Cost Budget)

## Context
The app currently uses these models (confirmed in code):
- OpenAI Realtime for question detection: `gpt-realtime-mini`
- Gemini for response generation: `gemini-2.5-flash-lite`
- OpenAI embeddings for RAG: `text-embedding-3-small`

Goal: create a single “normalized token” unit so usage across different models can be compared and capped with one monthly limit. Then set a monthly limit assuming API costs are capped at **20% of revenue**.

## Pricing Inputs (per 1M tokens)
Using the latest official pricing at the time of analysis:
- Gemini 2.5 Flash‑Lite input: **$0.10**
- Gemini 2.5 Flash‑Lite output: **$0.40**
- OpenAI gpt‑realtime‑mini input: **$0.60**
- OpenAI gpt‑realtime‑mini output: **$2.40**
- OpenAI text‑embedding‑3‑small input: **$0.02**

## Normalization Basis
Define **1 normalized token** as the cost of **Gemini 2.5 Flash‑Lite input**:
- Base cost = **$0.10 / 1,000,000 tokens**

Multipliers are calculated as:

```
multiplier = (model cost per 1M tokens) / 0.10
```

Resulting multipliers:
- Gemini Flash‑Lite input: **1.0x**
- Gemini Flash‑Lite output: **4.0x**
- Realtime mini input: **6.0x**
- Realtime mini output: **24.0x**
- Embeddings (3‑small) input: **0.2x**

Normalized usage formula:

```
normalized_tokens =
  gemini_input_tokens * 1.0 +
  gemini_output_tokens * 4.0 +
  realtime_input_tokens * 6.0 +
  realtime_output_tokens * 24.0 +
  embedding_input_tokens * 0.2
```

## Monthly Limit Calculation (20% API Cost Budget)
Assume:
- Monthly price ≈ **$10** (for ¥1,500 plan; use current FX for exact)
- API cost budget = **20%** of revenue = **$2.00**

Monthly normalized token limit:

```
limit = (cost_budget_usd / 0.10) * 1,000,000
      = (2.00 / 0.10) * 1,000,000
      = 20,000,000 normalized tokens
```

## Output to Show Customers
- Primary: “Monthly usage / limit” in **normalized tokens**
- Optional: also show “Today” as a secondary stat

## Notes
- Adjust the limit if you want a different gross margin.
- If you change models or prices, recompute the multipliers with the same formula.

  Implementation Summary

  Phase 1: Database Migration

  - supabase-org-migration.sql — Creates organizations, activation_codes, org_members, monthly_usage tables with RLS policies.
   Adds 4 RPC functions: increment_monthly_usage, get_user_monthly_usage, activate_code, and increment_typed_usage (bugfix).

  Phase 2: Token Normalization

  - electron/services/tokenNormalization.ts (new) — Normalization multipliers (Realtime input 6x, output 24x; Gemini input 1x,
   output 4x; Embedding 0.2x), normalizeTokens(), trackNormalizedUsage() calling the new RPC.
  - electron/audio/OpenAIRealtimeQuestionDetector.ts — onTokenUsage callback now passes (inputTokens, outputTokens) separately
   instead of a summed total.
  - electron/ipc/handlers.ts — Replaced trackTypedTokenUsage(total, 'gemini_tokens') with trackNormalizedAndRecord('gemini',
  promptTokens, responseTokens). Realtime callback now uses split tokens.
  - electron/ipc/documents.ts — Embedding tracking now uses trackNormalizedUsage(supabase, userId, 'embedding', tokens, 0).

  Phase 3: Hard Limit Enforcement

  - electron/services/usageLimiter.ts (new) — In-memory cache of {normalizedTokensUsed, tokenLimit, orgId} with 60s TTL,
  month-rollover detection, checkBudget(), recordUsage(), isUserInOrg().
  - electron/ipc/handlers.ts — Budget check before start-listening and generate-response. Auto-disconnect on limit exceeded
  after realtime response.
  - electron/ipc/documents.ts — Budget check before all embedChunks() calls (upload, upload-text, update-text-document).
  - electron/ipc/organization.ts (new) — IPC handlers for org:activate-code, org:get-membership, org:check-budget,
  org:get-monthly-usage.
  - electron/preload.ts — Added activateCode, getOrgMembership, checkBudget, getMonthlyUsage, onUsageLimitExceeded.
  - src/types/global.d.ts — Added corresponding type definitions + MonthlyUsage interface.
  - electron/main.ts — Registered registerOrganizationHandlers.

  Phase 4: Activation Code Flow + UI

  - src/main-window/pages/ActivationPage.tsx (new) — Centered card with code input (FN-XXXXXX format), error/success states,
  Japanese labels.
  - src/main-window/MainApp.tsx — Auth flow: auth → activation (if no org) → setup → tutorial → documents. Added /activation
  route.
  - src/overlay/OverlayApp.tsx — Shows locked state if no org, limit-reached state if exceeded. Listens for
  usage-limit-exceeded IPC event.
  - src/main-window/pages/SettingsPage.tsx — Replaced daily usage with monthly. Progress bar (used/limit), percentage, JPY
  cost estimate, org name, raw token breakdown.
  - src/i18n/ja.ts — Added activation.*, settings.organization, settings.monthly, settings.normalizedTokens,
  settings.estimatedCost strings.

  Phase 5: Admin Dashboard

  - admin/ — Complete Next.js 14 app with Tailwind CSS, @supabase/supabase-js using service role key.
  - / (Dashboard) — Summary cards: total orgs, active users, monthly tokens, est. cost (USD + JPY).
  - /orgs — Org table + create form. Shows member count, active code, usage, status.
  - /orgs/[id] — Edit org settings (name, token limit, max users, active toggle). Activation code management (view,
  deactivate, regenerate). Members table with email, usage, JPY cost.
  - /users — All users table with email, org, monthly usage, activation status.
  - API routes: POST /api/orgs, PATCH /api/orgs/[id], POST|DELETE /api/orgs/[id]/code.
  - package.json — Added "admin:dev" script to root.