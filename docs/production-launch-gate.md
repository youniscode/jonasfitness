# Jonas Fitness Progress — Production Launch Gate

This document is the **deterministic go/no-go gate** for turning on real-money sales of
Jonas Fitness Progress (€19 one-time Founding Access) at `https://jonas-fitness.jonascode.com`.

It is a checklist + procedure document. It does **not** automate live Stripe/Dashboard/Clerk/Vercel
actions (those must be done by the owner in each dashboard). The application code is already
fail-closed for every environment check below — this gate exists to list the manual, human steps
that code cannot perform.

---

## 0. State: `NOT PRODUCTION READY`

The repository is prepared and sandbox-validated, but it **must not sell live money yet**. The
single non-negotiable blocker is the missing legal seller identity/consumer disclosures (Section 4)
followed by the live Stripe/Dashboard activation steps (Section 3). Until those are done the paywall
stays **off** and no live orders are possible.

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

## 2. Production environment checklist

### SAFE IDENTIFIERS (encode the expected values)
| Variable | Expected production value | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://jonas-fitness.jonascode.com` (https) | yes |
| `STRIPE_PROGRESS_FOUNDING_PRICE_ID` | a **live** `price_...` for €19 EUR one-time | yes |
| `STRIPE_PAYMENT_MODE` | `managed` (or deliberate `standard` fallback) | yes |

### SECRETS (never print values — confirm presence only)
| Variable | Must be set to | Required |
|---|---|---|
| `STRIPE_SECRET_KEY` | **live** `sk_live_...` (test keys are rejected by the app in production) | yes |
| `STRIPE_WEBHOOK_SECRET` | the **live** webhook signing secret | yes |
| `CLERK_SECRET_KEY` | Clerk **production** secret key | yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** publishable key | yes |
| `DATABASE_URL` | the **production** Neon connection string | yes |
| `LEAD_HASH_SALT` | production salt (only if lead/signup rate-limit used) | as used |
| `COACH_EMAILS` | the real coach allowlist | as used |

### App behaviour switches (fail-closed by code, but set explicitly)
| Variable | Expected | Notes |
|---|---|---|
| `PROGRESS_PAYWALL_ENABLED` | `true` | production missing/invalid throws (never silently off) |
| `PROGRESS_DEV_TEST_BYPASS` | `false` | ignored in production regardless |
| `STRIPE_PAYMENT_MODE` | `managed` | production missing/unknown throws; managed never silently downgraded |

Production is **refused** (throws before checkout/webhook) if any of these are wrong:
sandbox/test Stripe keys, a `price_...` that is not configured, missing webhook secret, missing
payment mode, an unknown payment mode, `managed` unable to operate, a dev-bypass, a disabled
paywall, a non-https/missing app URL, or Clerk still pointing at development configuration.

---

## 3. Live-Stripe pre-launch checklist (owner, in Stripe Dashboard)

- [ ] Live **Jonas-Fitness** account selected (not the sandbox/test account).
- [ ] **Managed Payments activated in LIVE mode** and its terms accepted.
- [ ] Digital-product eligibility verified in LIVE mode (add an eligible digital/SaaS tax code if `managed`).
- [ ] Product classification verified.
- [ ] Live **€19.00 EUR one-time** product + price created (`tax_behavior` **inclusive** so the €19 headline isn't misleading); record its `price_...` id → `STRIPE_PROGRESS_FOUNDING_PRICE_ID`.
- [ ] Customer-facing **business/support information** (name, support email/contact) correct.
- [ ] **Terms URL** added where applicable → `/legal/terms`.
- [ ] **Privacy URL** added where applicable → `/legal/privacy`.
- [ ] Live **webhook endpoint** created → `https://jonas-fitness.jonascode.com/api/webhooks/stripe`.
- [ ] Correct events selected: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
- [ ] Live **webhook signing secret** stored securely → `STRIPE_WEBHOOK_SECRET`.
- [ ] Live **`sk_live_...`** secret key stored securely → `STRIPE_SECRET_KEY`.
- [ ] **No sandbox/test IDs** (keys, price ids, webhook secrets) in the production environment.

## 4. Legal / consumer items (all P0 blockers — see README)

Confirm and fill every placeholder in `/legal`, `/privacy`, `/terms`, `/refunds`:
seller name/entity, legal form/status, registered address, SIREN/SIRET/RCS/VAT where applicable,
business contact email, publication director if required, hosting provider, consumer mediator
(where required), and governing law. Decide the digital-content withdrawal policy and, if you ever
wish to rely on a withdrawal exception, add the explicit checkout consent/acknowledgement (not yet
implemented). Until then the conservative refund policy stands.

---

## 5. Clerk / Vercel actions

- Set Clerk to **production** (not development) for the production domain.
- Confirm the Clerk keys in the Vercel project are the **production** pair.
- Confirm the Vercel production build uses the production `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`,
  Stripe, and Clerk env above.
- Run the migration preflight (Section 1) against the production DB before enabling checkout.

---

## 6. Deployment gate — BLOCK launch if ANY are true

| # | Blocker | Check |
|---|---|---|
| 1 | Any legal placeholder unsupplied (`/legal`, `/privacy`, `/terms`, `/refunds`) | manual |
| 2 | No confirmed legal seller identity/status | manual |
| 3 | No consumer mediator where required | manual |
| 4 | Managed Payments not confirmed live | Stripe Dashboard |
| 5 | No live `price_...` in `STRIPE_PROGRESS_FOUNDING_PRICE_ID` | env |
| 6 | No live webhook endpoint/secret | Stripe Dashboard / env |
| 7 | Production DB migration state unknown (Section 1 not clean) | DB |
| 8 | Clerk still development-mode in production | Clerk |
| 9 | Test Stripe credentials in production | env |
| 10 | `PROGRESS_PAYWALL_ENABLED` not `true` in production | env |
| 11 | `PROGRESS_DEV_TEST_BYPASS=true` in production | env |
| 12 | Wrong `NEXT_PUBLIC_APP_URL` | env |
| 13 | `npm test` / `tsc` / `lint` / `build` failing | CI/local |

Only when **every** row is clear do you flip `PROGRESS_PAYWALL_ENABLED=true` in the production
environment and begin selling.