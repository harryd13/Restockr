import { COLLECTIONS } from "../config.js";

export function createInventoryRepository(database) {
  return {
    centralInventory: () => database.collection(COLLECTIONS.CENTRAL_INVENTORY),
    items: () => database.collection(COLLECTIONS.ITEMS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES),
    manualAdjustments: () => database.collection(COLLECTIONS.MANUAL_ADJUSTMENTS)
  };
}

