import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/auth/authenticated-principal.js';
import type { Database } from '../../../src/db/db-client.js';
import { users } from '../../../src/db/schema.js';
import type { PostgresUserRepository } from '../../../src/user/postgres-user-repository.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';

describe('PostgresUserRepository', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let repository: PostgresUserRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    process.env['DATABASE_URL'] = container.getConnectionUri();

    const [databaseModule, repositoryModule] = await Promise.all([
      import('../../../src/db/db-client.js'),
      import('../../../src/user/postgres-user-repository.js'),
    ]);

    database = databaseModule.db;
    closeDatabase = databaseModule.closeDatabase;
    repository = new repositoryModule.PostgresUserRepository();

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('maps an active email conflict while creating a user', async () => {
    const existingPrincipal = makePrincipal('existing-subject', 'shared@example.com');
    const conflictingPrincipal = makePrincipal('new-subject', 'shared@example.com');

    await expect(repository.createFromPrincipal(existingPrincipal)).resolves.toMatchObject({
      email: existingPrincipal.email,
      deletedAt: null,
    });

    await expect(repository.createFromPrincipal(conflictingPrincipal)).rejects.toMatchObject({
      code: 'user_identity_conflict',
    });

    const storedUsers = await database.select().from(users);
    expect(storedUsers).toHaveLength(1);
    expect(storedUsers[0]).toMatchObject({
      subject: existingPrincipal.subject,
      email: existingPrincipal.email,
    });
  });

  it('maps an active email conflict and rolls back the entire profile update', async () => {
    const first = await repository.createFromPrincipal(
      makePrincipal('first-subject', 'first@example.com', 'first'),
    );
    const second = await repository.createFromPrincipal(
      makePrincipal('second-subject', 'second@example.com', 'second'),
    );

    if (first === null || second === null) {
      throw new Error('Failed to create integration test users');
    }

    await expect(
      repository.updateProfileById(second.id, {
        email: first.email,
        firstName: 'Changed',
        lastName: 'Profile',
      }),
    ).rejects.toMatchObject({
      code: 'user_identity_conflict',
    });

    const [storedSecond] = await database.select().from(users).where(eq(users.id, second.id));
    expect(storedSecond).toMatchObject({
      email: second.email,
      firstName: second.firstName,
      lastName: second.lastName,
    });
  });

  it('allows a new identity to use an email after the old user is soft deleted', async () => {
    const oldUser = await repository.createFromPrincipal(
      makePrincipal('old-subject', 'reused@example.com'),
    );

    if (oldUser === null) {
      throw new Error('Failed to create integration test user');
    }

    await database
      .update(users)
      .set({ deletedAt: new Date('2026-08-01T00:00:00.000Z') })
      .where(eq(users.id, oldUser.id));

    await expect(
      repository.createFromPrincipal(makePrincipal('new-subject', 'reused@example.com')),
    ).resolves.toMatchObject({
      email: 'reused@example.com',
      deletedAt: null,
    });
  });
});

function makePrincipal(
  subject: string,
  email: string,
  firstName = 'Test',
  lastName = 'User',
): AuthenticatedPrincipal {
  return {
    issuer: ISSUER,
    subject,
    email,
    firstName,
    lastName,
  };
}
