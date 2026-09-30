import { registerTicketRoutesController } from "../controllers/tickets.controller.js";
import { createTicketsRepository } from "../repositories/tickets.repository.js";
import { createTicketsService } from "../services/tickets.service.js";

export function registerTicketRoutes(context) {
  const repository = createTicketsRepository(context.db);
  const service = createTicketsService({ ...context, repository });
  registerTicketRoutesController({ app: context.app, authMiddleware: context.authMiddleware, service });
}






