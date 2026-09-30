import { registerPurchaseRoutesController } from "../controllers/purchase.controller.js";
import { createPurchaseService } from "../services/purchase.service.js";
import { createPurchaseRepository } from "../repositories/purchase.repository.js";

export function registerPurchaseRoutes(context) {
  const repository = createPurchaseRepository(context.db);
  const service = createPurchaseService(repository, context);
  registerPurchaseRoutesController({ app: context.app, service, authMiddleware: context.authMiddleware, startOfWeek: context.startOfWeek });
}


