import { registerCombinedPurchaseRoutesController } from "../controllers/combined-purchases.controller.js";
import { createCombinedPurchasesRepository } from "../repositories/combined-purchases.repository.js";
import { createCombinedPurchasesService } from "../services/combined-purchases.service.js";

export function registerCombinedPurchaseRoutes(context) {
  const repository = createCombinedPurchasesRepository(context.db);
  const service = createCombinedPurchasesService({ ...context, repository });
  registerCombinedPurchaseRoutesController({ app: context.app, authMiddleware: context.authMiddleware, service });
}






