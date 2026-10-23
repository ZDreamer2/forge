# Forge application installation verification

Run the pinned installation's aggregate commands from the repository root as
specified in the [README](../../README.md#develop). They cover the server and its browser-safe API contract,
cross-runtime boundaries, package/release checks and normal TypeScript compilation.
The server and UI are distinct codebases within one package.

[Server verification](../../server/docs/forge/on-build.md) retains the required
source, installed-tarball and live checks. There is no React application or browser
build yet; the server's diagnostic remains the browser regression target.
