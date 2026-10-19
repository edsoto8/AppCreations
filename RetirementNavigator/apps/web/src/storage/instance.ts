import { openDatabase } from './db';
import { DocumentRepository } from './repository';

let repo: Promise<DocumentRepository> | null = null;

/** The app's repository (opened once). */
export function getRepository(): Promise<DocumentRepository> {
  repo ??= openDatabase().then((db) => new DocumentRepository(db));
  return repo;
}
