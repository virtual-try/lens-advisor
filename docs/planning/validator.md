# Validator output — final (2026-11-07)

`python3 ~/.claude/skills/plan-project/scripts/validate-specs.py specs`

```
Validating /home/shazy/Documents/pt/lens-advisor/specs  (35 specs)

Parallel schedule  (10 waves · widest 9 · 35 specs)
  W0  00
  W1  01
  W2  02 03 04 05 06 07 08 09
  W3  10 11 12 13 14 15 16 25
  W4  17 20 21 22 24 26 27 28 31
  W5  18 19 23 29
  W6  30
  W7  32
  W8  33
  W9  34

00-stack-and-architecture-decision.md
  WARN   Status is 'Done' but no GitHub issue is recorded

01-scaffold.md
  WARN   creates '.env.example' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'pnpm-workspace.yaml' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'render.yaml' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'shopify.app.toml' but no other spec mentions it — check it is not an endpoint or component with zero callers

05-field-encryption.md
  WARN   creates 'app/shared/crypto/field-cipher.server.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

08-job-queue.md
  WARN   creates 'app/shared/container/queue.server.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

15-shop-settings-service.md
  WARN   creates 'app/features/settings/settings.repository.server.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

18-admin-lenses.md
  WARN   creates 'app/features/catalog/components/lens-form.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.lens-groups.$id.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.lenses.$id.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.lenses._index.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   Depends on 13, 14 is already implied through another dependency

19-admin-options-addons.md
  WARN   creates 'app/features/catalog/components/option-value-form.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.add-ons.$id.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.options.$id.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.options._index.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   Depends on 13, 14 is already implied through another dependency

20-admin-settings.md
  WARN   creates 'app/routes/app.settings.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers

21-proxy-catalog-endpoint.md
  WARN   creates 'app/routes/proxy.catalog.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

22-proxy-prescription-endpoints.md
  WARN   creates 'app/routes/proxy.prescriptions.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/proxy.upload-url.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

23-orders-webhook.md
  WARN   creates 'app/features/lab-orders/intake.service.server.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/webhooks.orders.create.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   Depends on 02 is already implied through another dependency

24-lab-ticket-renderer.md
  WARN   Depends on 03 is already implied through another dependency

25-compliance-webhooks.md
  WARN   creates 'app/routes/webhooks.app.uninstalled.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/webhooks.compliance.ts' but no other spec mentions it — check it is not an endpoint or component with zero callers

29-step-review-add-to-cart.md
  WARN   Depends on 13, 16 is already implied through another dependency

30-lab-order-dispatch.md
  WARN   Depends on 05, 06 is already implied through another dependency

31-admin-home-setup.md
  WARN   creates 'app/routes/app._index.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers

32-admin-lab-orders.md
  WARN   creates 'app/routes/app.lab-orders.$id.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   creates 'app/routes/app.lab-orders._index.tsx' but no other spec mentions it — check it is not an endpoint or component with zero callers
  WARN   Depends on 06 is already implied through another dependency

35 specs · 0 error(s) · 34 warning(s)
Warnings are not blocking — justify each one in README.md under 'Known gaps', or fix it.
```

All warnings are accepted in `specs/README.md` → Known gaps.
