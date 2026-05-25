// AWS control-plane clients for the Server Manager.
//
// Uses a DEDICATED admin credential (MATRX_ADMIN_AWS_*) — distinct from the
// matrx-server-backup credential the rest of the manager uses for S3 backups —
// so granting SSM/EC2 power doesn't disturb the existing S3 identity.
// Credentials live in /srv/apps/server-manager/.env (gitignored), never a repo.
//
// Clients are lazily constructed so the manager boots fine when AWS isn't
// configured (awsConfigured() === false) and every AWS route can 503 cleanly.

import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
  DescribeInstanceInformationCommand,
} from "@aws-sdk/client-ssm";
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
} from "@aws-sdk/client-ec2";

const REGION =
  process.env.MATRX_ADMIN_AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-1";

function creds() {
  const accessKeyId = process.env.MATRX_ADMIN_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MATRX_ADMIN_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey };
}

export function awsConfigured() {
  return creds() !== null;
}

export function awsRegion() {
  return REGION;
}

let _ssm = null;
let _ec2 = null;

function requireCreds() {
  const c = creds();
  if (!c) {
    throw new Error(
      "AWS admin credentials not configured — set MATRX_ADMIN_AWS_ACCESS_KEY_ID + MATRX_ADMIN_AWS_SECRET_ACCESS_KEY in /srv/apps/server-manager/.env",
    );
  }
  return c;
}

export function ssm() {
  return (_ssm ??= new SSMClient({ region: REGION, credentials: requireCreds() }));
}
export function ec2() {
  return (_ec2 ??= new EC2Client({ region: REGION, credentials: requireCreds() }));
}

// ── SSM ─────────────────────────────────────────────────────────────────────

// Run a shell command on an instance via SSM RunShellScript; poll to completion.
// Returns { status, stdout, stderr, exitCode, commandId }.
export async function ssmRun(instanceId, command, { timeout = 120, comment } = {}) {
  const client = ssm();
  const t = Math.min(Math.max(Number(timeout) || 120, 30), 600);
  const sent = await client.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: { commands: [command] },
      TimeoutSeconds: t,
      Comment: (comment || "matrx-manager").slice(0, 100),
    }),
  );
  const commandId = sent.Command.CommandId;
  const deadline = Date.now() + (t + 30) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const inv = await client.send(
        new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }),
      );
      if (["Success", "Failed", "Cancelled", "TimedOut"].includes(inv.Status)) {
        return {
          status: inv.Status,
          stdout: inv.StandardOutputContent || "",
          stderr: inv.StandardErrorContent || "",
          exitCode: inv.ResponseCode,
          commandId,
        };
      }
    } catch (e) {
      // InvocationDoesNotExist = not registered yet; keep polling.
      if (e.name !== "InvocationDoesNotExist") throw e;
    }
  }
  return { status: "TIMEOUT", stdout: "", stderr: "timed out waiting for SSM invocation", commandId };
}

// SSM-managed instance inventory (the "is the box online" check).
export async function ssmInstances() {
  const r = await ssm().send(new DescribeInstanceInformationCommand({ MaxResults: 50 }));
  return (r.InstanceInformationList || []).map((i) => ({
    instanceId: i.InstanceId,
    ping: i.PingStatus,
    platform: i.PlatformName,
    platformVersion: i.PlatformVersion,
    agent: i.AgentVersion,
    ip: i.IPAddress,
    name: i.ComputerName,
    lastPingAt: i.LastPingDateTime,
  }));
}

// ── EC2 ─────────────────────────────────────────────────────────────────────

export async function ec2Describe(instanceIds) {
  const r = await ec2().send(
    new DescribeInstancesCommand(instanceIds?.length ? { InstanceIds: instanceIds } : {}),
  );
  const out = [];
  for (const res of r.Reservations || []) {
    for (const inst of res.Instances || []) {
      out.push({
        instanceId: inst.InstanceId,
        state: inst.State?.Name,
        type: inst.InstanceType,
        az: inst.Placement?.AvailabilityZone,
        privateIp: inst.PrivateIpAddress,
        publicIp: inst.PublicIpAddress,
        name: (inst.Tags || []).find((t) => t.Key === "Name")?.Value || null,
        launchTime: inst.LaunchTime,
      });
    }
  }
  return out;
}

export async function ec2Power(action, instanceId) {
  const ids = [instanceId];
  if (action === "start") return ec2().send(new StartInstancesCommand({ InstanceIds: ids }));
  if (action === "stop") return ec2().send(new StopInstancesCommand({ InstanceIds: ids }));
  if (action === "reboot") return ec2().send(new RebootInstancesCommand({ InstanceIds: ids }));
  throw new Error(`unknown ec2 power action: ${action}`);
}

// Known Matrx fleet hosts. The A5 host-registry will formalize this; for now
// it gives A1/A3 a name→instance map and is the single source of host IDs.
export const FLEET_HOSTS = {
  "matrx-sandbox-host-dev": {
    instanceId: "i-084f757c1e47d4efb",
    role: "EC2-tier sandbox orchestrator",
    region: "us-east-1",
  },
  "matrx-python-server": {
    instanceId: "i-0241f4fee60fb02f6",
    role: "co-located AI Dream backend",
    region: "us-east-1",
  },
};
