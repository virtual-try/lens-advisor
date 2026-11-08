# Spec 35 — Fix: Web feature jobs glob fallback outside Vite

**Status:** Not started
**Depends on:** Spec 08, Spec 33
**Model:** Light — `claude-haiku-4-5` · `gpt-5-mini` · `gemini-2.5-flash`
**Issue:** —
**Owns:** `app/shared/queue/web-definitions.server.ts`
**Reuses:** `app/shared/queue/discovery.server.ts`

## Goal

`app/shared/queue/web-definitions.server.ts` unconditionally calls `import.meta.glob<Record<string, unknown>>("../../features/*/jobs.server.ts", { eager: true })`. While this works when bundled by Vite (client and production server builds), in runtime environments executing outside Vite (such as Node.js in-process test harnesses or CLI scripts), `(import.meta as any).glob` is undefined and throws `TypeError: (intermediate value).glob is not a function`.

Provide a safe fallback in `web-definitions.server.ts` so that if `import.meta.glob` is not defined at runtime, it falls back to static feature job registrations or filesystem discovery (`discovery.server.ts`), allowing in-process route execution without bundler dependency.

## Scope

- In `app/shared/queue/web-definitions.server.ts`, detect if `typeof (import.meta as any).glob === "function"`.
- If available (Vite build), use `import.meta.glob`.
- If unavailable (Node runtime), statically import or load feature jobs so that `getQueue()` succeeds.

## Done when

- [ ] `web-definitions.server.ts` executes in plain Node/Playwright without throwing `TypeError: (intermediate value).glob is not a function`. [unit]
- [ ] Spec 33 Flows 11 & 12 in `e2e/server/orders.spec.ts` can be un-annotated from `fixme` and pass. [e2e]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
