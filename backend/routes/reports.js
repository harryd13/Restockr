import { registerReportRoutesController } from "../controllers/reports.controller.js";
import { createReportsService } from "../services/reports.service.js";
import { createReportsRepository } from "../repositories/reports.repository.js";

export function registerReportRoutes(app, options) {
  const repository = createReportsRepository(options.getDb);
  createReportsService(repository);
  registerReportRoutesController(app, { ...options, repository });
}
