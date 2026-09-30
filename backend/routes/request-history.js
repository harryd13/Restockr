import { registerRequestHistoryRoutesController } from "../controllers/request-history.controller.js";
import { createRequestHistoryRepository } from "../repositories/request-history.repository.js";

export function registerRequestHistoryRoutes(context) {
  const repository = createRequestHistoryRepository(context.db);
  registerRequestHistoryRoutesController({ ...context, repository });
}





