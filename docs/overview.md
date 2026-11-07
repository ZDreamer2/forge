# Forge codebase overview

Forge is a workspace application for reviewing project changes in their codebase
context. This repository contains its server, standalone web UI, shared tooling and
distribution configuration. In BiCo it is checked out at `library/tools/forge/`;
the agent-facing Forge plugin is a separate codebase and distribution.

Use this document to orient repository work, then follow the relevant authority in
the documentation map below.

## Application shape

One repository publishes one `@zdreamer/forge` package with the `forge` executable.
One root pnpm installation owns dependencies, build tooling and aggregate acceptance;
server and UI are distinct source codebases, not workspace packages.

```text
Browser UI ------+
                 +--> Forge server --> Selected workspace configuration and files
Forge CLI -------+                    Declared Git repositories
```

Each server process serves one authoritative workspace checkout. It reads the
workspace's `forge-workspace.yaml`, exposes the HTTP API and serves the bundled UI.
The server owns workspace interpretation and operations. The UI owns browser
presentation and consumes only the browser-safe server API contract, rather than
reconstructing repository or codebase membership.

The application package and a project's installation of it have different lifecycles.
Source changes, package publication and adoption of a released version are separate
operations.

## Source map

| Path | Responsibility |
| --- | --- |
| `server/src/components/` | Workspace configuration, repository observation, canonical trees, analysis, API contract and HTTP operations |
| `server/src/app/` | Component composition, HTTP assembly and process lifecycle |
| `server/src/lib/` | Bounded Git execution and loopback access primitives |
| `ui/src/` | React routes, review components, browser data access and UI tests |
| `tools/` | Repository-wide checking, build/pack verification and installed-consumer acceptance |
| `docs/` | Application architecture, release operations and Forge guidance |
| `.github/` | Continuous integration and trusted publication workflows |
| `dist/` | Generated server JavaScript and bundled UI assets; the package publishes this output |
| Root manifests/configuration | Exact dependencies, TypeScript projects, lint and architecture rules, package exports and executable identity |

Server components keep their detailed design in component-local `docs/UnitGuide.md`
files. The application architecture owns their responsibility and dependency map.

## Documentation map

| Work | Read |
| --- | --- |
| Assign application responsibilities or change component interactions | [Application architecture](architecture.md) |
| Change observable server behavior, file access or API schemas | [Workspace server API](../server/docs/protocol.md) |
| Change review presentation, frontend data ownership or interaction state | [UI architecture](../ui/docs/architecture.md) |
| Work within a server component | Its local `docs/UnitGuide.md` |
| Set up, run, configure or check the application | [Forge README](../README.md) |
| Change publication or release operations | [Release operations](releasing.md) |
| Plan or implement repository changes through Forge | [Application planning](forge/on-plan.md) and [build guidance](forge/on-build.md), plus the selected server or UI guides |

## UI design prototype

The maintained [UI prototype](../ui/prototype/README.md) lives in
`ui/prototype/`. Prototype new UI features and interaction changes there first,
then implement the agreed design in the production UI. Keep the prototype and its
design notes up to date as the interface evolves; it is a current design sandbox,
not an archived issue artifact.

Open `ui/prototype/index.html` directly in a browser; no build or running Forge
server is needed. Its fictional data and simplified rendering support design
iteration, not verification of production API behavior or performance.

## Development and verification

The root installation supplies focused installation, server and UI checks as well as
the complete root `check` gate. Choose coverage according to the changed responsibility;
shared contracts and tooling also require verification of their real consumers. The
README owns the supported commands and their exact behavior.

Builds generate `dist/` from server and UI source. Installed-consumer acceptance packs
the application and exercises that artifact independently of source execution. Release
automation publishes only an explicitly versioned, verified package; installing that
release in a workspace remains a separate adoption step.
