import { registerWeeklyRequestRoutesController } from "../controllers/weekly-requests.controller.js";
import { createWeeklyRequestsRepository } from "../repositories/weekly-requests.repository.js";

export function registerWeeklyRequestRoutes(context) {
  const repository = createWeeklyRequestsRepository(context.db);
  registerWeeklyRequestRoutesController({ ...context, repository });
}





