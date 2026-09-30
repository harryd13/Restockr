export function createRequestHistoryService(repository) {
  return { database: { collection: (name) => repository.collection(name) } };
}

