import { registerInventoryRoutesController } from "../controllers/inventory.controller.js";
import { createInventoryRepository } from "../repositories/inventory.repository.js";

export function registerInventoryRoutes(context) {
  const repository = createInventoryRepository(context.db);
  registerInventoryRoutesController({ ...context, repository });
}





