import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; components that observe element size (e.g. the MapLibre map
// wrapper, which resizes its WebGL buffer to the container) construct one at mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
