import { COLLECTIONS } from "../config.js";

export function createTicketsRepository(database) {
  return {
    tickets: () => database.collection(COLLECTIONS.TICKETS),
    ticketItems: () => database.collection(COLLECTIONS.TICKET_ITEMS),
    expenseLogs: () => database.collection(COLLECTIONS.EXPENSE_LOGS)
  };
}

