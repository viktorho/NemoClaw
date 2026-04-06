import fs from "node:fs";
import { config } from "./config.js";

export interface DesktopState {
  alwaysOnTop: boolean;
  compactMode: boolean;
  windowVisible: boolean;
  theme: "dark-blue";
}

export interface AppSettings {
  alwaysOnTop: boolean;
  researchEnabled: boolean;
  leadMinutes: number;
}

interface PersistedState {
  desktop: DesktopState;
  settings: AppSettings;
}

const defaultDesktopState: DesktopState = {
  alwaysOnTop: true,
  compactMode: false,
  windowVisible: true,
  theme: "dark-blue",
};

const defaultSettings: AppSettings = {
  alwaysOnTop: true,
  researchEnabled: Boolean(config.tavilyApiKey),
  leadMinutes: config.reminderLeadMinutes,
};

function loadPersistedState(): PersistedState {
  try {
    const raw = fs.readFileSync(config.desktopStatePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      desktop: { ...defaultDesktopState, ...(parsed.desktop ?? {}) },
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return {
      desktop: { ...defaultDesktopState },
      settings: { ...defaultSettings },
    };
  }
}

function savePersistedState(state: PersistedState): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.desktopStatePath, JSON.stringify(state, null, 2));
}

const persisted = loadPersistedState();

export function getDesktopState(): DesktopState {
  return { ...persisted.desktop };
}

export function updateDesktopState(patch: Partial<DesktopState>): DesktopState {
  persisted.desktop = { ...persisted.desktop, ...patch };
  savePersistedState(persisted);
  return getDesktopState();
}

export function getAppSettings(): AppSettings {
  return { ...persisted.settings };
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  persisted.settings = { ...persisted.settings, ...patch };
  if (typeof patch.alwaysOnTop === "boolean") {
    persisted.desktop.alwaysOnTop = patch.alwaysOnTop;
  }
  savePersistedState(persisted);
  return getAppSettings();
}
