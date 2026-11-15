(() => {
	const servers = [
		{ id: "bico-1", name: "Bico 1", status: "reachable" },
		{ id: "bico-2", name: "Bico 2", status: "reachable" },
		{ id: "bico-3", name: "Bico 3", status: "unavailable" },
		{ id: "bico-4", name: "Bico 4", status: "reachable", stale: true },
		{ id: "bico-5", name: "Bico 5", status: "unknown" },
		{ id: "eden", name: "Eden", status: "reachable" },
		{ id: "admin", name: "Admin", status: "reachable" },
	];
	const current = "bico-2";
	const nav = document.getElementById("server-switcher");
	const strip = document.getElementById("server-strip");
	const overflow = document.getElementById("server-overflow");
	const list = document.getElementById("server-list");
	const preview = document.getElementById("switch-preview");
	const statusLabel = (server) =>
		server.status === "unknown"
			? "Availability unknown"
			: `${server.status === "reachable" ? "Reachable" : "Unavailable"}${server.stale ? " · stale observation" : ""}`;

	function destination(server, inMenu) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `server-destination${inMenu ? " server-menu-item" : ""}`;
		button.dataset.server = server.id;
		button.title = `${server.name} · ${statusLabel(server)} (example)`;
		button.setAttribute(
			"aria-label",
			`${server.name}, ${statusLabel(server)}${server.id === current ? ", current workspace" : ""}`,
		);
		if (server.id === current) button.setAttribute("aria-current", "page");
		const dot = document.createElement("span");
		dot.className = `availability-dot availability-${server.status}${server.stale ? " availability-stale" : ""}`;
		dot.setAttribute("aria-hidden", "true");
		const name = document.createElement("span");
		name.textContent = server.name;
		button.append(dot, name);
		if (inMenu) {
			const status = document.createElement("span");
			status.className = "server-status";
			status.textContent = statusLabel(server);
			button.append(status);
		}
		button.addEventListener("click", () => {
			overflow.open = false;
			preview.querySelector("span").textContent =
				server.id === current
					? "Bico 2 is the current workspace."
					: `Would navigate to ${server.name} in this tab. This prototype keeps the Bico 2 example open.`;
			preview.hidden = false;
			if (inMenu) overflow.querySelector("summary").focus();
		});
		return button;
	}
	for (const server of servers) {
		strip.append(destination(server, false));
		list.append(destination(server, true));
	}
	preview.querySelector("button").addEventListener("click", () => {
		preview.hidden = true;
	});

	function fitStrip() {
		const buttons = [...strip.children];
		for (const button of buttons) button.hidden = false;
		overflow.hidden = false;
		const gap = 4;
		const widths = buttons.map((button) => button.getBoundingClientRect().width);
		const total = widths.reduce((sum, width) => sum + width, 0) + gap * (buttons.length - 1);
		if (total <= nav.clientWidth) {
			overflow.hidden = true;
			overflow.open = false;
			return;
		}
		const available = nav.clientWidth - overflow.getBoundingClientRect().width - gap;
		let used = 0;
		let hidden = false;
		buttons.forEach((button, index) => {
			const next = used + (index ? gap : 0) + widths[index];
			hidden ||= next > available;
			button.hidden = hidden;
			if (!hidden) used = next;
		});
		overflow.classList.toggle(
			"contains-current",
			buttons.some((button) => button.hidden && button.dataset.server === current),
		);
	}
	function positionMenu() {
		if (!overflow.open) return;
		const menu = overflow.querySelector(".server-menu");
		const rect = overflow.getBoundingClientRect();
		menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${rect.bottom + 8}px`;
	}
	overflow.addEventListener("toggle", positionMenu);
	new ResizeObserver(() => {
		fitStrip();
		positionMenu();
	}).observe(nav);
	fitStrip();
	document.addEventListener("click", (event) => {
		if (!overflow.contains(event.target)) overflow.open = false;
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && overflow.open) {
			overflow.open = false;
			overflow.querySelector("summary").focus();
		}
	});
})();
