import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, RANK, isManager, meetsMinimum, canAssignRole, canRemoveMember,
} from '../team-server/src/permissions.js';

test('role hierarchy includes workspace admins between owners and editors', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'editor', 'viewer']);
  assert.ok(RANK.admin > RANK.editor && RANK.owner > RANK.admin && RANK.editor > RANK.viewer);
  assert.equal(meetsMinimum('admin', 'editor'), true);
  assert.equal(meetsMinimum('editor', 'admin'), false);
  assert.equal(isManager('admin'), true);
  assert.equal(isManager('viewer'), false);
});

test('admins can add and manage admins, editors and viewers', () => {
  for (const role of ['admin', 'editor', 'viewer']) {
    assert.equal(canAssignRole({ actorRole: 'admin', targetRole: 'editor', nextRole: role }), true, role);
    assert.equal(canAssignRole({ actorRole: 'admin', targetRole: 'admin', nextRole: role }), true, role);
  }
});

test('only owners can grant or change ownership', () => {
  assert.equal(canAssignRole({ actorRole: 'admin', targetRole: 'editor', nextRole: 'owner' }), false);
  assert.equal(canAssignRole({ actorRole: 'admin', targetRole: 'owner', nextRole: 'editor' }), false);
  assert.equal(canAssignRole({ actorRole: 'owner', targetRole: 'editor', nextRole: 'owner' }), true);
  assert.equal(canAssignRole({ actorRole: 'owner', targetRole: 'owner', nextRole: 'admin' }), true);
});

test('editors and viewers cannot manage members', () => {
  assert.equal(canAssignRole({ actorRole: 'editor', targetRole: 'viewer', nextRole: 'admin' }), false);
  assert.equal(canAssignRole({ actorRole: 'viewer', targetRole: 'viewer', nextRole: 'editor' }), false);
  assert.equal(canRemoveMember({ actorRole: 'editor', targetRole: 'viewer' }), false);
});

test('admins can remove members but not owners', () => {
  assert.equal(canRemoveMember({ actorRole: 'admin', targetRole: 'viewer', ownerCount: 1 }), true);
  assert.equal(canRemoveMember({ actorRole: 'admin', targetRole: 'admin', ownerCount: 1 }), true);
  assert.equal(canRemoveMember({ actorRole: 'admin', targetRole: 'owner', ownerCount: 2 }), false);
  assert.equal(canRemoveMember({ actorRole: 'owner', targetRole: 'owner', ownerCount: 2 }), true);
  assert.equal(canRemoveMember({ actorRole: 'owner', targetRole: 'owner', ownerCount: 1 }), false);
});

test('self-removal is allowed except for the final owner', () => {
  assert.equal(canRemoveMember({ actorRole: 'editor', targetRole: 'editor', isSelf: true }), true);
  assert.equal(canRemoveMember({ actorRole: 'owner', targetRole: 'owner', isSelf: true, ownerCount: 1 }), false);
  assert.equal(canRemoveMember({ actorRole: 'owner', targetRole: 'owner', isSelf: true, ownerCount: 2 }), true);
});
