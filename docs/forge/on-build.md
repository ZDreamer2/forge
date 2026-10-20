# Forge application verification

The [README](../../README.md#develop) centralizes the pinned runtime and aggregate
check/build/tarball-consumer commands. Run them from this independent repository
root. Consumer tests exercise the actual tarball; source imports or a symlink are
not packaging evidence. Pass an absolute consuming `workspace.ts` path as the
optional `test:workspace` argument to verify real policy types and the installed
diagnostic without embedding private rules into this public repository.

Server changes require the colocated app/CLI checks as well as unit checks. They
exercise real temporary Git repositories, sockets and spawned CLI processes:
configuration precedence, identity, Host/Origin enforcement, occupied-port
failure and bounded SIGINT/SIGTERM shutdown. Identity requests and shutdown leave
working files and Git indexes unchanged. The aggregate gate includes these
checks; a browser smoke test becomes relevant when a page is introduced.

For a direct source check, build and use the [source server
instructions](../../README.md#run-the-source-server), then request
`/api/workspace` with the configured loopback authority. The source currently
implements identity only; registry `0.1.1` remains the diagnostic release. Retain
tarball/public-type verification and release-workflow checks when extending it.
