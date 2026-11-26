import { and, eq, isNull } from 'drizzle-orm';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import type { Database } from '../db/db-client.js';
import { users } from '../db/schema.js';
import type { UserRepository } from './user-repository.js';
import type { User } from './user.js';
import { mapUserDatabaseError } from './map-user-db-error.js';

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByPrincipal(principal: AuthenticatedPrincipal): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.issuer, principal.issuer), eq(users.subject, principal.subject)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async createFromPrincipal(principal: AuthenticatedPrincipal): Promise<User | null> {
    try {
      const [savedUser] = await this.db
        .insert(users)
        .values(this.toInsert(principal))
        .onConflictDoNothing({ target: [users.issuer, users.subject] })
        .returning();

      return savedUser ? this.toDomain(savedUser) : null;
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  async updateProfileById(
    id: number,
    profile: { email: string; firstName: string; lastName: string },
  ): Promise<User> {
    try {
      const [row] = await this.db
        .update(users)
        .set({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();

      if (!row) {
        throw new Error('User update failed');
      }

      return this.toDomain(row);
    } catch (error) {
      throw mapUserDatabaseError(error);
    }
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      publicId: row.publicId,
      issuer: row.issuer,
      subject: row.subject,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  private toInsert(principal: AuthenticatedPrincipal): typeof users.$inferInsert {
    return {
      issuer: principal.issuer,
      subject: principal.subject,
      email: principal.email,
      firstName: principal.firstName,
      lastName: principal.lastName,
    };
  }
}
