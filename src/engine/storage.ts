import { GestureMapping } from "./actionDispatcher";
import { GestureTemplate } from "./gestureClassifier";

const MAPPINGS_KEY = "vision-gesture-mappings";
const TEMPLATES_KEY = "vision-gesture-templates";

export function loadMappings(): GestureMapping[] | null {
  try {
    const raw = localStorage.getItem(MAPPINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GestureMapping[];
  } catch {
    return null;
  }
}

export function saveMappings(mappings: GestureMapping[]): void {
  localStorage.setItem(MAPPINGS_KEY, JSON.stringify(mappings));
}

export function loadTemplates(): GestureTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GestureTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: GestureTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}
