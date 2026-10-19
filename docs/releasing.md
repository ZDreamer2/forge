# Release operations

## Release notes

- `0.1.1`: validates GitHub Actions trusted publishing and provenance. No runtime,
  policy-contract or toolchain changes from bootstrap `0.1.0`.
- `0.1.0`: initial MIT policy-contract/diagnostic prototype.

## Release boundary

This public MIT package is a provisional policy-contract/diagnostic prototype,
not a server or review UI. Review both source history and the packed artifact for
private material before upload. Package contents are limited to built `dist/`,
package metadata, README and LICENSE; no install hooks run.

`ci.yml` checks pushes to `master`, PRs, manual runs and reusable calls. It installs
the frozen pinned toolchain, runs type/lint/graph/tests and a clean tarball consumer
(which builds explicitly), then packs the checked source. The tarball and
`pack.json` are retained as `npm-package-<commit SHA>` for 14 days.

`publish.yml` requires `master` and an exact version input. It invokes that same
CI gate, downloads its own run's artifact, verifies package name/version/SHA-512,
and dry-runs publication. Only an explicit `publish=true` dispatch publishes.
Publication attempts are serialized without cancellation. No automatic tags or
GitHub Releases are created.

Actions are SHA-pinned; checkout retains no Git credentials. Verification has
read-only permissions; only the publishing job has `id-token: write`. It installs
no package dependencies and publishes with lifecycle scripts disabled. OIDC uses
GitHub-hosted runners, npm 11.19.0 and no npm secrets. Keep the package repository
URL aligned with `ZDreamer2/forge` for provenance.

## Initial bootstrap (owner authentication)

The package must exist before npm trusted publishing can be configured. After
explicit publication approval and successful CI/dry-run on the release commit:

```sh
RELEASE_DIR="$(mktemp -d)"
gh run download RUN_ID --repo ZDreamer2/forge \
  --name npm-package-COMMIT_SHA --dir "$RELEASE_DIR"
```

Inspect `pack.json` for `@zdreamer/forge`, `0.1.0`, the expected allowlist and
integrity. Publish the unchanged checked tarball using Node 24 and npm 11.19.0:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish "$RELEASE_DIR"/zdreamer-forge-0.1.0.tgz \
  --ignore-scripts --access public --registry=https://registry.npmjs.org/
```

The owner handles browser authentication and 2FA; never put credentials or OTPs in
source, logs or chat. Confirm the identity is `zdreamer`. Agent publication needs
explicit permission and existing access; the agent cannot handle interactive
account security. Bootstrap has no CI-generated OIDC provenance. Remove local
publishing access with `npm logout` afterward when authorized by the owner.

## Trusted publisher and later releases

Prepare the next unused version (normally `0.1.1`) and a successful dry-run before
configuring the publisher: a new publisher must complete a publication within two
days or be recreated. On npmjs.com, package Settings → Trusted Publisher → GitHub
Actions, set:

| Field | Value |
| --- | --- |
| Organization or user | `ZDreamer2` |
| Repository | `forge` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty |

Use the filename, not `.github/workflows/publish.yml`. No publishing token or
GitHub environment is used. See <https://docs.npmjs.com/trusted-publishers/>.

For each subsequent release:

1. Update the exact package version and release notes; check, review and push to
   `master`. During `0.x`, breaking policy changes require a minor version and
   migration notes plus consumer type/routing checks.
2. Dispatch Publish on `master` with that version and `publish=false`.
3. After success, explicit approval and publisher setup, dispatch with
   `publish=true`.
4. Verify registry metadata, tarball integrity, trusted-publishing provenance and
   a fresh registry consumer. A dry-run proves neither npm authorization nor OIDC.

Never overwrite/remove a published version. If npm reports an existing version
or returns a temporary 404 after an accepted publication, inspect registry/run
evidence before retrying; do not blindly republish or bump versions.
