# ⚠️ Test login — how it works and how to remove it

A development-only sign-in that logs you in as **any user, by email, with no
credential**. It exists so the app can be tried as different people — member vs
admin, different branches, accounts without post permission — without needing
their Google accounts.

It is an authentication bypass. Everything below is about making sure it never
reaches production and comes out cleanly when it is no longer wanted.

## Using it

1. `ALLOW_TEST_LOGIN=true` must be in `backend/.env` (already added).
2. Run the app normally. The login page shows a dashed **テストログイン（開発用）**
   section under the Google button.
3. Type an email, or pick from the dropdown — it lists every user with their
   department, branch, and whether they can post, so you can pick the case you
   want to see.

The session it creates is a real one: the same cookies as a Google sign-in, so
every permission, branch filter and visibility rule behaves exactly as it does
for that user. Sign out normally to end it.

## Why it cannot reach production

Three independent barriers, any one of which is enough:

| Barrier | Effect |
|---|---|
| `NODE_ENV === 'production'` | Route is never mounted — the URL 404s |
| `ALLOW_TEST_LOGIN` not exactly `'true'` | Route is never mounted — the URL 404s |
| Frontend `import.meta.env.DEV` | `npm run build` strips the UI from the bundle |

The backend gate is checked twice: once when deciding whether to mount the
router, and again inside the handler, so mounting it by mistake still refuses.

When enabled, the server prints a warning banner at startup, and every use is
written to the audit log as `TEST_LOGIN` so a test session is never mistaken
for a real sign-in later.

**Do not set `ALLOW_TEST_LOGIN` in the production environment.** Leaving it
unset is enough; there is no need to set it to `false`.

## Removing it completely

Four edits, no other file references it:

1. Delete `backend/src/routes/testLogin.ts`
2. In `backend/src/index.ts`, delete the two marked spots:
   - the `import { testLoginRouter, testLoginEnabled }` line
   - the `if (testLoginEnabled()) { … }` block
3. In `frontend/src/pages/Login.tsx`, delete the two marked spots:
   - the `{import.meta.env.DEV && <TestLogin onDone={login} />}` line
   - everything below the `// ⚠️ TEST-ONLY LOGIN — everything below this line`
     comment (the `TestLogin` component and the `TestUser` interface)
4. Remove `ALLOW_TEST_LOGIN` from `backend/.env`

Then `npm run build` in both `backend/` and `frontend/` to confirm nothing else
referenced it.

To find every trace: `grep -rn "TEST_LOGIN\|testLogin\|test-login" backend/src frontend/src`
