import { and, eq, isNull } from 'drizzle-orm';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import { db } from '../db/db-client.js';
import { users } from '../db/schema.js';
import type { UserRepository } from './user-repository.js';
import type { User } from './user.js';

export class PostgresUserRepository implements UserRepository {
  async findByPrincipal(principal: AuthenticatedPrincipal): Promise<User | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.issuer, principal.issuer), eq(users.subject, principal.subject)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async createFromPrincipal(principal: AuthenticatedPrincipal): Promise<User | null> {
    const [savedUser] = await db
      .insert(users)
      .values(this.toInsert(principal))
      .onConflictDoNothing({ target: [users.issuer, users.subject] })
      .returning();

    return savedUser ? this.toDomain(savedUser) : null;
  }

  async updateProfileById(
    id: number,
    profile: { email: string; username?: string },
  ): Promise<User> {
    const [row] = await db
      .update(users)
      .set({
        email: profile.email,
        ...(profile.username !== undefined ? { username: profile.username } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();

    if (!row) {
      throw new Error('User update failed');
    }

    return this.toDomain(row);
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      publicId: row.publicId,
      issuer: row.issuer,
      subject: row.subject,
      username: row.username,
      email: row.email,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  private toInsert(principal: AuthenticatedPrincipal): typeof users.$inferInsert {
    return {
      issuer: principal.issuer,
      subject: principal.subject,
      username: principal.username,
      email: principal.email,
    };
  }
}
