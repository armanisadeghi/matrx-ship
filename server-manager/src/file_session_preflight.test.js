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
  const dir = mkdtempSync(join(tmpdir(), 'files-preflight-command-'));
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

test('automatic Files upgrade checks installed candidate with same config before any removal', () => {
  const result = execute(api.msUpgradeScript(api.MICROSERVICES['matrx-files'], '1.2.3', 'ZHVtbXk='), 'upgrade');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /UPGRADE_BLOCKED/);
  assert.ok(result.commands.some(line => line.includes('--env-file /etc/matrx-files.env') && line.includes('--entrypoint python matrx-files:1.2.3 -m matrx_files.standalone.preflight')));
  assert.ok(!result.commands.some(line => line.startsWith('docker rm -f')));
});

test('Files Secrets Apply refuses unarmed old image before removal', () => {
  const result = execute(api.msRestartCommand(api.MICROSERVICES['matrx-files']), 'restart');
  assert.equal(result.status, 3, result.output);
  assert.match(result.output, /APPLY_BLOCKED/);
  assert.ok(!result.commands.some(line => line.startsWith('docker rm -f')));
});

test('failure rollback never removes candidate to restore an unarmed image', () => {
  const result = execute(api.msUpgradeScript(api.MICROSERVICES['matrx-files'], '1.2.3', 'ZHVtbXk='), 'rollback');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ROLLBACK_BLOCKED/);
  assert.equal(result.commands.filter(line => line.startsWith('docker rm -f')).length, 1);
  assert.ok(!result.commands.some(line => line.startsWith('docker run -d') && line.includes('matrx-files:old')));
});

test('services without this declared policy keep their existing commands', () => {
  assert.equal(api.msPreflightImage(api.MICROSERVICES['matrx-seo'], 'seo:version'), ':');
});
