/**
 * The single source of truth for the active-entitlement uniqueness constraint.
 *
 * grantEntitlement()'s ON CONFLICT target MUST match the partial unique index
 * "product_entitlements_owner_product_active_unique" EXACTLY:
 *    UNIQUE ("owner_id", "product_key") WHERE status = 'active'
 *
 * Matching a 3-column target (owner_id, product_key, status) would reference an
 * index that does not exist and Postgres rejects the INSERT with
 * "there is no unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * This module imports ONLY the schema (no DB client) so it is safe to load under
 * `node --test` and the migration regression test can prove the service's INSERT
 * matches the index the migration actually created.
 */

import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core/dialect";
import { productEntitlements } from "../../db/schema.ts";

export const ACTIVE_ENTITLEMENT_CONFLICT: {
  target: [typeof productEntitlements.ownerId, typeof productEntitlements.productKey];
  where: ReturnType<typeof sql>;
} = {
  target: [productEntitlements.ownerId, productEntitlements.productKey],
  where: sql`${productEntitlements.status} = 'active'`,
};

/**
 * Pure description of the conflict target, used by the migration regression test
 * to prove the INSERT matches the partial index. Renders the predicate with the
 * Postgres dialect (no DB/network) so it can be compared against the migration.
 */
export function activeEntitlementConflictInfo(): { columns: string[]; predicate: string } {
  const d = new PgDialect();
  return {
    columns: ACTIVE_ENTITLEMENT_CONFLICT.target.map((c) => c.name),
    predicate: d.sqlToQuery(ACTIVE_ENTITLEMENT_CONFLICT.where).sql,
  };
}