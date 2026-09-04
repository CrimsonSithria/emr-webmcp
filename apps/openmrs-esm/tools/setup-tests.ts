import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// `getOpenmrsSpaBase` is installed on `window` by the app shell at runtime;
// jsdom doesn't have it, so a routed `<Root />` would throw on mount. Stub it
// here so route-aware components can be rendered in tests.
(window as unknown as { getOpenmrsSpaBase: () => string }).getOpenmrsSpaBase = () => '/openmrs/spa/';

// Node 25+ defines an inert `localStorage`/`sessionStorage` accessor (undefined unless
// --localstorage-file is passed) that vitest's jsdom environment does not override, and
// @openmrs/esm-feature-flags enumerates localStorage at import time. Borrow the real
// jsdom Storage in that case; on the pinned Node 22 both are already jsdom's.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow !== undefined) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const current = (globalThis as Record<string, unknown>)[key];
    if (typeof current !== 'object' || current === null) {
      Object.defineProperty(globalThis, key, { value: jsdomWindow[key], configurable: true, writable: true });
    }
  }
}

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLFormElement.prototype.requestSubmit = vi.fn();
window.matchMedia = vi.fn().mockImplementation(() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}));

// Mock ResizeObserver for Carbon components. vi.fn().mockImplementation(...)
// is not constructable, so use a class so `new ResizeObserver(...)` works.
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};
