export function createReportsService(repository) {
  return { get database() { return repository.database; } };
}

