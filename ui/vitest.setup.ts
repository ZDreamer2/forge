import "@testing-library/react/dont-cleanup-after-each";
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent: () => false,
		}),
	});
	window.scrollTo = () => {};
}
