import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNativeStorage } from './native_staging_storage.mjs';

const uuid = '37481efc-4e6b-4479-b1fe-75457c13332b';
const evidence = { absolute: true, real: true, directory: true, uid: 1000,
  mount: { uuid, target: '/srv/storage', fstype: 'ext4', options: 'rw,relatime' } };

test('native staging accepts its enrolled writable SSD', () => {
  assert.doesNotThrow(() => validateNativeStorage(uuid, evidence, 1000));
});

test('native staging rejects another disk, read-only storage and unsafe paths', () => {
  for (const changed of [
    { absolute: false }, { real: false }, { directory: false }, { uid: 30021 },
    { mount: { ...evidence.mount, uuid: '00000000-0000-0000-0000-000000000000' } },
    { mount: { ...evidence.mount, options: 'ro,relatime' } },
    { mount: { ...evidence.mount, fstype: 'tmpfs' } },
    { mount: { ...evidence.mount, target: '/' } },
  ]) assert.throws(() => validateNativeStorage(uuid, { ...evidence, ...changed }, 1000));
  assert.throws(() => validateNativeStorage('', evidence, 1000));
});
