# Shoreline Watch Agent Instructions

## Repository workflow

- GitHub is the source of truth for this project.
- Always start work from the latest `main` in `BaxMauer/shoreline-watch`.
- Do not use chat attachments, local snapshots, archives, or bundles as the current source unless the user explicitly requests recovery/import work.
- For normal changes, create a dedicated branch from `main` and open a pull request back to `main`.
- Do not push directly to `main` unless the user explicitly requests it for that task.
- Keep commits small, intentional, and limited to the requested scope.
- Keep `main` deployable.

## Validation

For code changes, run before marking work ready:

1. `npm run lint`
2. `npm test`

Run `npm run validate:artifact` when build output, deployment artifacts, PWA/service-worker behavior, or packaging changes.

Never claim a check passed unless it was executed successfully. If a check cannot be run, say why in the pull request.

## Tests

- Add tests for new behavior where practical.
- Bug fixes should include a regression test where practical.
- Changes to routing, shoreline distance, warning thresholds, startup behavior, hysteresis, speed rules, or geolocation recovery should include focused boundary/failure tests.
- Do not remove existing tests merely to make a change pass.

## Release versioning

- `package.json` is the single source of truth for the user-facing Shoreline Watch release version.
- Use stable semantic versions in `major.minor.patch` form.
- Every pull request with production-affecting source, asset, build, or runtime changes must increase the release version above the pull request's current `main` base version.
- Documentation, GitHub workflow, and test-only changes do not require a release version bump.
- Choose the SemVer increment intentionally: patch for compatible fixes, minor for compatible user-facing functionality, and major for incompatible changes.
- Do not hard-code a second release number in application code. The build injects the package version into the user-facing app.
- Treat a failed release-version check as a blocking CI failure rather than bypassing it.

## Implementation

- Read the relevant implementation and existing tests before editing behavior.
- Reuse existing project abstractions and conventions where practical.
- Avoid unrelated refactors or cleanup unless required for the task.
- Keep technical documentation, code comments, commit messages, and pull request descriptions in English unless user-facing localization requires another language.
- Do not commit temporary restore/import files, bundles, logs, secrets, or local environment files.

## Pull requests

Every pull request should state:

- what changed;
- why it changed;
- checks/tests executed and their result;
- known risks, limitations, or follow-up work.

For normal development work, automatic merge is the default. Once all required CI checks and tests for the pull request have completed successfully, enable or allow auto-merge so the pull request is merged into `main` without waiting for a separate manual approval. Do not auto-merge when required checks are missing, failing, skipped without justification, or when a known unresolved risk remains.

After a successful merge to `main`, the application should be deployed automatically through the repository's deployment pipeline. Treat deployment as part of completing the change: verify that the deployment workflow succeeds, and surface any deployment failure instead of claiming the change is complete.

If the user explicitly asks to hold a pull request for review, require manual approval, or prevent deployment, follow that instruction instead of the automatic flow.
