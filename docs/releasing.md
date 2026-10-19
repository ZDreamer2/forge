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

`publish.yml` runs on pushes to `master`. It reads `package.json` and checks the
public registry: existing versions skip release; an unpublished version invokes
the same CI gate, downloads its own run's artifact, verifies package
name/version/SHA-512, dry-runs and publishes with provenance. Registry/network or
malformed-response errors fail closed. Ordinary commits still run `ci.yml`, but
release nothing unless the manifest version is unpublished. No version is bumped
automatically; merging/pushing a version bump authorizes its release.

Manual dispatch on `master` remains available with an exact version input and
`publish=false` by default; only `publish=true` publishes in manual mode. A manual
run for an existing version verifies/builds the source and validates the artifact,
but skips npm's dry-run because npm rejects even dry-run republishing. An explicit
manual attempt to publish an existing version is rejected by the guard.
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

1. Update the exact package version and release notes; check and review before
   pushing/merging to `master`: that push automatically releases an unpublished
   version after verification. During `0.x`, breaking policy changes require a
   minor version and migration notes plus consumer type/routing checks.
2. Watch the Publish workflow. If checks fail, fix the source and push again with
   the same unpublished version; no additional version bump is needed.
3. Verify registry metadata, tarball integrity, trusted-publishing provenance and
   a fresh registry consumer. Manual dry-runs remain available, but cannot pause
   or replace automatic publication of a version bump on `master`.

Never overwrite/remove a published version. If npm reports an existing version
or returns a temporary 404 after an accepted publication, inspect registry/run
evidence before retrying; do not blindly republish or bump versions.
