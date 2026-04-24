import { invoke } from "@tauri-apps/api/core";

export type ActionType = "app_launch" | "keyboard_shortcut" | "url";

export interface GestureAction {
  type: ActionType;
  value: string;
  label?: string;
}

export interface GestureMapping {
  gesture: string; // user-defined gesture name
  action: GestureAction;
}

/**
 * Execute an action by calling the appropriate Tauri command.
 */
export async function executeAction(action: GestureAction): Promise<string> {
  switch (action.type) {
    case "app_launch":
      return invoke<string>("launch_app", { path: action.value });
    case "keyboard_shortcut":
      return invoke<string>("send_keyboard_shortcut", { keys: action.value });
    case "url":
      return invoke<string>("open_url", { url: action.value });
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * Look up the mapping for a gesture and execute it.
 */
export async function dispatchGesture(
  gesture: string,
  mappings: GestureMapping[]
): Promise<string | null> {
  const mapping = mappings.find((m) => m.gesture === gesture);
  if (!mapping) {
    console.log(`No mapping for gesture: ${gesture}`);
    return null;
  }

  console.log(`Executing: ${mapping.action.type} → ${mapping.action.value}`);
  try {
    const result = await executeAction(mapping.action);
    console.log(`Action result: ${result}`);
    return result;
  } catch (err) {
    console.error(`Action failed:`, err);
    throw err;
  }
}

/**
 * Empty default — user creates their own mappings.
 */
export const DEFAULT_MAPPINGS: GestureMapping[] = [];
