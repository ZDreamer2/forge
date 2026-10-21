export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>Forge</title>
<style>
body { font: 16px system-ui, sans-serif; margin: 2rem auto; padding: 0 1rem; max-width: 75rem; color: #202830; background: #fafbfc; }
button { font: inherit; padding: .5rem 1rem; cursor: pointer; }
button:disabled { cursor: wait; }
li { margin: .75rem 0; overflow-wrap: anywhere; }
.path { font-family: ui-monospace, monospace; }
.error { color: #a02020; }
section { border-top: 1px solid #ccd3da; margin-top: 1.5rem; }
</style>
</head>
<body>
<h1>Forge workspace</h1>
<p>Read-only workspace diagnostic. Refresh reads current changes. Restart the server to reload policy and repository participation.</p>
<button id="refresh" type="button">Refresh</button>
<p id="status" role="status" aria-live="polite">Loading…</p>
<section aria-labelledby="identity-heading">
<h2 id="identity-heading">Workspace and repositories</h2>
<p id="identity-error" class="error" role="alert"></p>
<div id="identity"></div>
</section>
<section aria-labelledby="changes-heading">
<h2 id="changes-heading">Current changes</h2>
<p id="changes-error" class="error" role="alert"></p>
<div id="changes"></div>
</section>
<script>
"use strict";
const refreshButton = document.getElementById("refresh");
const status = document.getElementById("status");
const identity = document.getElementById("identity");
const changes = document.getElementById("changes");
const identityError = document.getElementById("identity-error");
const changesError = document.getElementById("changes-error");
function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function request(path) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ")");
        return response.json();
      })(),
      new Promise((_, reject) => {
        // Allow the server's 30-second collection deadline to return its response first.
        timer = setTimeout(() => {
          reject(new Error("Request timed out"));
          controller.abort();
        }, 35000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function showIdentity(data) {
  document.title = "🛠️ " + data.workspace.name;
  const root = textElement("p", data.workspace.root, "path");
  const list = document.createElement("ul");
  for (const repo of data.repositories) {
    list.append(textElement("li", repo.path + " — " + repo.status + (repo.gitRoot ? " — " + repo.gitRoot : ""), "path"));
  }
  identity.replaceChildren(root, list);
}
function showChanges(data) {
  if (data.changes.length === 0) {
    changes.replaceChildren(textElement("p", "No uncommitted changes."));
    return;
  }
  const list = document.createElement("ul");
  for (const change of data.changes) {
    const item = document.createElement("li");
    item.append(textElement("p", change.repo + " · " + change.path + " — " + change.kind, "path"));
    if (change.from !== undefined) item.append(textElement("p", "From: " + change.from, "path"));
    const memberships = document.createElement("ul");
    for (const id of change.codebases) {
      memberships.append(textElement("li", id + " — " + data.codebases[id].guidance, "path"));
    }
    item.append(change.codebases.length ? memberships : textElement("p", "No codebase membership."));
    list.append(item);
  }
  changes.replaceChildren(list);
}
async function refresh() {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  status.textContent = "Loading…";
  changes.replaceChildren();
  identityError.textContent = "";
  changesError.textContent = "";
  try {
    async function load(path, show, region, label) {
      try {
        show(await request(path));
        return true;
      } catch (error) {
        if (path === "/api/workspace") document.title = "Forge";
        region.textContent = label + ": " + error.message + ". Use Refresh to retry.";
        status.textContent = "Refresh failed. Use Refresh to retry.";
        return false;
      }
    }
    const results = await Promise.all([
      load("/api/workspace", showIdentity, identityError, "Workspace"),
      load("/api/changes", showChanges, changesError, "Changes")
    ]);
    status.textContent = results.every(Boolean) ? "Up to date." : "Refresh failed. Use Refresh to retry.";
  } finally {
    refreshButton.disabled = false;
  }
}
refreshButton.addEventListener("click", refresh);
refresh();
</script>
</body>
</html>`;
