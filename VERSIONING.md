# Shoreline Watch Release Versioning

`package.json` is the single source of truth for the user-facing Shoreline Watch release version.

Use stable semantic versions in `major.minor.patch` form:

- patch: backwards-compatible bug fixes and safety corrections;
- minor: backwards-compatible user-facing functionality;
- major: incompatible behavior or data-contract changes.

Pull requests containing production-affecting source, asset, build, or runtime changes must increase the package version above the pull request's current `main` base version. CI enforces this with `npm run version:check`.

Documentation, GitHub workflow, and test-only changes do not require a release bump.

The client receives the package version through the build configuration. Do not add a second hard-coded release number in application code.
