# Finance Dashboard

Upload bank and credit card statements, get every transaction labelled with a category and an owner (Personal or Business), and answer questions only about the payees the app cannot work out. Each answer is saved as a rule.

Data lives in a [Turso](https://turso.tech) database (libSQL, SQLite-compatible). With no Turso settings the app uses a local file in `data/finance.db`, so it also runs on your own computer with nothing to set up.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # then add your keys, all optional
npm run build
npm start                    # http://localhost:3000
```

For development with live reload, use `npm run dev`.

## Try it with sample data

`samples/` has three made-up statements (not real data). On the Upload page:

| File | Upload to |
| --- | --- |
| `hdfc-savings-sample.csv` | HDFC Savings |
| `icici-current-sample.csv` | ICICI Current |
| `hdfc-card-sample.csv` | HDFC Credit Card 1 |

To start again from empty with the local file, stop the app and delete the `data/` folder.

## Keys

| Key | What it adds | Without it |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev picks a category and owner for payees with no rule | Those payees go to Questions |
| `ANTHROPIC_API_KEY` | Sonnet reviews what Jev is unsure about, and maps statement layouts the built-in reader cannot | Unsure payees go to Questions; unusual layouts fail with a message |

With no keys the app still works: automatic checks, your rules and the known-merchant list run, and the rest becomes questions.

Only payee names, UPI IDs, amounts, narration text and account names are sent to the model APIs. Full account numbers are never stored or sent.

## How sorting works

For each transaction, in order:

1. **Automatic checks.** Card bill payments, ATM withdrawals, bank charges, interest, refunds, and transfers between your own accounts (by your names in Settings, or by an equal and opposite entry in another account within two days).
2. **Your rules.** Saved whenever you answer a question with "Always" or an amount condition.
3. **Known merchants.** About 85 patterns in `lib/merchants.ts`. Merchants used both ways (Swiggy, Amazon, Uber) get a category but the owner is still asked.
4. **Jev, then Sonnet.** One request per payee, not per transaction. A result below the confidence bar (0.85 by default) becomes a question.

The UPI handle (`@ybl`, `@okaxis`) is never used to decide personal vs business, and the paying account is only a weak default.

## First-time setup

1. **Settings → Accounts and cards.** Check the 11 accounts, add the last four digits, and fix the default owner if needed.
2. **Settings → Your own names.** Add your name and your business name so transfers between your accounts are recognised.
3. **Upload** one statement per account, then work through **Questions**.

## Project layout

| Path | What it holds |
| --- | --- |
| `lib/parse/statement.ts` | Reads Excel and CSV, finds the header row, extracts rows |
| `lib/parse/narration.ts` | Pulls payee, UPI ID, reference, mode and note out of the narration |
| `lib/pipeline.ts` | Ingest, dedupe, classification order, questions, rules |
| `lib/llm.ts` | TypeSafe Jev and Claude Sonnet calls |
| `lib/merchants.ts` | Known-merchant list |
| `lib/seed.ts` | Starting categories and accounts |
| `app/api/*` | JSON endpoints |
| `app/*/page.tsx` | Dashboard, Upload, Questions, Transactions, Settings |
| `components/ui/*` | shadcn-style components |
| `scripts/smoke.ts` | `npx tsx scripts/smoke.ts` loads the samples into a scratch database and prints the result |

## Known limits

- The statement reader has been tested on the sample layouts only. Real exports from each bank may need small changes to the header patterns in `lib/parse/statement.ts` or the narration rules in `lib/parse/narration.ts`.
- The Jev and Sonnet calls follow the published API shapes but have not been run against live keys in this build.
- Spend charts count `spend` transactions only. Refunds are shown separately and are not netted against the category.
- Password-protected or PDF statements are not supported. Export Excel or CSV from netbanking.

## Database and deploying

1. Create a database at turso.tech (or with the CLI: `turso db create finance-dashboard`).
2. Copy its URL (`libsql://...`) and create a token (`turso db tokens create finance-dashboard`).
3. Set these environment variables on your host:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | the `libsql://...` URL |
| `TURSO_AUTH_TOKEN` | the token |
| `APP_PASSWORD` | a password for the browser prompt. Set this on any public deployment |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | optional, see Keys |

Tables and the starting categories and accounts are created automatically on the first request. Nothing else to run.

Uploads call the models while the request is open, so a big statement can take a minute. The upload and reclassify routes ask the host for up to 300 seconds.
