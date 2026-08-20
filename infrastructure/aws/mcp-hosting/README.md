# AWS MCP hosting baseline

This standalone Terraform root enables the AI Matrx MCP Factory to create managed AWS App Runner
services without modifying the main ECS production stack. The canonical contract is
`common-docs/systems/mcp-hosting/FEATURE.md`.

It creates:

- an App Runner ECR pull role;
- a default runtime workload role with no AWS data permissions;
- a narrowly scoped deployer policy for `matrx-mcp/*` ECR repositories and `matrx-mcp-*` App Runner
  services;
- an attachment of that policy to the existing audited `matrx-production-operator` role.

The runtime role deliberately starts with zero permissions. A generated MCP that needs an AWS API
gets a separately reviewed least-privilege policy; it never receives an access key.

Apply this root once with the AWS bootstrap administrator. Routine MCP creation then uses the
restricted production operator profile.

```bash
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=mcp-hosting.tfplan
terraform show mcp-hosting.tfplan
terraform apply mcp-hosting.tfplan
terraform plan -detailed-exitcode
```

Do not use `-auto-approve`. No generated service or DNS record is created by this baseline.
