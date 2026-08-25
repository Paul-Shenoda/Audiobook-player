---
type: process
status: verified — 2026-08-25, commit 3248c21
consumes: [master branch]
produces: [GitHub Pages site]
---

# deploy

A push to `master` builds and publishes the app to GitHub Pages, live within
about a minute.

## Input → Movement → Output

`.github/workflows/deploy.yml` triggers on `push: branches: [master]` (or
manual `workflow_dispatch`), runs `npm ci && npm run build`, and publishes
`dist/` via `actions/deploy-pages`.

## Why this shape

This is the app's only deployment path and its only production environment
— there is no staging server, no backend. This is exactly why larger,
multi-file changes in this repo get built and merged on a separate feature
branch first: **every push to `master` goes live**, so a half-finished
cross-file change (e.g. a new settings data shape landing before the
Settings UI that reads it) would ship broken to real users, not just fail a
review.

## Steps

1. Trigger: push to `master`. `.github/workflows/deploy.yml:4-5`
2. `npm ci` (exact lockfile install) then `npm run build` (Vite production
   build — see `vite.config.js` for the `worker.format: 'es'` and
   `workbox.globIgnores` settings the Kokoro provider specifically needs to
   build correctly). `:28-30`
3. `actions/upload-pages-artifact` uploads `dist/`, `actions/deploy-pages`
   publishes it. `:32-34, 43-44`

## If you change this

- **Hits:** literally every file in `dist/` after a build — this is the
  single choke point for "is this actually live yet."
- **Does not hit:** any branch other than `master` — pushing to a feature
  branch never triggers this workflow, which is exactly why staged
  multi-file work uses one.

## Surfaces

| Surface | Role |
|---|---|
| GitHub Actions | runs the workflow |
| `vite.config.js` | defines what `npm run build` actually does |

## See

- Source: `.github/workflows/deploy.yml`, `vite.config.js`
