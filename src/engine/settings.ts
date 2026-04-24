export interface AppSettings {
  cameraDeviceId: string;
  confidenceThreshold: number;
  showOverlayHUD: boolean;
}

const SETTINGS_KEY = "vision-app-settings";

const DEFAULT_SETTINGS: AppSettings = {
  cameraDeviceId: "",
  confidenceThreshold: 0.7,
  showOverlayHUD: false,
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
