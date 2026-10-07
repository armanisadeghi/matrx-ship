---
name: secret-location-audit
description: Inventory, compare, rotate, or retire credentials across every local and hosted secret store. Use for key changes, env audits, incident cleanup, unexplained credential failures, or any request to determine everywhere a secret may exist across repositories, Git history, Coolify, Matrx Server Manager, Vercel, AWS, GCP, Supabase, GitHub, containers, hosts, and backups.
---

# Secret Location Audit

Build a complete consumer map before changing a credential. Treat an environment-variable update as unfinished until the running workload has restarted on the replacement, passed a real canary, and a final sweep finds no old fingerprint outside intentionally retained history or incident records.

## Workflow

1. Read repository and infrastructure instructions before touching files or consoles.
2. Identify the credential by provider resource ID, key ID, client ID, account, role, and a SHA-256 prefix. Never paste secret values into notes, chat, logs, shell arguments, screenshots, or source code.
3. Read [references/location-matrix.md](references/location-matrix.md) and turn every applicable row into a checked target. Add newly discovered stores; the matrix is a floor, not a ceiling.
4. Sweep configuration stores and running state separately. Map every runtime to the exact persisted source that its next restart/recreate will read. A saved replacement does not prove the old process stopped using its inherited environment, and a healthy replacement runtime does not prove its persisted source cannot resurrect the retired credential.
5. Record each consumer, owner, deployment, environment, access result, and evidence in a credential ledger. Use identifiers and fingerprints only.
6. For a live credential, create and canary a restricted replacement before editing consumers. Update every consumer, deploy/restart each workload, and test the real production path.
7. Rescan saved configuration and all running workloads for the old fingerprint. Only then revoke or delete the old provider resource.
8. Verify provider-side absence, repeat the full sweep, and give the user an exact residual-access list for anything inaccessible.

## Safety rules

- Prefer provider key IDs and resource names over secret-value searches. When value comparison is necessary, use `scripts/fingerprint_secret.py` through stdin.
- Never print environment values. Query names, resource metadata, hashes, status, and timestamps.
- Do not revoke first and repair later. Exceptions require proof that the credential has no consumer and explicit deletion authority.
- Do not assume local, production, or the primary account is the whole estate. Enumerate every project, account, region, environment, app, host, and stopped workload in scope.
- Include previews, build-time variables, image layers, stopped containers, old releases, backups, CI, developer machines, and Git history.
- Preserve unrelated dirty work. Use scoped edits and commits.
- Pause for sign-in or missing authority; never request or handle a password. Report the exact console, account/project, resource ID, and required action.
- For OAuth, distinguish client-secret rotation from user refresh-token revocation. Test personal and organization ownership separately without disconnecting a historical grant unless its current scopes and recovery path are known.

## Evidence gates

Do not call a rotation complete until all gates pass:

- replacement exists with least-privilege restrictions;
- provider API canary succeeds;
- every saved consumer configuration has the replacement fingerprint;
- every running consumer has restarted and exposes the replacement fingerprint or a successful credential-dependent health check;
- every runtime matches the persisted source used by its next restart/recreate, re-read from the provider after the save/apply operation;
- production behavior succeeds from the real URL;
- old fingerprint is absent from current stores and runtimes;
- old provider resource is disabled/deleted and confirmed absent;
- the final all-estate sweep is recorded;
- inaccessible residuals are assigned with exact identifiers.

## Deliverable

Report three sections: `Rotated/deleted`, `Verified consumers`, and `Residual action`. For each destructive action include provider, project/account, resource label, immutable ID or key ID, prior role, deletion time, recovery window if any, and verification evidence. Never include a secret value.

Update the project’s durable incident/operations record. Delete a temporary handoff only when no executable work remains; retain unresolved external resources in the durable record.
