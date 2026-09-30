import { COLLECTIONS } from "../config.js";

export function createAdminRepository(database) {
  return {
    settings: () => database.collection(COLLECTIONS.SETTINGS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES),
    items: () => database.collection(COLLECTIONS.ITEMS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    branches: () => database.collection(COLLECTIONS.BRANCHES),
    users: () => database.collection(COLLECTIONS.USERS),
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS)
  };
}

