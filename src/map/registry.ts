/** Module-level access to the live scene controllers (for export and tours). */
import type { SceneController } from "./SceneController";

const controllers = new Map<"primary" | "compare", SceneController>();

export function registerController(slot: "primary" | "compare", controller: SceneController | null): void {
  if (controller) controllers.set(slot, controller);
  else controllers.delete(slot);
}

export function getController(slot: "primary" | "compare" = "primary"): SceneController | undefined {
  return controllers.get(slot);
}
