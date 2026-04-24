import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

let overlayCreated = false;

export function createOverlayWindow(): void {
  if (overlayCreated) return;
  // Check if Tauri IPC is available
  if (!(window as any).__TAURI_INTERNALS__) return;

  overlayCreated = true;

  const overlay = new WebviewWindow("overlay", {
    url: "index.html?page=overlay",
    title: "Vision Overlay",
    width: 220,
    height: 70,
    x: 20,
    y: 60,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
    focus: false,
  });

  overlay.once("tauri://error", () => {
    overlayCreated = false;
  });
}

export async function destroyOverlayWindow(): Promise<void> {
  try {
    const overlay = WebviewWindow.getByLabel("overlay");
    if (overlay) {
      await overlay.close();
    }
  } catch {
    // ignore
  }
  overlayCreated = false;
}
