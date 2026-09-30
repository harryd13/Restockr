import { COLLECTIONS } from "../config.js";

export function createDailyRequestsRepository(database) {
  return {
    dailyRequests: () => database.collection(COLLECTIONS.DAILY_REQUESTS),
    dailyRequestItems: () => database.collection(COLLECTIONS.DAILY_REQUEST_ITEMS),
    items: () => database.collection(COLLECTIONS.ITEMS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES),
    tickets: () => database.collection(COLLECTIONS.TICKETS),
    ticketItems: () => database.collection(COLLECTIONS.TICKET_ITEMS),
    branches: () => database.collection(COLLECTIONS.BRANCHES)
  };
}

