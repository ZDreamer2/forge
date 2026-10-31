import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportUnexpectedError } from "../../Lib/Report/Report";

type Props = { children: ReactNode; reload?: () => void };

export class FinalBoundary extends Component<Props, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error, _info: ErrorInfo) {
		reportUnexpectedError(error);
	}

	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<main role="alert">
				<h1>Forge could not start</h1>
				<p>Reload the page to try again.</p>
				<button type="button" onClick={this.props.reload ?? (() => window.location.reload())}>
					Reload Forge
				</button>
			</main>
		);
	}
}
