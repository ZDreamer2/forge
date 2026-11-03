import { createTheme, MantineProvider, Tooltip } from "@mantine/core";
import type { ReactNode } from "react";
import "./ForgeTheme.css";

const theme = createTheme({
	components: {
		Tooltip: Tooltip.extend({
			styles: {
				tooltip: {
					backgroundColor: "#fff",
					color: "#45594b",
					border: "1px solid #e3e8e4",
					boxShadow: "0 5px 22px #16302016",
				},
			},
		}),
	},
});

export function ForgeTheme({ children, env }: { children: ReactNode; env?: "test" }) {
	return (
		<MantineProvider theme={theme} forceColorScheme="light" {...(env ? { env } : {})}>
			{children}
		</MantineProvider>
	);
}
