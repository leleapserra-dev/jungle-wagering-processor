export interface UnitOfWork {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  run<T>(work: () => Promise<T>): Promise<T>;
}
