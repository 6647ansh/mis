# Montex MIS — Audit & Decisions (Phase 1 of the Blueprint Roadmap)

Audit date: 2026-10-26. Scope: the code on branch `claude/restore-folder-structure`
(React 19 + Vite 8 + TypeScript, Tailwind v4, Firebase Auth, Cloud Firestore,
Realtime Database, Express backend in `server.ts`).

This document records what the code does today, the root causes of the bugs listed
in the blueprint (section 6), and the decisions taken with the project owner.

## 1. Decisions (confirmed with owner, 2026-10-26)

| Topic | Decision |
|---|---|
| Source of truth | **Cloud Firestore only.** Realtime Database is retired after a one-time migration. |
| Sign-in | **Google Sign-In only.** Email/password login, password reset and self-registration are removed. |
| Signed-out experience | **No demo mode.** Signed-out visitors see only the sign-in page: no dashboard, no sample data, no role switcher. |
| Hosting | Not live yet. Code is fixed first; the deployment setup comes later. |

## 2. Current architecture (as found)

- `src/context/RtdbContext.tsx` (3,405 lines) owns auth, the user profile, all 27
  business collections, and every write. Every module reads from this one context,
  so any change re-renders the whole app.
- Business data loads through `firestoreCutoverService.loadProductionSnapshot()`, which
  reads collections **once** (`getDocs`). The app is not real-time: a change made by
  one user is only seen by others after a manual refresh.
- The same snapshot then reads the matching Realtime Database paths and merges them
  "by ID with Firestore precedence" (`reconcileRecordsById`), so two databases feed
  every screen.
- `server.ts` exposes `/api/admin/employees/*` and `/api/admin/system/initialize`.
  Both are protected by `verifyFirebaseToken` (signature + revocation check) and
  `requireSuperAdmin`. The server needs a Firebase Admin service account. Without
  one it fails closed with `503 ADMIN_SDK_NOT_CONFIGURED`, and the client then falls
  back to writing directly from the browser.

## 3. Findings

### 3.1 Security

| # | Finding | Severity | Where |
|---|---|---|---|
| S1 | Signed-out visitors get a full **Super Admin** workspace (demo data) and a role switcher. Data is sample-only, but it teaches users that the UI is the gate, and it ships all module code to anonymous visitors. | High | `RtdbContext.tsx` `onAuthStateChanged` → `PROTOTYPE_USERS[0]`; `Header.tsx` role switcher |
| S2 | **Two authorization systems.** `firestore.rules` enforce 8 granular roles; `database.rules.json` (RTDB) group 4 roles into `'Production'`. Data that is safe in Firestore can still be read or written through RTDB under the looser rule. | High | `database.rules.json` |
| S3 | The client "self-heals" its own profile: if the merged profile looks active but Firestore disagrees, it calls `syncOwnActiveProfileToFirestore`. Rules block most of this, but the client should never write its own status. | Medium | `RtdbContext.tsx` ~L840 |
| S4 | Owner bootstrap is hard-coded to one email in rules, client and server. That works, but it is a single point of trust. Keep it, but limit it to first-run bootstrap and audit-log every use. | Low | `firestore.rules` `isBootstrapOwner`, `RtdbContext.tsx` |
| S5 | Every active user can `get`/`list` every sales order (prices, customers). The blueprint asks for "show only role-relevant information"; read scopes per role are an open question for Montex. | Open | `firestore.rules` `/salesOrders` |
| S6 | Email/password sign-up creates Auth accounts from the browser. This is removed by the Google-only decision. | Medium | `registerOrBootstrapUser` |

### 3.2 Blueprint known bugs — root causes

| Blueprint bug | Root cause found |
|---|---|
| **Employee rejection: "Missing or insufficient permissions"** | Rejection tries the server API first. When the Admin SDK is not configured (always, outside production), it falls back to **two** browser writes, to Firestore and to RTDB. Either write can be refused by its own rule set (S2), and the error shown is whichever failed last. |
| **Rejected status comes back as pending** | On sign-in the profile is read from **both** stores and merged by comparing `updatedAt` strings written by different clients' clocks (`RtdbContext.tsx` ~L780–800). If the rejection reached only one store, the other store's older `pending_approval` can win, or the pending request is re-created by `upsertSelfPendingAccessRequestToFirestore`. **Fix: one store (Firestore) and server-side status changes.** |
| **Quality quantity mismatch (500 inspected, 500 passed, 8 rejected)** | The UI validator (`misDataValidator.ts` L172) checks `passed + rejected ≤ inspected`, but **`firestore.rules` does not**: `qualityInspections` only checks that each quantity is ≥ 0. Any write path that skips the UI validator stores an impossible lot. **Fix: enforce in rules, and show the discrepancy instead of correcting it.** |
| **Laggy UI** | (a) one 2.7 MB JavaScript bundle, with no route-level code splitting (all 15 modules, jsPDF, XLSX and html2canvas load up front); (b) one context holds all data, so any update re-renders every module; (c) each refresh reads all collections from two databases. |
| **Generic messages** | Errors bubble up raw Firebase codes plus internal paths, for example `CANONICAL /USERS/{UID} GOVERNANCE`. |

### 3.3 Data and "live" behaviour

- Reads are one-time snapshots, not live listeners. To meet "saari cheezein live
  chalein", each module will subscribe with `onSnapshot` to only the collections
  it shows, with role-scoped queries and cleanup on unmount.
- `mockData.ts` and `requirementsRegister.ts` still hold demo fixtures. These are
  used only in demo mode and are removed from the production bundle with it.

## 4. Plan (blueprint roadmap order)

1. **Security gate** — remove demo mode, Google-only sign-in, and screens for
   pending, rejected and deactivated accounts. (S1, S6)
2. **Firestore only** — delete RTDB reads, writes and merging; add a one-time,
   admin-run RTDB → Firestore migration script. (S2, S3, rejection bugs)
3. **Rules** — quality quantity invariant; per-role read scopes once confirmed;
   rule tests on the Firestore emulator.
4. **Design system and cover page** — navy + bronze tokens, shared components,
   ⌘K command palette, premium Google sign-in page with the official logo.
5. **Live data and performance** — per-module `onSnapshot`, lazy-loaded modules
   and export libraries, before/after measurements.
6. **Module UI** — role-relevant content and actionable alerts (what happened /
   why it matters / what next / where to fix).

## 5. Questions still open for Montex (blueprint section 9)

Asked one by one as each module is reached; nothing is assumed:

- Who may approve or reject employees (Super Admin only, or the CEO too)?
- Which roles may see prices, customers and finance figures in sales orders (S5)?
- Is quality acceptance and/or finance clearance mandatory before dispatch?
- Which KPIs and alerts belong on the 9 AM command-center screen?
- Which existing data (RTDB or Firestore) is real production data to migrate?
- Is there a higher-resolution official logo file? The repository copy is 147×102 px.
