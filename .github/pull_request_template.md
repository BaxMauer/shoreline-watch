## What changed

<!-- Describe the user-visible and technical changes. -->

## Why

<!-- State the problem, decision, or open point this addresses. -->

## Validation

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run audit:production`
- [ ] `npm run validate:artifact` (when build, PWA, or packaging changed)

## Risk and delivery

- [ ] Safety-sensitive behavior is unchanged, or focused boundary/failure tests were added.
- [ ] No secret, generated runtime state, or local environment file is included.
- [ ] Known risks and follow-up work are documented below.
- [ ] After merge, the production candidate and Sites deployment will be verified.

Known risks or follow-up work: none.
