# Montex Forge MIS — project notes

Read this first in every session. It records what has been built, the owner's decisions, how the
system is deployed, and how the owner wants work done. Keep it up to date when something changes.

## Owner and how to work

- Owner: **Ansh Yadav, BLOOM COSMOS** (GitHub `6647ansh`, email anshyadav6647@gmail.com). Client: **Montex Forge Industries** (forging plant).
- Talk to the owner in **Hinglish** (Hindi in Latin script), simple words, step by step. The owner is new to production deployments.
- **Never guess business facts** ("kuch guess nhi krna"). Ask when a decision is the owner's. Do not invent defaults in data either: blank stays blank.
- Few check-ins: ask only when truly blocked; otherwise act and report.
- **Commits: author only the owner**, with no AI attribution lines:
  `git -c user.name=6647ansh -c user.email=anshyadav6647@gmail.com commit -m "..."` — no `Co-Authored-By` or session lines.
- Nothing shown to Montex (app, guides, PDFs) may say it was AI-generated. Credit is "Designed & developed by Ansh Yadav · BLOOM COSMOS".
- Work branch: `claude/restore-folder-structure` (Render deploys from this branch). No pull request unless asked.
- Never commit secrets (service-account JSON, `.env`). Never put server secrets in `VITE_*` variables.

## Business decisions (in force)

- Firestore only (no Realtime Database). Google sign-in only. No demo mode.
- Approvers (employees, purchase requisitions): **Super Admin and CEO** only; nobody approves their own request.
- Prices/rates/order values visible only to **Sales, Finance, CEO, Super Admin**.
- Dispatch needs **both Quality and Finance clearance**.
- Produced quantity = sum of OK pieces from shift logs. Rework counts as rejected.
- Lot with unaccounted pieces: warning only. More pieces counted than produced: clearance blocked until explained.
- Invoices are made in **Tally**; MIS records invoice number, date and **total including GST**. Due date = invoice date + customer credit days.
- Receivables age by **invoice date** (0–30, 31–60, 61–90, 90+), one record per invoice; payments clear the **oldest dues first**.
- Montex staff get **CEO** role at most; Super Admin stays with Ansh (a Super Admin can deactivate other Super Admins).
- Bootstrap Super Admin email in `firestore.rules`: anshyadav6647@gmail.com.

## Live system

| Part | Where | Notes |
| --- | --- | --- |
| Website | https://montexforge-7d537.web.app (Firebase Hosting, free Spark plan) | `npm run deploy:web` from the owner's PC |
| Database | Firestore `(default)`, project `montexforge-7d537`, region asia-south1 | Rules: `npm run deploy:rules` |
| Admin API | https://montex-mis-api.onrender.com (Render free, Singapore, `render.yaml`) | Auto-deploys on push; sleeps after 15 min idle (~1 min wake). Key in Render env `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Config | `firebase-applet-config.json` (web config + `adminApiUrl`) | |

- Owner's PC: Windows, repo at `C:\Users\Ansh Yadav\Documents\mis`, key at `C:\montex-keys\montex-key.json`, `.env` has `GOOGLE_APPLICATION_CREDENTIALS`.
  The owner's local `package.json` has an extra `allowScripts` block, so updates are pulled with `git stash; git pull; git stash pop`.
- Free-plan limits: Firestore 50k reads/day; no automatic backups (admin uses **Download backup** weekly); Render cold start.
- Suggested to the owner (not confirmed done): cron-job.org ping of `/api/health` every 10 min; paid Render later.

## Architecture

- React 19 + Vite 8 + TypeScript + Tailwind v4, shadcn-style UI in `components/ui`, sonner toasts. Express `server.ts` (Vite middleware in dev, admin API in prod) with firebase-admin (`server/config/firebaseAdmin.ts`, Firestore only).
- Data flow: `src/context/RtdbContext.tsx` (name is historical; Firestore only) → `src/services/firestoreCutoverService.ts` (writes, live listeners via `subscribeProductionSnapshot`, audit log streamed, latest 200) → `src/services/firestoreService.ts` → mappers in `src/services/firestoreMappers.ts` (two-way enum maps; throw `RecordValidationError` instead of inventing values).
- Roles: `src/types/roles.ts` (read/write matrices). Nav: `src/components/layout/nav.ts`. Screens: `src/components/modules/*Page.tsx`, `src/components/orders/*`.
- Admin API (`server/routes/employeeRoutes.ts`): approve, role change, deactivate/reactivate, create employee. Client: `src/services/adminEmployeeApi.ts` (90 s timeout, wakes server when Admin page opens).
- Receivables: per-invoice docs in `outstandingPayments` (id `INV-…`, invoice number in `remarks`); older per-customer bucket docs (`remarks` starts "Ageing Schedule") are "carried over". Built by `buildOutstandingAgeing` in the mappers.
- Masters that can be added in-app: customers, products, raw materials (Inventory → Add material), mills (Purchase → New → Approved mill).
- Backup: `src/services/backupService.ts` (Super Admin only, .json + .xlsx). Audit times shown in IST.
- 90-day window: live screens load only the last 90 days of the day-by-day logs (machine, furnace, power, stock movements, quality lots, dispatches, dimensional reports; `WINDOWED_LOG_DATE_FIELD` in the cutover service). Reports fetch older records when the period starts earlier (`loadLogHistory`); an old order's MTC reads its lots by order (`loadOrderLogs`). Order totals, stock, receivables, masters, open work are not windowed. Backup reads everything.

## Testing

- Emulators: `npx firebase emulators:start --only auth,firestore --project montexforge-7d537`, then `npm run seed:emulator` (users `<role>@montex.test`, e.g. `superadmin@`, `ceo@`, `sales@`, `purchase@`, `stores@`, `quality@`, `dispatch@`, `finance@`).
- Dev server against emulators: `PORT=3000 VITE_FIREBASE_EMULATORS=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=montexforge-7d537 npx tsx server.ts`; sign in from the browser console with `window.__montexEmulatorSignIn('<email>')`.
- Checks before pushing: `npx tsc --noEmit -p .`, `npx vite build`, `npm run test:rules` (55/55), `npm run verify:phase3` (17/17). Use Playwright (pre-installed) to click through flows.

## Documents for Montex

- Online guides (claude.ai docs): User Guide https://claude.ai/artifact/SMLAX59tX5xhtJCa6xQoY7, Department Guides https://claude.ai/artifact/8mZg2kAguWRwupZwsb26BS.
- Combined PDF (cover, Part 1 User Guide, Part 2 Department Guides with workflow diagrams and screenshots) was generated with Playwright print-to-PDF, because the docs' own PDF export drops images and diagrams. Screenshots use sample data ("Sample Engineering Ltd").
- Demo walkthrough page: https://claude.ai/artifact/VNSbUqGk7MvZEFt9DjT3GB.

## Status and open items

- Pilot with Montex: 2–3 weeks alongside their old process; they send screenshots of problems.
- Known gaps: Production "Plan" tab is view-only; Order Tracker "Material / heat allocation" step has no input yet; order-level invoice paid amount is not updated by customer payments (customer dues are).
- Possible next work (owner to choose): move code to `main` (then change Render's branch); custom domain.
