/**
 * WindowDragRegion — Invisible drag handle for frameless window.
 *
 * Uses pointer-events:none so ALL mouse events pass through to elements below
 * (buttons, inputs, search bar all work normally).
 *
 * -webkit-app-region:drag is processed at the Chromium compositor level,
 * NOT the DOM event level — so window dragging still works even with
 * pointer-events:none. This is the same technique used by VS Code.
 */

export default function WindowDragRegion() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 140, // Space for native window controls (min/max/close)
        height: 40,
        zIndex: 99999,
        pointerEvents: 'none',
        // @ts-expect-error — non-standard Electron/Chromium property
        WebkitAppRegion: 'drag',
      }}
    />
  );
}
