export function createInventoryService(repository) {
  return { database: { collection: (name) => repository.collection(name) } };
}

