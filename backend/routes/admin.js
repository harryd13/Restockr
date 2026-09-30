import { registerAdminRoutesController } from "../controllers/admin.controller.js";
import { createAdminRepository } from "../repositories/admin.repository.js";
import { createAdminService } from "../services/admin.service.js";

export function registerAdminRoutes(context) {
  const repository = createAdminRepository(context.db);
  const service = createAdminService({ ...context, repository });
  registerAdminRoutesController({ app: context.app, authMiddleware: context.authMiddleware, service });
}






