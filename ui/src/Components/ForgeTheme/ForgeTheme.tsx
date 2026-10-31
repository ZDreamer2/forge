import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import "./ForgeTheme.css";

export function ForgeTheme({ children, env }: { children: ReactNode; env?: "test" }) {
	return (
		<MantineProvider forceColorScheme="light" {...(env ? { env } : {})}>
			{children}
		</MantineProvider>
	);
}
