import { COLLECTIONS } from "../config.js";

export function createWeeklyRequestsRepository(database) {
  return {
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    items: () => database.collection(COLLECTIONS.ITEMS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES)
  };
}

