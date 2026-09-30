import { COLLECTIONS } from "../config.js";

export function createExpenseTicketsRepository(database) {
  return {
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS),
    expenseTicketLogs: () => database.collection(COLLECTIONS.EXPENSE_TICKET_LOGS),
    branches: () => database.collection(COLLECTIONS.BRANCHES)
  };
}

