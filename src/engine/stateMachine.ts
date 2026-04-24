import { GestureResult } from "./gestureClassifier";

export type MachineState = "idle" | "armed" | "fired" | "cooldown";

export interface StateMachineConfig {
  /** Min ms a gesture must be held to count */
  debounceMs: number;
  /** Cooldown ms after firing before returning to idle */
  cooldownMs: number;
  /** Minimum confidence to accept a gesture */
  confidenceThreshold: number;
  /** The gesture that arms the system */
  activationGesture: string;
}

export interface StateMachineOutput {
  state: MachineState;
  /** The gesture that was fired (only set briefly when state === "fired") */
  firedGesture: string | null;
  /** How long the current gesture has been held */
  holdDurationMs: number;
  /** Time remaining in cooldown */
  cooldownRemainingMs: number;
}

const DEFAULT_CONFIG: StateMachineConfig = {
  debounceMs: 200,
  cooldownMs: 500,
  confidenceThreshold: 0.7,
  activationGesture: "open_palm",
};

export class GestureStateMachine {
  private state: MachineState = "idle";
  private config: StateMachineConfig;

  // Debounce tracking
  private currentGesture: string = "none";
  private gestureStartTime: number = 0;

  // Cooldown tracking
  private cooldownStartTime: number = 0;

  // Fired gesture
  private firedGesture: string | null = null;

  constructor(config?: Partial<StateMachineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Feed new gesture results from the classifier.
   * Call this every frame. Returns the current machine output.
   */
  update(gestures: GestureResult[], now: number = performance.now()): StateMachineOutput {
    // Pick the best gesture across all hands that meets the confidence threshold
    const validGestures = gestures.filter(
      (g) => g.gesture !== "none" && g.confidence >= this.config.confidenceThreshold
    );

    // Pick highest confidence gesture
    const best = validGestures.length > 0
      ? validGestures.reduce((a, b) => (a.confidence > b.confidence ? a : b))
      : null;

    const detectedGesture: string = best?.gesture ?? "none";

    // Track how long the same gesture is held
    if (detectedGesture !== this.currentGesture) {
      this.currentGesture = detectedGesture;
      this.gestureStartTime = now;
    }

    const holdDuration = now - this.gestureStartTime;
    const debounced = holdDuration >= this.config.debounceMs;

    switch (this.state) {
      case "idle":
        this.firedGesture = null;
        // Wait for activation gesture (debounced)
        if (detectedGesture === this.config.activationGesture && debounced) {
          this.state = "armed";
          // Reset tracking so next gesture starts fresh
          this.currentGesture = "none";
          this.gestureStartTime = now;
        }
        break;

      case "armed":
        this.firedGesture = null;
        // If activation gesture is still held, stay armed
        if (detectedGesture === this.config.activationGesture) {
          break;
        }
        // If a different gesture is detected and debounced, fire it
        if (
          detectedGesture !== "none" &&
          detectedGesture !== this.config.activationGesture &&
          debounced
        ) {
          this.firedGesture = detectedGesture;
          this.state = "fired";
          this.cooldownStartTime = now;
        }
        // If no gesture detected for a while, go back to idle
        if (detectedGesture === "none" && holdDuration > 1000) {
          this.state = "idle";
        }
        break;

      case "fired":
        // Immediately transition to cooldown
        this.state = "cooldown";
        this.cooldownStartTime = now;
        break;

      case "cooldown":
        if (now - this.cooldownStartTime >= this.config.cooldownMs) {
          this.state = "idle";
          this.firedGesture = null;
          this.currentGesture = "none";
          this.gestureStartTime = now;
        }
        break;
    }

    return {
      state: this.state,
      firedGesture: this.firedGesture,
      holdDurationMs: holdDuration,
      cooldownRemainingMs:
        this.state === "cooldown"
          ? Math.max(0, this.config.cooldownMs - (now - this.cooldownStartTime))
          : 0,
    };
  }

  getState(): MachineState {
    return this.state;
  }

  reset(): void {
    this.state = "idle";
    this.currentGesture = "none";
    this.gestureStartTime = 0;
    this.cooldownStartTime = 0;
    this.firedGesture = null;
  }

  updateConfig(config: Partial<StateMachineConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
