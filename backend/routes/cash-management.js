import { registerCashManagementRoutesController } from "../controllers/cash-management.controller.js";
import { createCashManagementRepository } from "../repositories/cash-management.repository.js";
import { createCashManagementService } from "../services/cash-management.service.js";

export function registerCashManagementRoutes(context) {
  const repository = createCashManagementRepository(context.db);
  const service = createCashManagementService({ ...context, repository });
  registerCashManagementRoutesController({ app: context.app, authMiddleware: context.authMiddleware, service });
}






