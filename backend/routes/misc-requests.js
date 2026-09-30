import { registerMiscRequestRoutesController } from "../controllers/misc-requests.controller.js";
import { createMiscRequestsRepository } from "../repositories/misc-requests.repository.js";

export function registerMiscRequestRoutes(context) {
  const repository = createMiscRequestsRepository(context.db);
  registerMiscRequestRoutesController({ ...context, repository });
}





