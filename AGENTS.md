# Shoreline Watch Agent Instructions

## Source and scope

- `BaxMauer/shoreline-watch` on GitHub is the source of truth. Start from the latest `main`.
- Ignore old attachments, snapshots, archives, and bundles unless recovery/import is explicitly requested.
- Read the relevant implementation and tests before changing behavior.
- Use a dedicated branch and pull request. Never write directly to `main` unless explicitly requested.
- Keep changes scoped, reuse project conventions, avoid unrelated refactors, and keep `main` deployable.
- Never commit temporary files, bundles, logs, credentials, secrets, or local environment files.
- Use English for technical docs, comments, commits, and pull requests; localize user-facing text as required.

## Caveman mode (default)

- Keep progress updates and final responses terse and factual.
- Do not repeat the request, narrate routine tool/Git steps, paste raw logs, or restate diffs.
- Report only outcomes, blockers, validation, pull request, merge, and deployment status. Add detail only when needed for a decision or failure.
- Use a one-line imperative commit subject, preferably no more than 72 characters. Add a body only when necessary.
- Keep pull request descriptions to compact `Summary`, `Validation`, and `Risks` sections, with at most two bullets each.
- Do not use subagents unless the user requests them or independent parallel work has a clear benefit.
- Batch independent reads and checks. Avoid redundant rereads and reruns, but always complete required final validation.
- Safety, correctness, and required evidence override brevity.

## Validation and tests

For code changes, run:

1. `npm run lint`
2. `npm test`

Also run `npm run validate:artifact` when build output, deployment artifacts, PWA/service-worker behavior, or packaging changes.

- Add tests for new behavior and regression tests for fixes where practical.
- Routing, shoreline distance, geolocation recovery, warnings, startup suppression, hysteresis, and speed rules require focused boundary and failure tests.
- Never remove tests merely to make a change pass.
- Never claim a check passed unless it ran successfully. If a required check cannot run, state why in the pull request.

## Release versioning

- `package.json` is the single source of truth for the user-facing SemVer version.
- Production-affecting changes must raise the version above the pull request's `main` base: patch for fixes, minor for compatible features, major for incompatible changes.
- Documentation, workflow, and test-only changes need no version bump.
- Do not duplicate the version in application code or bypass a failed version check.

## Delivery

- Open a pull request to `main`.
- When required CI is green and no blocking risk remains, enable auto-merge or merge without waiting for manual approval.
- After merge, verify the automatic deployment. Investigate and fix CI, merge, or deployment failures.
- If the user explicitly requests a hold, manual review, or no deployment, follow that instruction.
