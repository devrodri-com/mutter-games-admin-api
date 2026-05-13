# Supply Chain Hardening

## Current Baseline

This project uses npm with `package-lock.json` and reproducible installs through `npm ci`.

The repository enforces:

- exact direct dependency versions;
- npm version declaration through `packageManager`;
- npm `save-exact=true` for future dependency changes;
- production dependency audit in CI from moderate severity upward;
- full dependency graph audit in CI from high severity upward.

## Manual Security Actions

These actions must be completed outside this repository before considering the historical secret exposure fully remediated.

1. Rotate the Firebase service account key that appeared in the historical `.env.admin.dev` commit.
2. Disable or delete the exposed key in Google Cloud IAM.
3. Confirm GitHub secret scanning is enabled for the repository.
4. Verify Vercel environment variables are scoped correctly:
   - production secrets only in Production;
   - preview secrets only if backed by non-production resources;
   - no production Firebase or ImageKit private keys in Preview unless intentionally required.
5. Confirm only the intended Vercel project deploys production from `main`.

## Dependency Update Rules

- Use `npm install <package>@<version> --save-exact` for direct dependency changes.
- Keep `package-lock.json` committed with every dependency change.
- Do not use `latest`, `next`, `canary`, git URLs, tarball URLs, `file:`, or `link:` dependencies.
- Review new lifecycle scripts before merging dependency updates.
- Prefer small dependency PRs unless a security fix needs coordinated overrides.

## Validation Commands

Run these before merging supply-chain changes:

```bash
npm ci
npm run typecheck
npm run check:vercel-functions
npm run audit:prod
npm run audit:all
```
