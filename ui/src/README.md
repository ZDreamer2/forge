# Reserved frontend application root

The React application will live here, following the shared frontend structure:
mount-only `main.tsx`, `App.tsx`, and owned `Routes/`, `Components/`, `Lib/`,
`Tests/` and `Docs/` directories as they earn contents.

This structure-only migration introduces no React/Vite dependencies, application
entry, browser build or client features. Browser TypeScript, Vite and verification
configuration must be established with that implementation, not inferred from the
server's configuration. The existing diagnostic remains server-owned.

Within this combined application, relative imports through the server's public
`server/src/components/api-contract/index.ts` entry are the specifically allowed
source seam beyond the frontend root. This is
not permission to import server implementation, workspace-policy authoring types or
arbitrary sibling files. All ordinary frontend unit boundaries remain in force.

The root package owns all dependencies and aggregate acceptance/build commands.
`ui/` is a source boundary, with no member manifest, installation or publication.
