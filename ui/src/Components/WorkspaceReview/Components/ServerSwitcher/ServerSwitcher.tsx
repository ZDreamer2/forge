import type { ServerHubAvailability, ServerHubSelection } from "@forge/api-contract";
import { Button, Menu, Tooltip } from "@mantine/core";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useServerHubSelection } from "./Lib/ServerHubData/ServerHubData";
import styles from "./ServerSwitcher.module.css";

const emptyServers: NonNullable<ServerHubSelection["servers"]> = [];

function baseUrl(value: string) {
	const url = new URL(value);
	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.replace(/\/$/, "");
	return url.href;
}

function availabilityText(availability: ServerHubAvailability) {
	const status = { unknown: "Availability unknown", reachable: "Reachable", unavailable: "Unavailable" };
	return `${status[availability.status]}${availability.stale ? " · stale observation" : ""}`;
}

export function ServerSwitcher({ workspaceIdentity }: { workspaceIdentity: ReactNode }) {
	const inspection = useServerHubSelection();
	const snapshot = inspection.data;
	const servers = snapshot?.servers ?? emptyServers;
	const current = servers.map((server) => baseUrl(server.url) === baseUrl(window.location.href));
	const nav = useRef<HTMLElement>(null);
	const measurement = useRef<HTMLDivElement>(null);
	const moreMeasurement = useRef<HTMLSpanElement>(null);
	const [visibleCount, setVisibleCount] = useState(servers.length);
	const [opened, setOpened] = useState(false);

	useLayoutEffect(() => {
		const container = nav.current;
		const strip = measurement.current;
		if (!container || !strip) return;
		let active = true;
		const measureDestinations = () => {
			if (!active) return;
			const widths = Array.from(strip.children, (child) => child.getBoundingClientRect().width);
			const available = container.getBoundingClientRect().width;
			const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, servers.length - 1) * 4;
			let count = widths.length;
			if (total > available) {
				const limit = available - (moreMeasurement.current?.getBoundingClientRect().width ?? 0) - 4;
				let used = 0;
				count = 0;
				for (const width of widths) {
					const next = used + (count ? 4 : 0) + width;
					if (next > limit) break;
					used = next;
					count++;
				}
			}
			setVisibleCount(count);
			if (count === widths.length) setOpened(false);
		};
		// Keep the complete strip measurable so widening can restore hidden destinations.
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measureDestinations);
		observer?.observe(container);
		observer?.observe(strip);
		measureDestinations();
		window.addEventListener("resize", measureDestinations);
		void document.fonts?.ready.then(measureDestinations);
		document.fonts?.addEventListener("loadingdone", measureDestinations);
		return () => {
			active = false;
			observer?.disconnect();
			window.removeEventListener("resize", measureDestinations);
			document.fonts?.removeEventListener("loadingdone", measureDestinations);
		};
	}, [servers]);

	let message = "";
	let detail = "";
	let warning = false;
	if (inspection.isPending) message = "Loading switcher…";
	else if (inspection.isError) {
		message = "Switcher unavailable";
		detail = `Could not read switcher information: ${inspection.error.message}. Reload the page to try again.`;
		warning = true;
	} else if (snapshot?.source.status === "unconfigured") {
		message = "Switcher not configured";
		detail = "No server hub is selected. Reload the page after configuring a hub to load destinations.";
	} else if (snapshot?.source.status === "configuration-unavailable") {
		message = "Switcher configuration unavailable";
		detail = `${snapshot.error ?? "The initial hub configuration is unavailable."} Reload the page after correcting configuration.`;
		warning = true;
	} else if (snapshot?.error) {
		message = "Hub list unavailable";
		detail = `${snapshot.error} ${snapshot.servers === null ? "No destinations have been learned." : "Retained destinations remain available; their recorded statuses are unchanged."} Reload the page to try again.`;
		warning = true;
	} else if (snapshot?.servers === null) message = "Waiting for hub list";
	else if (servers.length === 0) message = "No configured destinations";
	else if (snapshot?.stale) {
		message = "Stale hub list";
		detail = "This list was stale at page load. Reload the page to update switcher information.";
	}

	const overflow = visibleCount < servers.length;
	const hiddenCurrent = current.some((matches, index) => matches && index >= visibleCount);
	return (
		<div className={styles.root}>
			{!current.some(Boolean) && <div className={styles.identity}>{workspaceIdentity}</div>}
			<nav aria-label="Workspaces" className={styles.navigation} ref={nav} data-populated={servers.length > 0}>
				<div className={styles.measurement} aria-hidden="true">
					<div className={styles.strip} ref={measurement}>
						{servers.map((server) => (
							<span className={styles.tile} key={server.id}>
								<span className={styles.dot} />
								{server.name}
							</span>
						))}
					</div>
					<span className={styles.moreMeasure} ref={moreMeasurement}>
						More
					</span>
				</div>
				{servers.slice(0, visibleCount).map((server, index) => (
					<Tooltip
						key={server.id}
						multiline
						classNames={{ tooltip: styles.tooltip }}
						label={`${availabilityText(server.availability)}. Hub observation at page load; reload the page to update.${server.availability.error ? ` ${server.availability.error}` : ""}`}
						events={{ hover: true, focus: true, touch: false }}
					>
						<a
							className={styles.tile}
							href={server.url}
							data-current={current[index] || undefined}
							aria-current={current[index] ? "page" : undefined}
						>
							<span
								className={styles.dot}
								data-status={server.availability.status}
								data-stale={server.availability.stale}
								aria-hidden="true"
							/>
							{server.name}
						</a>
					</Tooltip>
				))}
				{overflow && (
					<Menu opened={opened} onChange={setOpened} position="bottom-end" withinPortal>
						<Menu.Target>
							<Button
								className={styles.more}
								variant="default"
								size="compact-sm"
								aria-label="More workspaces"
								data-current={hiddenCurrent || undefined}
							>
								More
							</Button>
						</Menu.Target>
						<Menu.Dropdown className={styles.menu}>
							{servers.map((server, index) => (
								<Menu.Item
									key={server.id}
									component="a"
									href={server.url}
									className={styles.menuItem}
									data-current={current[index] || undefined}
									aria-current={current[index] ? "page" : undefined}
								>
									<span className={styles.menuName}>{server.name}</span>
									<span className={styles.status}>
										{availabilityText(server.availability)}
										{current[index] ? " · current workspace" : ""}
									</span>
								</Menu.Item>
							))}
						</Menu.Dropdown>
					</Menu>
				)}
			</nav>
			{message && (
				<Tooltip
					label={detail || `${message}. Reload the page to update switcher information.`}
					multiline
					classNames={{ tooltip: styles.tooltip }}
					events={{ hover: true, focus: true, touch: false }}
				>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Switcher status help must be available on keyboard focus. */}
					<span className={styles.feedback} data-warning={warning} tabIndex={0}>
						{warning ? "⚠ " : ""}
						{message}
					</span>
				</Tooltip>
			)}
		</div>
	);
}
