/**
 * Pure client-ownership predicate. A client row may only be written by the
 * coach whose id matches its `ownerId`. Dependency-free so it can be
 * unit-tested in isolation.
 */

export type ClientOwner = {
  id: number;
  ownerId: string;
};

export function isClientOwnedBy(
  client: ClientOwner | null | undefined,
  clientId: number,
  ownerId: string,
): boolean {
  return Boolean(client && client.id === clientId && client.ownerId === ownerId);
}
