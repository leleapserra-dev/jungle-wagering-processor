import { MikroORM } from '@mikro-orm/postgresql';
import { createOrmOptions } from '../config/database.config';

type Direction = 'up' | 'down';

function parseDirection(value: string | undefined): Direction {
  if (value === undefined || value === 'up') return 'up';
  if (value === 'down') return 'down';
  throw new Error(`Invalid migration direction "${value}". Use "up" or "down".`);
}

function readSettings() {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const poolSize = Number(process.env.DATABASE_POOL_SIZE ?? '10');
  const ssl = (process.env.DATABASE_SSL ?? 'false') === 'true';
  return { url, poolSize: Number.isFinite(poolSize) ? poolSize : 10, ssl };
}

async function main(): Promise<void> {
  const direction = parseDirection(process.argv[2]);
  const orm = await MikroORM.init(createOrmOptions(readSettings()));
  try {
    const migrator = orm.getMigrator();
    if (direction === 'up') {
      await migrator.up();
    } else {
      await migrator.down();
    }
  } finally {
    await orm.close(true);
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Migration failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
