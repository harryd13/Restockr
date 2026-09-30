import { registerDailyRequestRoutesController } from "../controllers/daily-requests.controller.js";
import { createDailyRequestsRepository } from "../repositories/daily-requests.repository.js";

export function registerDailyRequestRoutes(context) {
  const repository = createDailyRequestsRepository(context.db);
  registerDailyRequestRoutesController({ ...context, repository });
}





