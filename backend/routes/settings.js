import { registerSettingsRoutesController } from "../controllers/settings.controller.js";
import { createSettingsRepository } from "../repositories/settings.repository.js";

export function registerSettingsRoutes(context) {
  const repository = createSettingsRepository(context.db);
  registerSettingsRoutesController({ ...context, repository });
}





