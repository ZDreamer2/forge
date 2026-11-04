---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge application verification

## Temporary: checker transition

The sections below define the intended verification contract. The server checker
runs `check:server`; UI and installation checkers still invoke root `check`, and
`check:ui` also builds the server. Until the remaining scoped checker bindings and
script separation are implemented and verified, a passing root `check` is required
for acceptance. A passing automatic root `check` invocation can satisfy this
requirement; separate execution is unnecessary. Report failures in
other checker invocations even when root acceptance passes. This temporary rule
overrides the local-acceptance rule below. Remove this section when the transition
is verified.

## Application context

Server, UI and installation tooling are separate codebases sharing one package,
lockfile and release artifact. Apply this application-wide guidance alongside the
selected component's build guidance.

Run `forge-workspace-diff-check` from the workspace root. Run the pnpm commands
below from the Forge installation root (`library/tools/forge`), with its `.nvmrc`
Node selected. The [README](../../README.md#develop) owns pinned tooling,
frozen dependency installation and explicit browser setup. Checks install nothing.

## Automatic verification

`forge-workspace-diff-check` invokes each affected selected codebase's personal
checker. Inherited guidance does not automatically invoke parent checkers.

- UI: frontend structure/collection, types, lint, architecture, behavior tests and
  frontend build.
- Server: server and API-contract types, lint, architecture and behavior tests.
- Installation: package/configuration and shared tooling validation, packaging and
  packed installed API/browser integration.

Use the CLI's execution report and findings to determine what actually ran and
passed; process completion alone is not validation success. Successful personal
checks establish their reported coverage, not complete task acceptance.

## Additional verification

Builders MUST verify affected consumers and application behavior not covered by
passing personal checks. Source ownership determines automatic routing; it does
not limit verification responsibility.

After `forge-workspace-diff-check`, compare its reported coverage with the change's
effects. Run the missing verification using:

```sh
corepack pnpm --config.verify-deps-before-run=error run <script>
```

| Change or remaining verification need | Script to run if not already covered |
| --- | --- |
| API-contract changes, including server-only edits affecting the UI consumer | `check:ui` for consumer types and UI behavior; add or update tests for affected behavior |
| Shared dependencies, compiler, lint, architecture or build configuration | `check:server` and/or `check:ui` for affected components; use `check` when effects span the installation or are unclear |
| Package contents, startup, asset delivery or server/UI integration | `test:workspace` for a fresh build, pack and installed API/Chromium acceptance |
| Complete application acceptance, including shared tooling/configuration | `check` |

`check:server` and `check:ui` provide the component coverage listed above.
`test:workspace` verifies delivery and integration, not the component source
suites. Requirements combine: a contract change affecting delivered integration
needs both UI consumer verification and installed acceptance when neither was
already covered.

During implementation, `test:ui` provides focused UI behavior feedback; it does not
replace `check:ui`. Choose further behavioral verification from component guidance
and the change's effects.

Checks already passed against the resulting content need not be repeated. For
example, after a server-only contract change whose automatic check covered the
server suite, run `check:ui` to cover its consumer. If the automatic report already
shows a passing root `check`, no additional command is needed for that coverage.
Rerun checks whose inputs changed afterward.

## Acceptance

Root `check` composes complete source, build, packaging and installed API/browser
acceptance. Use it for complete application verification and wherever CI or release
procedures require it; it is not required after every local change when the
applicable verification above is complete.

The finish report MUST identify completed automatic and supplementary verification,
and disclose required checks that failed or remain unperformed. Narrower tests do
not substitute for unavailable integration or browser acceptance.
