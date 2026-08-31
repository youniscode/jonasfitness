# Jonas Fitness

Jonas Fitness is a multilingual coaching website and private coach workspace for clients, check-ins, programmes, sessions, and pre-session Pulse surveys.

## Production stack

- Next.js 16 and React 19
- Clerk authentication for the private coach dashboard
- Neon Postgres with Drizzle ORM
- Vercel hosting
- Local Ollama support during development, with a safe built-in fallback in production

## Set up on Vercel

Use this order so the database and authentication credentials are available before the app starts.

1. Import the GitHub repository into Vercel, or run `vercel link` in the project folder.
2. Add Clerk to the linked Vercel project: `vercel integration add clerk`.
3. Add Neon to the linked Vercel project: `vercel integration add neon`.
4. Pull the generated credentials: `vercel env pull .env.local --yes`.
5. Confirm `.env.local` includes `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`.
6. Install dependencies: `npm install`.
7. Create the Neon tables: `npm run db:push`.
8. Start locally: `npm run dev`.

Never commit `.env.local` or paste secret keys into GitHub.

## Clerk routes

- Sign in: `/sign-in`
- Sign up: `/sign-up`
- Protected coach workspace: `/dashboard`

The public landing page and each private Pulse URL remain accessible without a coach account. Every dashboard record is scoped to the signed-in Clerk user ID.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run db:generate
npm run db:push
```

## Jonas Fitness Progress · Founding Access (payments)

`/progress/founding` is the public, pre-auth offer for the paid Founding Access product. Checkout is Stripe-hosted and access is granted **only** by the Stripe webhook (`/api/webhooks/stripe`) after authentic payment confirmation — never by the success page or any client state.

Configuration (server-only; see `.env.example`):

- `STRIPE_SECRET_KEY` — a Stripe **SECRET** key (`sk_test_...` / `sk_live_...`). Publishable `pk_*` keys are rejected; test keys are rejected in production.
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_PROGRESS_FOUNDING_PRICE_ID` (a `price_...` id).
- `STRIPE_PAYMENT_MODE=managed|standard` — explicit; production fails closed if missing/unknown.
- `NEXT_PUBLIC_APP_URL` — absolute origin used for redirects; production requires https.
- `PROGRESS_PAYWALL_ENABLED` — **fail-closed**: production requires an explicit `true`; there is no silent off default. Dev/test default off.
- `PROGRESS_DEV_TEST_BYPASS` — honored only outside production.

## PRE-LAUNCH BLOCKERS (payments)

- **Terms / Privacy / legal seller disclosure are NOT yet published.** Before opening live sales, public Privacy policy, Terms of use, and seller/legal disclosures must be reviewed and made available (e.g. the offer and success pages). The Phase 2 code intentionally does **not** claim legal compliance is complete.
- Stripe account activation (Managed Payments terms + eligible digital-product tax code if `STRIPE_PAYMENT_MODE=managed`), a live €19 `price_...`, a live webhook endpoint + secret, and live `sk_live_*` keys are required before turning the paywall on.

## Local Ollama

In local development, the private coach workspace can use Ollama at `http://127.0.0.1:11434` with `qwen3:8b`. Vercel cannot connect directly to Ollama running on your PC, so production uses the built-in coach drafts until a hosted model is connected.
