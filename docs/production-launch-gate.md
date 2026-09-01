# Jonas Fitness Progress — Production Launch Gate

This document is the **deterministic go/no-go gate** for turning on real-money sales of
Jonas Fitness Progress (€19 one-time Founding Access) at `https://jonas-fitness.jonascode.com`.

It is a checklist + procedure document. It does **not** automate live Stripe/Dashboard/Clerk/Vercel
actions (those must be done by the owner in each dashboard). The application code is already
fail-closed for every environment check below — this gate exists to list the manual, human steps
that code cannot perform.

---

## 0. State: `NOT PRODUCTION READY` — A: technical READY · B: activation OFF · C: compliance gaps open

Readiness is tracked **separately per type** so technical state is never conflated with legal or
administrative debt, and so unresolved obligations are never disguised as resolved:

**A. TECHNICAL READINESS — ✅ READY.** Production DB migrations/schema, production Clerk,
verified seller identity, live Stripe Managed Payments, live €19 tax-inclusive price, live webhook
+ live secrets, production URL, `STRIPE_PAYMENT_MODE=managed`, sandbox/live price separation,
sandbox commerce cleanup, dev bypass `false`, and the validated payment/entitlement test suite are
all confirmed (Sections 1–3 and 6A). No technical blocker remains.

**B. COMMERCIAL ACTIVATION — ❌ OFF.** Sales are off **solely** because `PROGRESS_PAYWALL_ENABLED=false`
(deliberate hold: no final deployment of the current build, no first controlled real €19 purchase
yet). This is a switch decision, not a technical gap.

**C. LEGAL / ADMINISTRATIVE ACTIONS OUTSTANDING — KNOWN COMPLIANCE GAP, ACTION REQUIRED — NOT a
technical deployment gate.** The Guichet unique / RNE activity-registration filing (ACTION REQUIRED,
statutory deadline) and the consumer mediator designation (explicitly UNRESOLVED) remain outstanding
by owner decision (Sections 4b and 6C). They are **not** marked compliant and **not** treated as
resolved: the business is **not** fully legally compliant while they remain open.

Until **B** is switched on, the paywall gate stays **off** (see Section 2 note on what that means at
runtime) and no paid-gated sales are enforced.

---

## 1. Migration preflight (SAFE READ-ONLY — run against the PRODUCTION database)

> Background: the local/sandbox Neon DB previously had an empty `drizzle.__drizzle_migrations`
> tracker despite an older schema already existing, so `0013`/`0014` were baselined manually via
> Drizzle runtime migration and `0015` was then applied. **Do not blindly replay historical
> migrations against the production DB.** The procedure below is read-only and determines state
> before deciding whether/how to apply.

Never connect your local machine with auto-migrate. Run **read-only** queries first. From a
`psql`/Neon SQL shell or a read-only SQL panel against the **production** `DATABASE_URL`:

### 1a. Confirm connectivity is READ-ONLY (no writes)
```sql
BEGIN;
SET TRANSACTION READ ONLY;
SELECT current_database(), current_user;
-- proceed below; ROLL BACK when you are done (never COMMIT)
```

### 1b. Check the migration tracker state
```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;
```
Expected tail: the highest `hash` corresponds to the `0015` migration snapshot. If the tracker is
empty but tables exist (the historical situation), migrations were applied without a recorded
tracker — proceed to 1c/1d to confirm object existence rather than replaying.

### 1c. Confirm the Progress (0013) tables exist
```sql
SELECT to_regclass('public.training_routines')            AS training_routines,
       to_regclass('public.training_routine_exercises')   AS training_routine_exercises,
       to_regclass('public.training_workout_sessions')    AS training_workout_sessions;
```
All three must be non-null.

### 1d. Confirm the commerce (0014) tables + indexes exist
```sql
SELECT to_regclass('public.commerce_orders')          AS commerce_orders,
       to_regclass('public.product_entitlements')     AS product_entitlements,
       to_regclass('public.payment_webhook_events')   AS payment_webhook_events,
       to_regclass('public.validation_events')        AS validation_events;
```
And the idempotency/entitlement indexes (these must exist — they back the fail-closed idempotent
fulfillment and the at-most-one-ACTIVE-entitlement invariant):
```sql
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('commerce_orders','product_entitlements','payment_webhook_events','validation_events')
  AND indexname IN (
    'commerce_orders_provider_checkout_unique',
    'payment_webhook_events_provider_event_unique',
    'product_entitlements_owner_product_active_unique',
    'validation_events_owner_name_key_unique'
  );
```

### 1e. Confirm the 0015 index cleanup
The redundant broad unique `(owner_id, product_key)` must have been **dropped** (so a revoked
grant can later be re-granted), while the **partial** active-unique must remain:
```sql
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='product_entitlements'
  AND indexname = 'product_entitlements_owner_product_unique';
-- expect ZERO rows (dropped by 0015)
SELECT indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='product_entitlements'
  AND indexname='product_entitlements_owner_product_active_unique';
-- expect the PARTIAL index: ... WHERE product_entitlements.status = 'active'
```

### 1f. Detect partial appliations (aborted/partial)
Check for tables present but missing their required indexes, or indexes present on tables that do
not exist, or a tracker cardinality that disagrees with the object set:
```sql
-- tables without their 0014 idempotency index = broken/commercial tables
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname IN ('commerce_orders','payment_webhook_events','product_entitlements','validation_events')
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
    WHERE ic.relnamespace=c.relnamespace AND i.indrelid=c.oid
  );
```
Any row here is a **partial application** and must be fixed before going live.

### 1g. Decision
- If 1b shows a full tracker **and** 1c/1d/1e/1f are all healthy → the production schema is fully
  migrated; **no migration action needed**.
- If 1b is empty but 1c–1f are healthy → the schema already exists; **do not replay 0013/0014**.
  You may insert the tracker rows manually *or* rely on the schema as-is (documented so future
  Drizzle migrations start from a known state).
- If anything in 1c–1f is missing → determine whether it is safe to apply **only** the specific
  additive migration(s) for the missing objects (0013 then 0014 then 0015), each guarded by the
  1c–1f checks, rather than replaying history blindly.

---

## 1b. VERIFIED production database state (as of this launch-readiness pass)

Underlying schema state verified against the production DB:

- **Progress tables present:** `training_routines`, `training_routine_exercises`,
  `training_workout_sessions` (0013); `commerce_orders`, `product_entitlements`,
  `payment_webhook_events`, `validation_events` (0014).
- **Drizzle Progress migrations recorded:** `0013`, `0014`, `0015`.
- **Correct partial active-entitlement unique index exists**
  (`product_entitlements_owner_product_active_unique` on `(owner_id, product_key)`
  `WHERE status = 'active'`), and the redundant broad unique was dropped by `0015`.
- **Sandbox cleanup complete:** `commerce_orders`=0, `product_entitlements`=0,
  `payment_webhook_events`=0, `validation_events`=0 (no Stripe test session/event IDs remain).

**→ RESOLVED: production DB migrations/schema state is confirmed green.** The read-only checks in
Sections 1a–1g remain the on-going preflight procedure for any future migration.

## 1c. Clerk status (verified)

- The deployed production sign-in page was manually verified and does **not** display Clerk
  "Development mode". → RESOLVED (non-blocking) for runtime.
- **Non-blocking branding task (owner):** change the Clerk application display name from
  "My Application" to **"Jonas Fitness"** before public launch.

## 1d. Verified LIVE Stripe state

Confirmed against the Stripe LIVE dashboard (no new resources created; already in place):

- **Managed Payments** — live setup completed; dashboard status **"Ready to use"**; product
  eligibility **eligible**; integration is **prebuilt hosted Checkout**. → RESOLVED
- **Live product:** *Jonas Fitness Progress - Founding Access*. → RESOLVED
- **Live price:** **€19.00 EUR one-time**. → RESOLVED
- **Live webhook:** `https://jonas-fitness.jonascode.com/api/webhooks/stripe` with events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`. → RESOLVED
- **Production Vercel env prepared** (see Section 2): `NEXT_PUBLIC_APP_URL` live, live price ID set,
  `STRIPE_PAYMENT_MODE=managed`, `PROGRESS_DEV_TEST_BYPASS=false`, Stripe live secret + webhook
  secret configured as **Vercel Sensitive/Hidden** variables. → RESOLVED (secrets validated only
  via a controlled production transaction, not by reading plaintext — see Section 3b)

> **RESOLVED — manually confirmed in Stripe Dashboard on 2026-08-31:** “Include tax in prices =
> Yes”. The €19 price is tax-inclusive (all-in), so the marketing headline stays accurate.

## 1e. Sandbox vs LIVE price separation

- **Sandbox / local price:** `price_1UASYo7rcy02FdKvVeRBGhNj` (test mode — never in production).
- **Production / live price:** `price_1UAWmS7kjyPO5Tpk7if2FO7a` (live mode — configured in
  `STRIPE_PROGRESS_FOUNDING_PRICE_ID`).

**Production must never accept the sandbox price ID.** The webhook validates the configured live
price before granting any entitlement; the two IDs must stay distinct and the sandbox ID must never
appear in the production environment. `STRIPE_PROGRESS_FOUNDING_PRICE_ID` in production holds only the
live price ID. (`config.local`/`.env.local` is unchanged.)

## 2. Production environment checklist

### SAFE IDENTIFIERS (now configured live)
| Variable | Production value | Status |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://jonas-fitness.jonascode.com` (https) | ✅ configured |
| `STRIPE_PROGRESS_FOUNDING_PRICE_ID` | **live** `price_1UAWmS7kjyPO5Tpk7if2FO7a` (€19 EUR one-time) | ✅ configured (see Section 1e — never the sandbox `price_1UASYo...`) |
| `STRIPE_PAYMENT_MODE` | `managed` (or deliberate `standard` fallback) | ✅ `managed` |

### App behaviour switches (as currently set in production)
| Variable | Current prod value | Status |
|---|---|---|
| `PROGRESS_PAYWALL_ENABLED` | **`false`** (intentional hold) | 🔒 intentionally off until blockers clear — do not enable yet |
| `PROGRESS_DEV_TEST_BYPASS` | `false` | ✅ explicit false (ignored in production regardless) |

### SECRETS (Vercel **Sensitive** — never print values; confirm presence only)
| Variable | Must be | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | **live** `sk_live_...`, Production only, **Sensitive/Hidden** | ✅ configured as Sensitive |
| `STRIPE_WEBHOOK_SECRET` | **live** webhook signing secret, **Sensitive/Hidden** | ✅ configured as Sensitive |
| `CLERK_SECRET_KEY` | Clerk **production** secret key | required |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** publishable key | required |
| `DATABASE_URL` | **production** Neon connection string | required |
| `LEAD_HASH_SALT` | production salt (only if lead/signup rate-limit used) | as used |
| `COACH_EMAILS` | the real coach allowlist | as used |

Production **throws a `ConfigValidationError`** (before checkout/webhook/entitlement) if any of
these are wrong: sandbox/test Stripe keys, a `price_...` that is not configured, missing webhook
secret, missing payment mode, an unknown payment mode, `managed` unable to operate, a dev-bypass
leaking to production, a **missing/invalid** `PROGRESS_PAYWALL_ENABLED`, a non-https/missing app
URL, or Clerk still pointing at development configuration.

> Verified against code + tests (`resolvePaywallEnabled` / `payments-config-validation.test.ts`):
> in production a **missing or invalid** `PROGRESS_PAYWALL_ENABLED` throws at the earliest
> server-side config read; an **explicit `false` is allowed** and resolves to paywall-off — the
> deliberate pre-launch hold, never a silent default. The current production `false` is therefore
> an explicit, reversible switch, not a code barrier. Runtime consequence: while the flag is
> `false`, any signed-in user may open `/progress` (paywall-off access) and the Founding offer's
> checkout still works, so “off” controls the gate — it does not make the product technically
> un-sellable.

---

## 3. Live-Stripe pre-launch checklist (owner, in Stripe Dashboard)

### 3a. DONE — verified live
- [x] Live **Jonas-Fitness** account selected (not the sandbox/test account).
- [x] **Managed Payments activated in LIVE mode**, terms accepted, dashboard **“Ready to use”**.
- [x] Digital-product **eligibility verified** in LIVE mode (eligible digital/SaaS classification).
- [x] Product classification verified.
- [x] Live **€19.00 EUR one-time** product + price created → `price_1UAWmS7kjyPO5Tpk7if2FO7a` configured live.
- [x] **“Include tax in prices = Yes” — RESOLVED** (manually confirmed in Stripe Dashboard on 2026-08-31). €19 is the all-in, tax-inclusive price; the amount shown at checkout matches the marketing headline.
- [x] Live **webhook endpoint** created → `https://jonas-fitness.jonascode.com/api/webhooks/stripe`.
- [x] Correct events selected: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
- [x] **No sandbox/test IDs** (keys, price ids, webhook secrets) in the production environment.
- [x] Secrets stored as **Vercel Sensitive/Hidden** production vars (Section 2).

### 3b. Secret handling — do not read back plaintext
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are Vercel **Sensitive** variables. Vercel Sensitive
  variables **cannot be read back via env pull**; redacted/unavailable plaintext is **not** a sign of
  invalidity.
- **Do not attempt to validate them by pulling plaintext from Vercel.** Their functional validation
  will occur **only through a controlled production transaction** after the launch blockers clear.
- **Never log either value.** Never embed them in source, fixtures, commits, or client bundles.

## 4. Legal / consumer items (P0 blockers — see README)

### 4a. Verified seller identity (RESOLVED — no longer a blocker)

- **Younis MOHAMMAD** — Entrepreneur individuel (micro-entrepreneur)
- SIREN **108 783 192** — SIRET **108 783 192 00017**
- Registered establishment: **104 Avenue Vauban, 83000 Toulon, France**
- Contact / support: **contact@jonascode.com**
- Commercial name: **Riviera With Younis** (existing commercial name of the same EI, not a separate entity)

This identity is now filled into `/legal`, `/legal/privacy`, `/legal/terms`, `/legal/refunds`. Jonas
Fitness is the **product/brand**; the legal seller/operator is Younis MOHAMMAD, EI. Do **not** use
`512 Rue Henri Pertus` as the registered address and do not imply Jonas Fitness is a separate company.

The **data controller** for Progress personal data is Younis MOHAMMAD, EI (address above).

### 4b. Legal / administrative actions outstanding (KNOWN COMPLIANCE GAP — ACTION REQUIRED)

These are **not** technical deployment or sales gates and are **not** marked compliant or resolved.
They are real legal obligations the owner has chosen to track and fulfil outside the technical
launch gate; do **not** represent them as finalised.

- **Jonas Fitness additional digital/software activity registration (Guichet unique / RNE) —
  ACTION REQUIRED, filing PENDING.** Under official INPI guidance, a micro-entrepreneur must
  notify an addition/change of activity through the Guichet unique **within one month** of the
  change. The INPI modification has not been submitted/completed yet. Do **not** claim the Jonas
  Fitness activity registration is finalized, and do **not** describe final RNE approval as a
  technical prerequisite to the first commercial transaction.
- **Consumer mediator — KNOWN COMPLIANCE GAP, ACTION REQUIRED (explicitly UNRESOLVED).** French
  B2C consumer-mediation obligations require the professional to designate an appropriate
  referenced mediator and publish its details. No mediator is designated and no details are
  published; no mediator is invented in this document. The owner has chosen **not** to make this a
  technical deployment gate, but it remains an open compliance item.
- **VAT number/status** — no VAT number is shown to customers; the seller's VAT status is not yet
  confirmed (customer copy states this honestly). → ACTION REQUIRED
- **Legal-copy cleanup (2026-09-01):** raw `[REQUIRED]` placeholder markers were removed from the
  customer-facing pages; resolved facts are now stated directly (publication director = Younis
  MOHAMMAD; hosting/deployment = Vercel; governing law = French law with mandatory consumer rights
  preserved; retention/legal-basis policy documented; 14-day customer friendly refund policy).
  → customer-facing copy no longer contains product-development language
- **Review by a qualified person** of the customer-facing legal copy before public launch — still
  recommended (these pages are provided for information, not legal advice). → open
- **Digital-content withdrawal policy (decided 2026-09-01):** no withdrawal exception is relied on and
  no express checkout consent exists, so the conservative customer-friendly refund policy applies
  (14-day window; refund via Stripe to the original payment method).

---

## 5. Clerk / Vercel actions

- Set Clerk to **production** (not development) for the production domain.
- Confirm the Clerk keys in the Vercel project are the **production** pair.
- Confirm the Vercel production build uses the production `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`,
  Stripe, and Clerk env above.
- Run the migration preflight (Section 1) against the production DB before enabling checkout.

---

## 6. Deployment gate — A: TECHNICAL READINESS / B: COMMERCIAL ACTIVATION / C: LEGAL & ADMIN OUTSTANDING

### A. TECHNICAL READINESS — ✅ READY (every row verified/RESOLVED; independent of the C items)

| # | Item | Note |
|---|---|---|
| 1 | Production DB migrations / schema (0013–0015, tables, indexes) | confirmed (Section 1b) |
| 2 | Sandbox commerce pollution | cleaned (all 4 commerce tables at 0) |
| 3 | Legal seller identity | verified (Section 4a) |
| 4 | Production Clerk runtime non-“Development mode” | verified (Section 1c); branding task remains |
| 5 | Migration preflight procedure | documented and read-only (Section 1a–1g) |
| 6 | **Managed Payments live setup** | verified “Ready to use”, eligible, hosted Checkout (Section 1d) |
| 7 | **Live €19 product/price creation** | `price_1UAWmS7kjyPO5Tpk7if2FO7a` (Section 1d) |
| 8 | **Live Stripe webhook creation** | endpoint + events configured (Section 1d) |
| 9 | **Production public URL configured** | `https://jonas-fitness.jonascode.com` |
| 10 | **Live price ID configured** | `STRIPE_PROGRESS_FOUNDING_PRICE_ID` (Section 1e) |
| 11 | **`STRIPE_PAYMENT_MODE=managed`** | configured live |
| 12 | **Stripe live secret configured** | `STRIPE_SECRET_KEY` as Vercel Sensitive |
| 13 | **Webhook signing secret configured** | `STRIPE_WEBHOOK_SECRET` as Vercel Sensitive |
| 14 | **Dev bypass explicitly `false`** | `PROGRESS_DEV_TEST_BYPASS=false` live |
| 15 | **Tax-inclusive pricing (“Include tax in prices = Yes”)** | manually confirmed in Stripe Dashboard on 2026-08-31 (Section 1d) |
| 16 | **Validated payment/entitlement test suite** | run 2026-08-31: config validation, fulfillment, idempotency, purchase activation, webhook verification, migration-sequence, commerce, mechanics, service — all green |

### B. COMMERCIAL ACTIVATION — ❌ OFF (BLOCKING while `PROGRESS_PAYWALL_ENABLED=false`)

| # | Item | Status |
|---|---|---|
| 1 | **`PROGRESS_PAYWALL_ENABLED` remains `false`** | intentional hold — the sole reason activation is off; flip only inside the activation sequence |
| 2 | **No final live deployment performed (current build)** | Vercel env prepared; deployment is the next action |
| 3 | **No first controlled real €19 purchase performed** | to be executed after activation |

### C. LEGAL / ADMINISTRATIVE ACTIONS OUTSTANDING (NOT a technical gate — do NOT mark resolved)

| # | Item | Status |
|---|---|---|
| 1 | Any remaining **legal placeholder unsupplied** on customer-facing pages (raw `[REQUIRED]` markers) | **cleared 2026-09-01** — unresolved items (registration, mediator, VAT status) are stated factually, not as placeholders (Section 4b) |
| 2 | Jonas Fitness **Guichet unique / RNE activity-registration filing** | **ACTION REQUIRED, PENDING** — submit within the statutory one-month deadline (INPI guidance); do not claim finalised; do not treat RNE approval as a technical prerequisite (Section 4b) |
| 3 | **Consumer mediator** designation + published details | **KNOWN COMPLIANCE GAP — ACTION REQUIRED**, explicitly UNRESOLVED; no mediator invented (Section 4b) |
| 4 | VAT number, publication director, hosting details, governing law / competent jurisdiction, retention periods, digital-content withdrawal consent | **open** (Section 4b) |

Only when **every `B` row** is clear do you (a) flip `PROGRESS_PAYWALL_ENABLED=true` in the
production environment, (b) deploy the final build, and (c) perform the first controlled real €19
purchase — which also validates the live secrets. The **C** items are tracked compliance debt, are
**not** prerequisites for that sequence, and must **not** be described as resolved until actually
fulfilled. Until **B** is flipped, the paywall stays **off** and no paid-gated sales are enforced.
