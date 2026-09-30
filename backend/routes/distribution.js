import { registerDistributionRoutesController } from "../controllers/distribution.controller.js";
import { createDistributionService } from "../services/distribution.service.js";
import { createDistributionRepository } from "../repositories/distribution.repository.js";

export function registerDistributionRoutes(context) {
  const repository = createDistributionRepository(context.db);
  const service = createDistributionService(repository, context);
  registerDistributionRoutesController({ ...context, repository, service });
}




