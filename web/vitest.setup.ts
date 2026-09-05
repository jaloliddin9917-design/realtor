import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; components that observe element size (e.g. the MapLibre map
// wrapper, which resizes its WebGL buffer to the container) construct one at mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Run requestAnimationFrame synchronously in tests. Components that defer work to the next frame
// (e.g. the map wrapper defers creation one frame to dodge StrictMode's double-mount) should run
// that work inline under render()/act(), so assertions don't need to wait for a real frame.
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
