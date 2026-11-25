// Workspace permission rules shared by the API and its tests.
// Strongest to weakest, matching the order used by the existing API checks.

export const ROLES = ['owner', 'admin', 'editor', 'viewer'];
export const RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export const isManager = (role) => role === 'owner' || role === 'admin';
export const meetsMinimum = (role, minimum = 'viewer') => {
  const a = RANK[role];
  const b = RANK[minimum];
  return Boolean(a && b && a >= b);
};

/**
 * A manager may change another member's role, but only an owner may touch an
 * owner or grant ownership. Admins can promote/demote other admins.
 */
export function canAssignRole({ actorRole, targetRole, nextRole }) {
  if (!ROLES.includes(nextRole)) return false;
  if (!isManager(actorRole)) return false;
  if (targetRole === 'owner' && actorRole !== 'owner') return false;
  if (nextRole === 'owner' && actorRole !== 'owner') return false;
  return true;
}

/**
 * Removing a member follows the same ownership rules. Admins can remove other
 * admins, but never an owner; an owner cannot remove the final owner.
 */
export function canRemoveMember({ actorRole, targetRole, ownerCount = 2, isSelf = false }) {
  if (isSelf) return targetRole === 'owner' ? ownerCount > 1 : true;
  if (!isManager(actorRole)) return false;
  if (targetRole === 'owner' && actorRole !== 'owner') return false;
  if (targetRole === 'owner' && ownerCount <= 1) return false;
  return true;
}

export function roleError(minimum) {
  if (minimum === 'owner') return 'Only owners can do that';
  if (minimum === 'admin') return 'Only workspace admins can do that';
  return 'You have view-only access here';
}
