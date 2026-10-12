import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitsSession } from '../api/_lib/session-authority';

test('provider policy fails closed on malformed claims; ordinary roles remain a separate boundary', () => {
  for (const claims of [null, [], {}, { firebase: null }, { firebase: [] }, { firebase: {} },
    ...[true, 1, ['password'], {}, 'custom', 'google.com', ''].map(sign_in_provider => ({ firebase: { sign_in_provider } }))]) {
    assert.equal(admitsSession(claims, 'buyer'), false);
    assert.equal(admitsSession(claims, 'admin'), false);
  }
  assert.equal(admitsSession({ firebase: { sign_in_provider: 'password' } }, 'admin'), true);
  assert.equal(admitsSession({ firebase: { sign_in_provider: 'anonymous' } }, 'buyer'), true);
  assert.equal(admitsSession({ admin: true, firebase: { sign_in_provider: 'anonymous' } }, 'admin'), false);
});
