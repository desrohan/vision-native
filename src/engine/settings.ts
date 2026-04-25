export interface AppSettings {
  confidenceThreshold: number;
  showOverlayHUD: boolean;
  cursorEnabled: boolean;
  cursorSmoothing: number;
  cursorHand: "left" | "right";
  swipeEnabled: boolean;
}

const SETTINGS_KEY = "gestus-app-settings";

const DEFAULT_SETTINGS: AppSettings = {
  confidenceThreshold: 0.7,
  showOverlayHUD: false,
  cursorEnabled: false,
  cursorSmoothing: 0.7,
  cursorHand: "right",
  swipeEnabled: true,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
