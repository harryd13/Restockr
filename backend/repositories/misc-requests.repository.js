import { COLLECTIONS } from "../config.js";

export function createMiscRequestsRepository(database) {
  return {
    miscRequests: () => database.collection(COLLECTIONS.MISC_REQUESTS),
    miscRequestItems: () => database.collection(COLLECTIONS.MISC_REQUEST_ITEMS),
    tickets: () => database.collection(COLLECTIONS.TICKETS),
    ticketItems: () => database.collection(COLLECTIONS.TICKET_ITEMS)
  };
}

