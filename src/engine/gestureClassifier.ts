import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface GestureResult {
  gesture: string; // "open_palm" or user-defined name, "none" if no match
  confidence: number;
  handIndex: number;
  handedness: string;
}

export interface GestureTemplate {
  name: string;
  /** Normalized landmark positions (wrist-relative, scale-invariant) */
  landmarks: number[]; // flattened [x0,y0,z0, x1,y1,z1, ...] — 63 values
}

/**
 * Normalize landmarks: translate so wrist is origin, scale by hand size.
 * Returns a flat array of 63 values (21 landmarks × 3 coords).
 */
export function normalizeLandmarks(landmarks: NormalizedLandmark[]): number[] {
  const wrist = landmarks[0];
  // Find scale: distance from wrist to middle finger MCP (landmark 9)
  const scale = Math.sqrt(
    (landmarks[9].x - wrist.x) ** 2 +
    (landmarks[9].y - wrist.y) ** 2 +
    (landmarks[9].z - wrist.z) ** 2
  ) || 1;

  const result: number[] = [];
  for (const lm of landmarks) {
    result.push(
      (lm.x - wrist.x) / scale,
      (lm.y - wrist.y) / scale,
      (lm.z - wrist.z) / scale
    );
  }
  return result;
}

/**
 * Compare two normalized landmark arrays. Returns similarity 0..1 (1 = identical).
 */
function compareLandmarks(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sumSqDiff = 0;
  for (let i = 0; i < a.length; i++) {
    sumSqDiff += (a[i] - b[i]) ** 2;
  }
  const rmsDist = Math.sqrt(sumSqDiff / a.length);
  // Convert distance to similarity: 0 distance → 1.0, large distance → 0.0
  // Typical rmsDist for same gesture is < 0.3, different gesture > 0.6
  return Math.max(0, 1 - rmsDist * 1.5);
}

// --- Open palm detection (hardcoded for activation gesture) ---

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
  );
}

function isFingerExtended(
  landmarks: NormalizedLandmark[],
  tip: number,
  dip: number,
  pip: number,
  mcp: number
): boolean {
  const wrist = landmarks[0];
  const tipDist = distance(landmarks[tip], wrist);
  const pipDist = distance(landmarks[pip], wrist);
  const tipToMcp = distance(landmarks[tip], landmarks[mcp]);
  const dipToMcp = distance(landmarks[dip], landmarks[mcp]);
  return tipDist > pipDist && tipToMcp > dipToMcp;
}

function detectOpenPalm(landmarks: NormalizedLandmark[]): number {
  const fingers = [
    isFingerExtended(landmarks, 8, 7, 6, 5),
    isFingerExtended(landmarks, 12, 11, 10, 9),
    isFingerExtended(landmarks, 16, 15, 14, 13),
    isFingerExtended(landmarks, 20, 19, 18, 17),
  ];
  const thumbSpread = distance(landmarks[4], landmarks[5]) > 0.08;
  const extendedCount = fingers.filter(Boolean).length;
  if (extendedCount >= 4 && thumbSpread) return 1.0;
  if (extendedCount >= 3 && thumbSpread) return 0.6;
  return 0;
}

// --- Main classifier ---

/**
 * Classify a hand against stored templates + hardcoded open_palm.
 */
export function classifyGesture(
  landmarks: NormalizedLandmark[],
  handIndex: number,
  handedness: string,
  templates: GestureTemplate[] = []
): GestureResult {
  // Always check open palm (activation gesture)
  const palmConf = detectOpenPalm(landmarks);
  if (palmConf >= 0.6) {
    return { gesture: "open_palm", confidence: palmConf, handIndex, handedness };
  }

  // Match against user-defined templates
  if (templates.length === 0) {
    return { gesture: "none", confidence: 0, handIndex, handedness };
  }

  const normalized = normalizeLandmarks(landmarks);
  let bestMatch = { name: "none", confidence: 0 };

  for (const template of templates) {
    const similarity = compareLandmarks(normalized, template.landmarks);
    if (similarity > bestMatch.confidence) {
      bestMatch = { name: template.name, confidence: similarity };
    }
  }

  if (bestMatch.confidence < 0.55) {
    return { gesture: "none", confidence: 0, handIndex, handedness };
  }

  return {
    gesture: bestMatch.name,
    confidence: bestMatch.confidence,
    handIndex,
    handedness,
  };
}
