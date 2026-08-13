# Security policy

## Supported version

Only the latest commit on `main` and the corresponding production deployment
are supported.

## Dependency policy

- High or critical findings in production dependencies block CI and merging.
- The complete dependency tree is audited weekly and on demand.
- Moderate and low findings are reported and reviewed but do not block a merge.
- A high or critical development-only finding may pass only when its exact
  advisory ID is documented and allowlisted in `scripts/audit-dependencies.mjs`.
  New advisories on the same package still fail the audit.

Current temporary exceptions:

| Advisory | Dependency path | Exposure and mitigation |
| --- | --- | --- |
| `GHSA-5p2g-fcmc-qvqq` | `vinext` → `image-size` | Build-time dependency only; production audit is clean. Remove when Vinext publishes a patched chain. |
| `GHSA-w3rx-r6r6-pgpr` | `vinext` → `image-size` | Build-time dependency only; production audit is clean. Remove when Vinext publishes a patched chain. |

Dependency versions and GitHub Actions are updated by Dependabot. Actions are
pinned to full commit hashes so a moving tag cannot silently change CI code.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when it is
available. Do not publish exploit details in a public issue.
