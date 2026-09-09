# Catalog R1B API — local-only audit target

No push, PR, merge, deploy, remote settings, effective Rules or production records were changed. R1 is an immutable ancestor; the paired final frontend commit is pinned in `.github/workflows/ci.yml`. The new Rules file is a candidate only. Review the paired frontend's CATALOG_R1B.md and the local R1B environment/transition plan before any continuation.

## Dependency remediations

Base and R1 have exactly the same mandatory thresholds: `audit:prod = npm audit --omit=dev --audit-level=moderate`, `audit:all = npm audit --audit-level=high`. Neither changed. Direct SDK/tool versions are unchanged: firebase-admin 13.9.0, @vercel/node 5.8.0, tsx 4.21.0, TypeScript 5.9.3. No new functional dependency, SDK major, global upgrade, audit exclusion or force repair was used.

The executor retrieved the official npm metadata/integrities and 36 GitHub advisory records; the date-stamped graph, advisory sources and exact lock delta are outside the public repo in R1B evidence. These are dependency findings, not a diagnosis of exploitation. Minimal fixed versions are pinned to avoid changing unrelated graph nodes:

| Package before → after | Consumer / reason |
|---|---|
| @grpc/grpc-js 1.14.1 → 1.14.4 | Firestore/google-gax; GHSA-5375-pq7m-f5r2 and GHSA-99f4-grh7-6pcq |
| protobufjs 7.5.8 → 7.6.5 | Firestore/gRPC/serializer; GHSA-wcpc-wj8m-hjx6, GHSA-f38q-mgvj-vph7, GHSA-j3f2-48v5-ccww |
| @tootallnate/once 2.0.0 → 2.0.1 | HTTP proxy agent under Google request stack; GHSA-vpq2-c234-7xj6 |
| form-data 2.5.5 → 2.5.6 | Google HTTP stack; GHSA-hmw2-7cc7-3qxx |
| websocket-driver 0.7.4 → 0.7.5 | Firebase database transport; GHSA-mp7j-qc5w-4988 and GHSA-xv26-6w52-cph6 |
| brace-expansion 5.0.6 → 5.0.9 | Existing minimatch override; latest fixed lower bound for its three reported advisories |
| fast-uri 3.1.2 → 3.1.6 | Existing ajv override; fixed lower bound for six reported advisories |
| js-yaml 4.1.1 → 4.3.2 | Vercel build-utils/python-analysis; fixed lower bound for four reported advisories |
| tar 7.5.15 → 7.5.21 | Vercel build tooling; fixed lower bound for six reported advisories |
| undici 6.25.0 → 6.28.0 | Vercel Node runtime/build boundary; fixed lower bound for seven reported advisories |
| nested UUID 8.3.2/9.0.1 → existing root 11.1.1 | Storage, gaxios, google-gax, teeny-request; GHSA-w5hq-g745-h8pq. See compatibility qualification below. |

Three required child updates accompany fixed parent manifests: @protobufjs/eventemitter and @protobufjs/fetch 1.1.0→1.1.1, hasown 2.0.2→2.0.4. @protobufjs/inquire is no longer required by protobufjs; obsolete nested UUID copies disappear by resolution/deduplication. No used SDK is excluded.

**UUID qualification:** 8/9→11 is a transitive utility major, not a semantic-version-compatible range update or an SDK upgrade. Version 11.1.1 was already fixed in R1 for firebase-admin; the override now also resolves the nested copies. Official versions show no fixed 8/9 backport. Source inspection found only named `v4()` without arguments in these Google consumers. The [official changelog](https://github.com/uuidjs/uuid/blob/v11.1.1/CHANGELOG.md) was reviewed for 9/10/11 changes; no default/deep import, v1/v7 options or old Node runtime is used at these boundaries. `tests/dependency-compat.test.ts` verifies each consumer's actual resolution, google-gax makeUUID, real gaxios and teeny-request multipart bodies and a Storage SDK metadata request, all against loopback HTTP. This provides compatibility evidence for the concrete runtime usage, not a claim that every UUID API is compatible. The active Node 22 requirement is preserved.

Package lifecycle metadata was inspected before installation. Only declared registry packages were restored with scripts disabled; protobufjs's postinstall only checks dependent version syntax. Existing Firebase util/esbuild/fsevents lifecycle entries remain; CI's native install command was not weakened. Lockfile reproduction and actual Vercel packaging are checked. Native audits are repeated independently and retain their real exit statuses.

## Validation and CI

Node 22 is selected in both workflows. Existing native typecheck/function-count/audit gates remain; the API additionally packages all 12 actual entries with its installed Vercel builder, no linking/env pull/deployment. The builder's generated local `.vercel/node/` manifest is ignored specifically, not committed.

The paired frontend provides declared emulator tools and its root `firebase.catalog-emulators.json`, selecting the candidate Rules. A direct authenticated Firestore PATCH is required to fail before the real admin handler GET/PATCH/conflict tests can pass; accidentally permissive emulator Rules cannot count as acceptance. SDK and concurrency tests continue to use real Auth/Firestore. The regression SDK utility test has no productive credential or external destination.

Run with the exact paired frontend beside this repository:

```
npm run typecheck
npm run check:vercel-functions
npm run check:packaging
JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' node ../frontend/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only firestore,auth --project demo-mutter-r1 --config ../frontend/firebase.catalog-emulators.json "npm test"
npm run audit:prod
npm run audit:all
```

Remote CI is not executed in this stage. Its cross-repo pin can resolve only after safe branch publication, which is still prohibited until the material configuration decision and coordinated continuation.

## Additional private recovery evidence

`scripts/catalog-r1b/read-environment.mjs` reads existing Rules and checks the configured MP account without storing credentials/account identities. It writes new private files with exclusive creation, preserving R1. `read-image-gaps.mjs` performs bounded name searches and original-delivery HEAD requests for the 126 gaps, not a full export/download. `verify-recovery.py` uses installed Pillow to verify signature/decode, catalog correspondence, exact local routes and all backed-up blob hashes. Run recovery with a clean environment and OS network restriction to loopback. It does not upload, change URLs, restore provider ACLs or modify the R1 manifest.

The result is recoverable image bytes and local references; ImageKit file IDs/history/namespace remain unverified, so `protectionComplete=false` stays. Existing MP credentials identify a normal MLU account rather than a verified isolated test seller; integration with the real provider remains pending. No provider preference was created.

A release still requires effective permission closure, safe branch/Preview handling across all four linked projects, remote CI, MP integration, recovery resolution, an approved safe transition, and a separate top-level audit. The detailed pause/bridge comparison and rollback plan are proposals, not applied changes. No rollback may reopen old orders/MP endpoints or overwrite catalog/orders/images.
