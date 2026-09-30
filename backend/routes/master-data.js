import { registerMasterDataRoutesController } from "../controllers/master-data.controller.js";
import { createMasterDataService } from "../services/master-data.service.js";
import { createMasterDataRepository } from "../repositories/master-data.repository.js";

export function registerMasterDataRoutes(app, options) {
  const repository = createMasterDataRepository(options.getDb);
  createMasterDataService(repository);
  registerMasterDataRoutesController(app, { ...options, repository });
}
