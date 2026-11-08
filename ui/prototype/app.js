(() => {
	const $ = (id) => document.getElementById(id);
	const escapeHtml = (value) =>
		String(value).replace(
			/[&<>"']/g,
			(char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
		);
	const fixtures = window.forgeFixtures;
	let selected = new URL(location.href).searchParams.get("file") || fixtures[0].path;
	let mode = "unified";
	let expandedContext = false;
	const closed = new Set();
	const initializedFolders = new Set();
	const types = { code: "Code", tests: "Tests", doc: "Docs", config: "Config", assets: "Assets" };
	const importance = { high: "High", medium: "Medium", low: "Low", none: "None" };
	const enabled = { type: new Set(Object.keys(types)), importance: new Set(["high", "medium", "low"]) };
	const files = () =>
		$("scenario").value === "empty" ? [] : $("scenario").value === "large" ? window.forgeLargeFixtures : fixtures;
	let selectedFolder = null;
	let signalsOpen = false;
	let folders = new Map();
	const visibleFiles = () =>
		files().filter((file) => enabled.type.has(file.type) && enabled.importance.has(file.importance));
	const totals = (entries) => ({
		added: entries.reduce((sum, file) => sum + file.added, 0),
		removed: entries.reduce((sum, file) => sum + file.removed, 0),
	});
	function breakdown(entries) {
		const columns = Object.entries(importance).filter(([key]) => entries.some((file) => file.importance === key));
		columns.unshift(["all", "All"]);
		const rows = Object.entries(types).filter(([key]) => entries.some((file) => file.type === key));
		rows.unshift(["all", "All"]);
		return `<table><caption>Type × importance<span class="matrix-legend">Files / added / removed</span></caption><thead><tr><th scope="col">Type / Importance</th>${columns.map(([key, name]) => `<th scope="col"${key === "all" ? ' class="matrix-total"' : ""}><span class="matrix-label">${name}</span></th>`).join("")}</tr></thead><tbody>${rows
			.map(
				([type, name]) =>
					`<tr${type === "all" ? ' class="matrix-total"' : ""}><th scope="row"><span class="matrix-label">${name}</span></th>${columns
						.map(([level]) => {
							const matching = entries.filter(
								(file) => (type === "all" || file.type === type) && (level === "all" || file.importance === level),
							);
							const count = totals(matching);
							return `<td${level === "all" ? ' class="matrix-total"' : ""}>${matching.length ? `<span class="matrix-values" aria-label="${matching.length} files, ${count.added} added lines, ${count.removed} removed lines"><span>${matching.length}</span><span class="matrix-separator"> / </span><span class="added">+${count.added}</span><span class="matrix-separator"> / </span><span class="removed">−${count.removed}</span></span>` : '<span class="matrix-empty" aria-label="No matching files">—</span>'}</td>`;
						})
						.join("")}</tr>`,
			)
			.join("")}</tbody></table>`;
	}
	function icon(file) {
		const extension = file.path.split(".").pop().toLowerCase();
		const name =
			file.type === "tests"
				? "test-ts"
				: { tsx: "react_ts", ts: "typescript", css: "css", md: "markdown", png: "image", yaml: "yaml", yml: "yaml" }[
						extension
					] || "document";
		return window.forgeIcons[name];
	}
	function counters(entries) {
		const count = totals(entries);
		return `<span class="line-counts" aria-label="${count.removed} removed lines, ${count.added} added lines"><span class="removed">${count.removed ? `−${count.removed}` : ""}</span><span class="added">${count.added ? `+${count.added}` : ""}</span></span>`;
	}
	const within = (path, scope) => !scope || scope === "." || path === scope || path.startsWith(`${scope}/`);
	const directSignals = (entry, folder = false) =>
		(entry.signals || []).map((signal) => ({ ...signal, path: entry.path, repo: entry.repo, folder }));
	function scopeSignals(path) {
		if (!files().length) return [];
		return [
			...files()
				.filter((file) => within(file.path, path))
				.flatMap((file) => directSignals(file)),
			...(window.forgeFolderSignals || [])
				.filter((folder) => within(folder.path, path))
				.flatMap((folder) => directSignals(folder, true)),
		];
	}
	function signalIcon(severity) {
		return severity === "warning"
			? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 19 18H1z"/><path d="M10 7v5m0 3v.2"/></svg>'
			: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 9v5m0-8v.2"/></svg>';
	}
	function signalTable(records, interactive = false) {
		const visible = new Set(visibleFiles().map((file) => file.path));
		return `<table class="signal-table"><colgroup><col class="signal-severity-column"><col class="signal-path-column"><col></colgroup><thead><tr><th scope="col" aria-label="Severity"></th><th scope="col">Path</th><th scope="col">Message</th></tr></thead><tbody>${records
			.map((record) => {
				const hidden = !record.folder && !visible.has(record.path);
				const path = record.path + (record.folder && !record.path.endsWith("/") ? "/" : "");
				const pathLabel =
					interactive && !record.folder
						? `<button class="text-button" data-open-signal-file="${escapeHtml(record.path)}">${escapeHtml(path)}</button>`
						: `<code>${escapeHtml(path)}</code>`;
				const metadata = interactive
					? `<div class="signal-meta"><span>${escapeHtml(record.handler)}</span>${record.location ? `<span>${record.location.side === "base" ? "Base" : "Current"} · line ${record.location.line}${record.location.column ? `:${record.location.column}` : ""}</span>` : ""}${hidden ? `<button class="text-button" data-reveal-signal="${escapeHtml(record.path)}">Reveal file</button>` : ""}</div>`
					: "";
				return `<tr class="signal-${record.severity}"><td class="signal-severity"><span class="signal-severity-icon" role="img" aria-label="${record.severity === "warning" ? "Warning" : "Notice"}" title="${record.severity === "warning" ? "Warning" : "Notice"}">${signalIcon(record.severity)}</span></td><td class="signal-path">${pathLabel}${hidden ? '<span class="signal-filtered">Filtered out</span>' : ""}</td><td class="signal-message-cell">${escapeHtml(record.message)}${metadata}</td></tr>`;
			})
			.join("")}</tbody></table>`;
	}
	function signalBadges(records, target, folder = false, sourcePath = target) {
		return ["warning", "notice"]
			.map((severity) => {
				const entries = records.filter((record) => record.severity === severity);
				if (!entries.length) return "";
				const inheritedOnly = folder && !entries.some((record) => record.folder && record.path === sourcePath);
				const symbol = signalIcon(severity);
				const summary = signalTable(records);
				return `<button class="signal-badge signal-${severity}${inheritedOnly ? " signal-inherited" : ""}" data-signal-target="${escapeHtml(target)}" data-signal-folder="${folder}" data-tooltip="${escapeHtml(summary)}" aria-label="${entries.length} ${severity}${entries.length > 1 ? "s" : ""}${inheritedOnly ? " in descendants" : ""}; show analysis messages">${symbol}</button>`;
			})
			.join("");
	}
	function renderSignals() {
		const file = files().find((file) => file.path === selected);
		const records = selectedFolder ? scopeSignals(selectedFolder.path) : file ? directSignals(file) : [];
		const host = $("file-signals");
		if (!records.length) {
			host.innerHTML = "";
			return;
		}
		const visible = new Set(visibleFiles().map((file) => file.path));
		const warnings = records.filter((record) => record.severity === "warning").length;
		const notices = records.length - warnings;
		const hiddenCount = records.filter((record) => !record.folder && !visible.has(record.path)).length;
		const label = [
			warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "",
			notices ? `${notices} notice${notices > 1 ? "s" : ""}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		host.innerHTML = `<details id="signal-details" class="signal-panel" ${signalsOpen ? "open" : ""}><summary>${label}${hiddenCount ? `<span class="signal-filter-summary">${hiddenCount} on filtered-out files</span>` : ""}</summary><div class="signal-list">${signalTable(records, true)}</div></details>`;
		$("signal-details").addEventListener("toggle", (event) => {
			if (event.target.isConnected) signalsOpen = event.target.open;
		});
	}
	function selectFolder(key, force = false) {
		const node = folders.get(key);
		if (!node) return;
		select(key, { path: node.path, label: node.name }, force);
		return node.path;
	}
	function revealSignalFile(path) {
		const file = files().find((file) => file.path === path);
		if (!file) return;
		enabled.type.add(file.type);
		enabled.importance.add(file.importance);
		renderTree();
		for (const key of closed) {
			if (within(path, key.slice("folder:".length))) closed.delete(key);
		}
		select(path, null, true);
		signalsOpen = true;
		renderFilters();
		renderTree();
		renderFile();
	}
	function renderFilters() {
		for (const [field, values] of [
			["type", types],
			["importance", importance],
		]) {
			const host = $(field === "type" ? "type-filters" : "importance-filters");
			host.innerHTML =
				`<legend>${field === "type" ? "Type" : "Importance"}</legend>` +
				Object.entries(values)
					.map(
						([key, label]) =>
							`<button class="filter-toggle" data-dimension="${field}" data-value="${key}" aria-pressed="${enabled[field].has(key)}">${label}</button>`,
					)
					.join("");
		}
	}
	function renderTree() {
		const all = files();
		const visible = visibleFiles();
		folders = new Map();
		$("count").textContent = `· ${visible.length} of ${all.length}`;
		$("totals").innerHTML = `<span><strong>${all.length}</strong> files</span>${counters(all)}`;
		const shown = [];
		const repositories = new Map(fixtures.map((file) => [file.root, file.repo]));
		const makeFolder = (name, path) => ({
			name,
			path,
			repository: repositories.get(path),
			children: new Map(),
			files: [],
			entries: [],
		});
		const root = makeFolder("Bico 2", ".");
		for (const file of visible) {
			const parts = file.path.split("/");
			parts.pop();
			let parent = root;
			let path = "";
			root.entries.push(file);
			for (const name of parts) {
				path = path ? `${path}/${name}` : name;
				if (!parent.children.has(name)) parent.children.set(name, makeFolder(name, path));
				parent = parent.children.get(name);
				parent.entries.push(file);
			}
			parent.files.push(file);
		}
		function prepare(node, depth = 0) {
			// Compact chains of directories while keeping a single canonical path per row.
			while (!node.repository && !node.files.length && node.children.size === 1 && depth > 0) {
				const child = [...node.children.values()][0];
				if (child.repository) break;
				node = { ...child, name: `${node.name}/${child.name}` };
			}
			const key = `folder:${node.path}`;
			node.importance =
				["high", "medium", "low", "none"].find((level) => node.entries.some((file) => file.importance === level)) ||
				"none";
			if (!initializedFolders.has(key)) {
				initializedFolders.add(key);
				if (node.importance === "low" || node.importance === "none") closed.add(key);
			}
			folders.set(key, node);
			node.children = new Map([...node.children].map(([name, child]) => [name, prepare(child, depth + 1)]));
			return node;
		}
		function branch(node, depth = 0) {
			const key = `folder:${node.path}`;
			const folderImportance = node.importance;
			const homogeneous =
				node.entries.length && node.entries.every((file) => file.kind === node.entries[0].kind)
					? node.entries[0].kind
					: "M";
			const folderRow = `<div class="tree-row folder-row ${node.repository ? "repository-row" : ""} change-${homogeneous} importance-${folderImportance} ${selected === key ? "active" : ""}" style="--depth:${depth}"><button class="disclosure" data-toggle="${escapeHtml(key)}" aria-label="${closed.has(key) ? "Expand" : "Collapse"} ${escapeHtml(node.name)}" aria-expanded="${!closed.has(key)}">${closed.has(key) ? "▸" : "▾"}</button>${window.forgeIcons["folder-neutral"]}<button class="node-label" data-folder="${escapeHtml(key)}" aria-pressed="${selected === key}">${escapeHtml(node.name)}</button>${signalBadges(scopeSignals(node.path), key, true, node.path)}${counters(node.entries)}</div>`;
			if (closed.has(key)) return folderRow;
			shown.push(...node.files);
			return (
				folderRow +
				[...node.children.values()].map((child) => branch(child, depth + 1)).join("") +
				node.files
					.map(
						(file) =>
							`<div class="tree-row change-${file.kind} importance-${file.importance} ${selected === file.path ? "active" : ""}" style="--depth:${depth + 1}"><span class="disclosure-spacer"></span>${icon(file)}<button class="node-label" data-file="${escapeHtml(file.path)}" aria-pressed="${selected === file.path}">${escapeHtml(file.path.split("/").pop())}</button>${signalBadges(directSignals(file), file.path)}${counters([file])}</div>`,
					)
					.join("")
			);
		}
		$("tree").innerHTML = visible.length
			? branch(prepare(root))
			: '<div class="empty"><strong>No matching changes</strong>Adjust the type or importance filters.</div>';
		$("visible-summary").innerHTML =
			`<span class="shown-label" tabindex="0" data-tooltip="Line changes in matching files exposed by expanded folders. Files inside collapsed folders are excluded. Scrolling does not affect this total.">Shown</span>${counters(shown)}`;
		const selectedFile = all.find((file) => file.path === selected);
		if (selected && !visible.some((file) => file.path === selected) && !folders.has(selected)) {
			$("tree").insertAdjacentHTML(
				"afterbegin",
				`<div class="selection-note">${selectedFile ? "Selected file" : "Selection"} is outside the current filters. <button class="text-button" data-clear-selection>Clear selection</button></div>`,
			);
		}
	}

	function renderFile() {
		renderSignals();
		if (selectedFolder) {
			const entries = visibleFiles().filter((file) => within(file.path, selectedFolder.path));
			$("file-header").innerHTML =
				`<div class="selected-file-bar"><h2 class="workspace-file-path" title="Workspace-relative folder path">${escapeHtml(selectedFolder.path)}/</h2></div>`;
			const allEntries = files().filter((file) => within(file.path, selectedFolder.path));
			const count = totals(entries);
			$("diff").innerHTML =
				`<section class="folder-details" aria-label="Folder changes"><div class="folder-summary"><h3>${entries.length} matching files <span>of ${allEntries.length} changed files</span></h3>${counters(entries)}</div><p class="folder-scope">Matching descendants, including nested repositories. Folder expansion does not affect these totals.</p>${!entries.length ? '<p class="folder-empty">No changes match the current filters.</p>' : `${!count.added && !count.removed ? '<p class="folder-empty">No line changes. Binary files and pure renames still count as changed files.</p>' : ""}<div class="folder-breakdowns">${breakdown(entries)}</div>`}</section>`;
			return;
		}
		const file = files().find((entry) => entry.path === selected);
		if (!file) {
			$("file-header").innerHTML = "<h2>Workspace changes</h2>";
			$("diff").innerHTML =
				`<div class="empty"><strong>${files().length ? (selected ? "File is unavailable" : "Select a change") : "A clear workspace"}</strong>${files().length ? "Select a changed file from the sidebar." : "There are no changes in this example."}</div>`;
			return;
		}
		const kind = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed" }[file.kind];
		const parts = file.path.split("/");
		const filename = parts.pop();
		const first = parts.length ? `${parts.shift()}/` : "";
		const parent = parts.length ? `${parts.pop()}/` : "";
		const middle = parts.length ? `${parts.join("/")}/` : "";
		const renameNote = file.from
			? `<div class="rename-note">Renamed from <code>${escapeHtml(file.from)}</code></div>`
			: "";
		$("file-header").innerHTML =
			`<div class="selected-file-bar"><h2 class="workspace-file-path file-path-fragments" aria-label="${escapeHtml(file.path)}" title="${escapeHtml(file.path)} · ${kind}"><span class="path-first">${escapeHtml(first)}</span><span class="path-middle">${escapeHtml(middle)}</span><span class="path-parent">${escapeHtml(parent)}</span><strong>${escapeHtml(filename)}</strong></h2><div class="segments" aria-label="Diff layout"><button data-mode="unified" class="${mode === "unified" ? "active" : ""}" aria-pressed="${mode === "unified"}">Unified</button><button data-mode="split" class="${mode === "split" ? "active" : ""}" aria-pressed="${mode === "split"}">Split</button></div></div>`;
		if (file.message) {
			$("diff").innerHTML =
				`${renameNote}<div class="empty"><strong>${kind} file</strong>${escapeHtml(file.message)}</div>`;
			return;
		}
		let oldLine = 18,
			newLine = 18;
		const rows = file.lines.map(([sign, code]) => ({
			sign,
			code,
			old: sign === "+" ? "" : oldLine++,
			current: sign === "-" ? "" : newLine++,
		}));
		const row = (entry, side) =>
			`<div class="code-row ${entry.sign === "+" ? "ins" : entry.sign === "-" ? "del" : ""}">${side ? `<span class="num">${side === "old" ? entry.old : entry.current}</span>` : `<span class="num">${entry.old}</span><span class="num">${entry.current}</span>`}<span class="sign">${escapeHtml(entry.sign)}</span><span class="code">${escapeHtml(entry.code)}</span></div>`;
		const body =
			mode === "unified"
				? rows.map((entry) => row(entry)).join("")
				: `<div class="split"><div>${rows
						.filter((entry) => entry.sign !== "+")
						.map((entry) => row(entry, "old"))
						.join("")}</div><div>${rows
						.filter((entry) => entry.sign !== "-")
						.map((entry) => row(entry, "current"))
						.join("")}</div></div>`;
		$("diff").innerHTML =
			`${renameNote}<div class="diff-card">${expandedContext ? '<div class="hunk">Context expanded</div>' : '<button class="context-button" id="context">↕ Reveal omitted context</button>'}${body}</div>`;
	}

	function renderNotice() {
		$("notice").innerHTML =
			$("scenario").value === "failed"
				? '<div class="notice">Refresh failed. Showing stale example data from the previous observation.<button id="retry">Try again</button></div>'
				: "";
	}
	function render() {
		renderFilters();
		renderTree();
		renderFile();
		renderNotice();
	}
	function refresh() {
		if ($("scenario").value === "failed") {
			renderNotice();
			return;
		}
		$("refresh").querySelector("span").textContent = "Refreshed just now";
		render();
	}
	document.querySelector(".filter-bar").addEventListener("click", (event) => {
		const toggle = event.target.closest("[data-dimension]");
		if (!toggle) return;
		const field = toggle.dataset.dimension,
			value = toggle.dataset.value;
		if (enabled[field].has(value)) enabled[field].delete(value);
		else enabled[field].add(value);
		toggle.setAttribute("aria-pressed", enabled[field].has(value));
		renderTree();
		renderFile();
	});
	function setAllFilters(selected) {
		enabled.type = new Set(selected ? Object.keys(types) : []);
		enabled.importance = new Set(selected ? Object.keys(importance) : []);
		renderFilters();
		renderTree();
		renderFile();
	}
	$("select-all-filters").addEventListener("click", () => setAllFilters(true));
	$("deselect-all-filters").addEventListener("click", () => setAllFilters(false));
	$("scenario").addEventListener("change", () => {
		$("refresh").querySelector("span").textContent = "Refresh";
		render();
	});
	$("refresh").addEventListener("click", refresh);
	$("collapse").addEventListener("click", () => {
		for (const key of folders.keys()) closed.add(key);
		renderTree();
	});
	$("expand").addEventListener("click", () => {
		closed.clear();
		renderTree();
	});
	function select(path, folder = null, force = false) {
		if (force && selected === path) return;
		signalsOpen = false;
		selected = selected === path && !force ? "" : path;
		selectedFolder = selected ? folder : null;
		expandedContext = false;
		const url = new URL(location.href);
		url.searchParams.delete("file");
		url.searchParams.delete("folder");
		if (selected) url.searchParams.set(folder ? "folder" : "file", selected);
		history.pushState({}, "", url);
		renderTree();
		renderFile();
		$("diff").scrollTop = 0;
	}
	let copyNoticeTimer;
	async function copyPath(path) {
		const notice = $("copy-status");
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(path);
			} else {
				// Local-file browsers may not expose the modern clipboard API.
				const previousFocus = document.activeElement;
				const field = document.createElement("textarea");
				field.value = path;
				field.style.cssText = "position:fixed;left:-9999px;top:0";
				document.body.append(field);
				try {
					field.select();
					if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
				} finally {
					field.remove();
					previousFocus?.focus();
				}
			}
			notice.textContent = `Copied: ${path}`;
		} catch {
			notice.textContent = "Could not copy path. Clipboard access is unavailable.";
		}
		clearTimeout(copyNoticeTimer);
		notice.hidden = false;
		copyNoticeTimer = setTimeout(() => {
			notice.hidden = true;
		}, 3000);
	}
	document.addEventListener("click", (event) => {
		const toggle = event.target.closest("[data-toggle]");
		if (toggle) {
			const key = toggle.dataset.toggle;
			if (closed.has(key)) closed.delete(key);
			else closed.add(key);
			renderTree();
		}
		const link = event.target.closest("[data-file]");
		if (link) {
			select(link.dataset.file, null, event.ctrlKey);
			if (event.ctrlKey) void copyPath(link.dataset.file);
		}
		const folder = event.target.closest("[data-folder]");
		if (folder) {
			const path = selectFolder(folder.dataset.folder, event.ctrlKey);
			if (event.ctrlKey && path !== undefined) void copyPath(path);
		}
		const signal = event.target.closest("[data-signal-target]");
		if (signal) {
			if (signal.dataset.signalFolder === "true") selectFolder(signal.dataset.signalTarget, true);
			else select(signal.dataset.signalTarget, null, true);
			signalsOpen = true;
			renderFile();
		}
		const reveal = event.target.closest("[data-reveal-signal]");
		if (reveal) revealSignalFile(reveal.dataset.revealSignal);
		const open = event.target.closest("[data-open-signal-file]");
		if (open) {
			select(open.dataset.openSignalFile, null, true);
			signalsOpen = true;
			renderFile();
		}
		if (event.target.closest("[data-clear-selection]")) select(selected);
		const layout = event.target.closest("[data-mode]");
		if (layout) {
			mode = layout.dataset.mode;
			renderFile();
		}
		if (event.target.id === "context") {
			expandedContext = true;
			renderFile();
		}
		if (event.target.id === "retry") {
			$("scenario").value = "normal";
			refresh();
		}
	});
	function restoreSelection() {
		const params = new URL(location.href).searchParams;
		selected = params.get("file") || params.get("folder") || "";
		selectedFolder = null;
		if (params.has("folder")) {
			if (selected.startsWith("folder:")) {
				const path = selected.slice("folder:".length);
				selectedFolder = { path, label: path };
			}
		}
		expandedContext = false;
		signalsOpen = false;
		render();
	}
	addEventListener("popstate", restoreSelection);
	const tooltip = document.createElement("div");
	tooltip.className = "breakdown-tooltip";
	tooltip.id = "breakdown-tooltip";
	tooltip.role = "tooltip";
	tooltip.hidden = true;
	document.body.append(tooltip);
	let tooltipTarget;
	function hideTooltip() {
		tooltip.hidden = true;
		tooltipTarget?.removeAttribute("aria-describedby");
		tooltipTarget = null;
	}
	function showTooltip(target) {
		hideTooltip();
		tooltipTarget = target;
		tooltip.innerHTML = target.dataset.tooltip;
		tooltip.hidden = false;
		target.setAttribute("aria-describedby", tooltip.id);
		const rect = target.getBoundingClientRect();
		tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 8))}px`;
		tooltip.style.top = `${Math.max(8, Math.min(rect.bottom + 7, innerHeight - tooltip.offsetHeight - 8))}px`;
	}
	document.addEventListener("pointerover", (event) => {
		const target = event.target.closest("[data-tooltip]");
		if (target && target !== tooltipTarget) showTooltip(target);
		else if (!target) hideTooltip();
	});
	document.addEventListener("focusin", (event) => {
		const target = event.target.closest("[data-tooltip]");
		if (target) showTooltip(target);
		else hideTooltip();
	});
	document.addEventListener("focusout", hideTooltip);
	document.addEventListener("scroll", hideTooltip, true);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hideTooltip();
	});
	document.addEventListener("click", hideTooltip);
	const resize = $("resize");
	function setWidth(width) {
		const bounded = Math.max(240, Math.min(600, width));
		document.body.style.setProperty("--sidebar-width", `${bounded}px`);
		resize.setAttribute("aria-valuenow", bounded);
		try {
			localStorage.setItem("forge-prototype-sidebar-width", String(bounded));
		} catch {
			// Resizing remains usable when browser storage is unavailable.
		}
	}
	try {
		const saved = localStorage.getItem("forge-prototype-sidebar-width");
		if (saved !== null && Number.isFinite(Number(saved))) setWidth(Number(saved));
	} catch {
		// Keep the default width when browser storage is unavailable.
	}
	resize.addEventListener("pointerdown", (event) => {
		resize.setPointerCapture(event.pointerId);
		document.body.classList.add("dragging");
	});
	resize.addEventListener("pointermove", (event) => {
		if (resize.hasPointerCapture(event.pointerId)) setWidth(event.clientX);
	});
	resize.addEventListener("lostpointercapture", () => document.body.classList.remove("dragging"));
	resize.addEventListener("pointerup", (event) => {
		if (resize.hasPointerCapture(event.pointerId)) resize.releasePointerCapture(event.pointerId);
	});
	resize.addEventListener("keydown", (event) => {
		if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
			event.preventDefault();
			setWidth($("sidebar").offsetWidth + (event.key === "ArrowLeft" ? -20 : 20));
		}
	});
	if (location.search) restoreSelection();
	else render();
})();
