import { Tooltip } from "@mantine/core";
import { Fragment, useEffect, useRef } from "react";
import styles from "./PathHeader.module.css";

function hasSelection(header: Node | null) {
	const selection = window.getSelection();
	return (
		!!selection &&
		!selection.isCollapsed &&
		!!selection.rangeCount &&
		!!header &&
		selection.getRangeAt(0).intersectsNode(header)
	);
}

export function PathHeader({ path, onCopy }: { path: string; onCopy?: ((path: string) => void) | undefined }) {
	const gesture = useRef({ active: false, x: 0, y: 0, blocked: false });
	const header = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		function move(event: PointerEvent) {
			const current = gesture.current;
			if (
				current.active &&
				(Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3 || hasSelection(header.current))
			)
				current.blocked = true;
		}
		function end() {
			gesture.current.active = false;
		}
		function cancel() {
			gesture.current.blocked = true;
			end();
		}
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", end);
		document.addEventListener("pointercancel", cancel);
		return () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", end);
			document.removeEventListener("pointercancel", cancel);
		};
	}, []);
	const parts = path === "." ? ["Workspace"] : path.split("/");
	return (
		<h2
			ref={header}
			className={styles.path}
			aria-label={path}
			onPointerDown={(event) => {
				gesture.current = {
					active: event.button === 0,
					x: event.clientX,
					y: event.clientY,
					blocked: hasSelection(header.current) || event.button !== 0,
				};
			}}
		>
			{parts.map((part, index) => {
				const prefix = path === "." ? "." : parts.slice(0, index + 1).join("/");
				return (
					<Fragment key={prefix}>
						{index > 0 && "/"}
						<Tooltip
							label={
								<>
									<code>{prefix}</code>
									<br />
									Click or press Enter/Space to copy this workspace-relative path. Drag to select text.
								</>
							}
							events={{ hover: true, focus: true, touch: true }}
							classNames={{ tooltip: styles.tooltip }}
						>
							{/* biome-ignore lint/a11y/useSemanticElements: Native buttons prevent normal cross-segment mouse text selection. Keyboard behavior is explicit. */}
							<span
								role="button"
								tabIndex={0}
								aria-label={`Copy ${prefix}`}
								className={styles.segment}
								onClick={(event) => {
									if (event.detail === 0 || (!gesture.current.blocked && !hasSelection(header.current)))
										onCopy?.(prefix);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										if (!event.repeat) onCopy?.(prefix);
									}
								}}
							>
								{index === parts.length - 1 ? <strong>{part}</strong> : part}
							</span>
						</Tooltip>
					</Fragment>
				);
			})}
		</h2>
	);
}
