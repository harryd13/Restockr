import { registerExpenseTicketRoutesController } from "../controllers/expense-tickets.controller.js";
import { createExpenseTicketsRepository } from "../repositories/expense-tickets.repository.js";
import { createExpenseTicketsService } from "../services/expense-tickets.service.js";

export function registerExpenseTicketRoutes(context) {
  const repository = createExpenseTicketsRepository(context.db);
  const service = createExpenseTicketsService({ ...context, repository });
  registerExpenseTicketRoutesController({ app: context.app, authMiddleware: context.authMiddleware, service });
}






