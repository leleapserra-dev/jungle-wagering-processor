import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { UnitOfWork } from '../application/unit-of-work';

@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async begin(): Promise<void> {
    await this.em.begin();
  }

  async commit(): Promise<void> {
    await this.em.commit();
  }

  async rollback(): Promise<void> {
    await this.em.rollback();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    return this.em.transactional(async () => work());
  }

  fork(): EntityManager {
    return this.em.fork();
  }

  getEntityManager(): EntityManager {
    return this.em;
  }
}
