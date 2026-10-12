# Bounded dependency disposition, 2026-10-03

Busboy is resolved to official `@fastify/busboy@3.2.1` under Firebase Admin's
compatible `^3.0.0` range. The override pins that resolution without updating
Firebase, Auth, Firestore, the builder or commercial code. The dependency has
no install lifecycle scripts. `npm run test:busboy` tests the actual resolved
parser and Firebase Admin HttpClient with loopback responses. All pathological
cases execute in time/memory-bounded children. The test can also accept checkout
roots to exercise the storefront and functions installations with the same
consumer tests; no business credentials or provider calls are used.

Remaining **unaccepted** advisory: braces 3.0.3, GHSA-vfj7-8cjw-p6xm.
`@vercel/node@5.8.0` -> `ts-morph@12.0.0` (also through
`@vercel/static-config@3.3.0`) -> `@ts-morph/common@0.11.1` ->
`fast-glob@3.3.3` -> `micromatch@4.0.8` -> `braces@3.0.3`.
This is one direct advisory, propagated to seven packages by npm audit; it is
not seven independent vulnerabilities. The current compatible parent lines
still depend on braces. No official patched braces release exists at the
registry observation for this delivery. A broad builder migration or unpublished
patch is outside this correction.

The builder uses local entrypoint/configuration paths. Admin endpoints do not
accept glob expressions or call braces. Deeply nested attacker-controlled glob
patterns can exhaust the recursive parser stack; a hostile build configuration
or local input remains a precondition to investigate, not an accepted risk.
The final executor evidence distinguishes installed presence, builder file
traces and actual emitted files; absence of a package name in minified text is
not an absence proof. This assessment does not extend the storefront Edge
exception to Admin and does not authorize `vercel dev`.

Security jobs retain the exact native prod/all audit thresholds independently
of compatibility. A red required security job means the **whole CI is red**,
even when multipart, Firestore/Auth and packaging tests pass. Publication remains
blocked. An official bounded fix followed by these regressions is preferred;
any different residual-risk decision requires separate owner consideration and
independent review. This document grants no exception.

Sources: [Busboy boundary fix](https://github.com/fastify/busboy/security/advisories/GHSA-xjh9-v7x6-24jw),
[Busboy header fix](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx),
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
