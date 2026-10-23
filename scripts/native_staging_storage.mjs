import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function validateNativeStorage(uuid, evidence, uid = process.getuid()) {
  const mount = evidence.mount;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid ?? '') ||
      !evidence.absolute || !evidence.real || !evidence.directory || evidence.uid !== uid ||
      !mount || mount.uuid !== uuid || mount.fstype !== 'ext4' || mount.target === '/' ||
      !mount.options.split(',').includes('rw')) {
    throw new Error('Native staging requires its enrolled writable SSD and an owned real directory.');
  }
}

export function assertNativeStorage(root, uuid) {
  const metadata = lstatSync(root);
  const result = JSON.parse(execFileSync('/usr/bin/findmnt',
    ['--json', '--target', root, '--output', 'UUID,TARGET,FSTYPE,OPTIONS'], { encoding: 'utf8' }));
  validateNativeStorage(uuid, {
    absolute: isAbsolute(root), real: realpathSync(root) === root,
    directory: metadata.isDirectory(), uid: metadata.uid,
    mount: result.filesystems?.length === 1 ? result.filesystems[0] : null,
  });
}
