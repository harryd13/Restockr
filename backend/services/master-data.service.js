export function createMasterDataService(repository) {
  return { get database() { return repository.database; } };
}

