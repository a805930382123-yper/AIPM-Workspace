import Database from 'better-sqlite3';

export function openSearchDatabase(filename: string) {
  return new Database(filename);
}
