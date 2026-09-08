import test from 'node:test';
import assert from 'node:assert/strict';
import { FLEET_HOSTS, ssmRun, ec2Power, assertHostOperational } from './aws.js';

// Real retained fleet identities; no AWS calls are permitted by these refusal tests.
const retired = FLEET_HOSTS['matrx-python-server'];
test('retired replica is explicitly inventory-only', () => {
  assert.equal(retired.lifecycle, 'retired');
  assert.equal(FLEET_HOSTS['matrx-sandbox-host-dev'].lifecycle, 'active');
});
for (const action of ['start', 'stop', 'reboot']) {
  test(`retired host refuses ${action} before AWS dispatch`, async () => {
    await assert.rejects(ec2Power(action, retired.instanceId), { code: 'HOST_RETIRED' });
  });
}
test('all SSM consumers refuse the retired instance before credential lookup', async () => {
  await assert.rejects(ssmRun(retired.instanceId, 'true'), { code: 'HOST_RETIRED' });
});
test('active sandbox host remains admitted by the shared execution policy', () => {
  assert.doesNotThrow(() => assertHostOperational(FLEET_HOSTS['matrx-sandbox-host-dev'].instanceId));
});
