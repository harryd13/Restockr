import { COLLECTIONS } from "../config.js";

export function createRequestHistoryRepository(database) {
  return {
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS)
  };
}
