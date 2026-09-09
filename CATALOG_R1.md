# Catalog R1 API — executor handoff

This local target requires an independent top-level audit together with frontend commit `2c35e542fd0845cebc966642a95da7e39f9a2ddc`. No push, PR, merge or deploy was performed. Preview credentials are shared with Production; do not publish this branch until safe isolation is proven.

`/api/orders` is a retired writer and returns an update-required response. The sole new checkout authority is the existing frontend function. Product GET returns Firestore updateTime as `version`; PATCH accepts only `version`, `intent` and `changes`, validates an allowlist, and verifies the version inside a transaction. Publication is a separate intent. Old clients get 428; stale edits get 409. No catalog migration is required. Existing unknown fields, legacy titles and untouched image/variant arrays are preserved.

Native gates remain typecheck, 12-function limit and **both dependency audits**. Both audit gates fail on the unchanged dependency graph; they must not be bypassed. No dependency or lockfile was updated. Tests run the real handler/auth SDK and concurrent Firestore transactions. They now fail if emulators are absent instead of skipping persistence coverage.

CI obtains only declared emulator tooling from the exact paired frontend commit. That commit must first be safely available remotely. The local equivalent (from this API checkout, with the paired frontend next to it) is:

```
npm run typecheck
npm run check:vercel-functions
JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' node ../frontend/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only firestore,auth --project demo-mutter-r1 --config ../frontend/scripts/catalog-emulators.json "npm test"
npm run audit:prod
npm run audit:all
```

The frontend's `CATALOG_R1.md` contains the full compatibility matrix and rollout/rollback procedure. Neither deployment order closes all old writers atomically. Effective Production Rules also permit direct customer-created orders with invented totals. Resolving Rules, safe Preview isolation and any necessary purchase pause/bridge requires Cerebro coordination; no such settings or data were changed here. MG-PAY-01 (payment confirmation, reservation and stock deduction) remains outside this repair.

## Private recovery scripts

Scripts under `scripts/catalog-r1/` use only existing Vercel configuration and read-only Firebase/ImageKit access. No credentials are printed or persisted. Backups are accepted only in the designated private directory outside both public repositories. Do not attach their data or product IDs to a PR.

- `backup.mjs`: complete paginated catalog/relationships export preserving Firestore types and updateTime, then a second version/path pass; backup/PITR metadata; ImageKit metadata.
- `backup-images.mjs`: original bytes via `tr=orig-true`, size checks and SHA256 mapping.
- `verify-images.mjs`: second library metadata pass and bounded original-URL recovery for references absent from that library.
- `restore-local.mjs`: create-only recovery and complete field/type/hash verification against fixed loopback emulator and demo project. `--verify-only` rereads an existing local recovery without overwriting it. Run with a credential-free environment and OS network restriction allowing loopback only.
- `environment-read.mjs`: private effective Rules readback. The paired frontend script reproduces the unsafe rule in its own synthetic emulator project.

The final private manifest, not an early interrupted download log, is the authority for coverage. All exported document fields and referenced bytes were verified locally; 126 image references lack library metadata/fileId despite recoverable original bytes. That limitation remains explicit. The paginated export and downloads are not atomic/PITR. No restore to Production, ImageKit upload/deletion or massive publication/stock changes occurred.
