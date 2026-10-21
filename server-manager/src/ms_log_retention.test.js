import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const start = source.indexOf('const MICROSERVICES =');
const end = source.indexOf('async function msDeploy(', start);
assert.ok(start >= 0 && end > start);
const sandbox = { process: { env: {} } };
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.api = { MICROSERVICES, msRestartCommand, msUpgradeScript, msPreflightImage };', sandbox);
const api = sandbox.api;

function execute(script, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'ms-log-retention-'));
  const log = join(dir, 'commands');
  const sudo = `#!/bin/sh
printf '%s\\n' "$*" >> "$PREFLIGHT_LOG"
case "$*" in
  'docker inspect '* ) echo 'matrx-files:old'; exit 0 ;;
  *'importlib.metadata'* ) echo '1.2.3'; exit 0 ;;
  *'matrx_files.standalone.preflight'* )
    [ "$PREFLIGHT_MODE" = rollback ] && case "$*" in *'matrx-files:1.2.3'*) exit 0 ;; esac
    exit 17 ;;
  'tee '*) cat >/dev/null; exit 0 ;;
esac
exit 0
`;
  const commands = { sudo, df: '#!/bin/sh\nprintf "Avail\\n99999999\\n"\n', curl: '#!/bin/sh\nprintf 503\n', sleep: '#!/bin/sh\nexit 0\n' };
  try {
    for (const [name, contents] of Object.entries(commands)) writeFileSync(join(dir, name), contents, { mode: 0o700 });
    const result = spawnSync('bash', ['-c', script], { env: { ...process.env, PATH: dir + ':' + process.env.PATH, PREFLIGHT_LOG: log, PREFLIGHT_MODE: mode }, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr, commands: readFileSync(log, 'utf8').split('\n') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The service's local json-file log used to die with every container swap
// (rm -f) and kept only 3 x 10 MB. Every swap now copies the log to the host
// first, and every run keeps 10 x 50 MB. Both are local-only: no IAM, no
// remote log driver, nothing that can stop the container from starting.

test('a Files swap archives the container log to the host before removing it', () => {
  // "rollback" mode: the candidate's preflight passes, so the swap runs.
  const result = execute(api.msUpgradeScript(api.MICROSERVICES['matrx-files'], '1.2.3', 'ZHVtbXk='), 'rollback');
  const archive = result.commands.findIndex(line => line.startsWith('sh -c docker logs --timestamps matrx-files > /var/log/matrx-files/'));
  const remove = result.commands.findIndex(line => line.startsWith('docker rm -f matrx-files'));
  assert.ok(remove >= 0, result.commands.join('\n'));
  assert.ok(archive >= 0 && archive < remove, 'the log was not archived before the container was removed');
});

test('every Files run keeps 10 x 50 MB of local json-file log', () => {
  const result = execute(api.msUpgradeScript(api.MICROSERVICES['matrx-files'], '1.2.3', 'ZHVtbXk='), 'rollback');
  const run = result.commands.find(line => line.startsWith('docker run -d --name matrx-files'));
  assert.ok(run, result.commands.join('\n'));
  assert.match(run, /--log-driver json-file --log-opt max-size=50m --log-opt max-file=10/);
});
