import { registerAuthRoutesController } from "../controllers/auth.controller.js";
import { createAuthService } from "../services/auth.service.js";
import { createAuthRepository } from "../repositories/auth.repository.js";

export function registerAuthRoutes(app, options) {
  const repository = createAuthRepository(options.getDb);
  createAuthService(repository);
  registerAuthRoutesController(app, { ...options, repository });
}
