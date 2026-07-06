import { and, eq } from 'drizzle-orm';
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

  async updateUsernameById(id: number, newUsername: string): Promise<User> {
    const [row] = await db
      .update(users)
      .set({ username: newUsername, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!row) {
      throw new Error('User update failed');
    }

    return this.toDomain(row);
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      issuer: row.issuer,
      subject: row.subject,
      username: row.username,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toInsert(principal: AuthenticatedPrincipal): typeof users.$inferInsert {
    return {
      issuer: principal.issuer,
      subject: principal.subject,
      username: principal.username,
    };
  }
}
