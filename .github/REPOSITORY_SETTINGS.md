# Required GitHub repository settings

Repository files define CI and packaging, but GitHub must enforce the remaining
merge and security policy at repository level. The installed integration cannot
change these settings. As of 2026-08-13, the rulesets API also reports that this
private repository needs a GitHub Pro plan (or public visibility) before a
ruleset can be created.

## Main branch ruleset

Configure a ruleset targeting the default branch with these controls:

- require a pull request before merging;
- require the `Lint, typecheck, test, and build` status check;
- require the branch to be up to date before merging;
- block force pushes and branch deletion;
- apply the rules to repository administrators as well;
- allow GitHub Apps used by this repository to merge only after checks pass.

Human approval is not required by the current project workflow. The required CI
result is the merge gate, and automatic merge is the default after it passes.

## General settings

- enable **Allow auto-merge**;
- enable **Automatically delete head branches**;
- retain squash merging and disable merge commits and rebase merging;
- use `main` as the default branch.

## Security settings

- enable Dependabot alerts and Dependabot security updates;
- enable secret scanning and push protection when the repository plan supports
  them;
- keep the default workflow token read-only. Individual workflows request only
  their documented additional permissions.

## Repository metadata

Use these values once metadata write access is available:

- description: `Offline-first iPhone navigation aid for Croatian shoreline distance and water-route clearance.`
- homepage: `https://boot.maxi-bauer.de`
- topics: `croatia`, `gps`, `navigation`, `offline-first`, `pwa`, `shoreline`

No license should be added until the owner deliberately chooses one. The
coastline data attribution does not by itself determine a license for the
application source code.
