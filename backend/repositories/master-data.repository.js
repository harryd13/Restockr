import { COLLECTIONS } from "../config.js";

export function createMasterDataRepository(getDb) {
  return {
    branches: () => getDb().collection(COLLECTIONS.BRANCHES),
    categories: () => getDb().collection(COLLECTIONS.CATEGORIES),
    items: () => getDb().collection(COLLECTIONS.ITEMS)
  };
}
