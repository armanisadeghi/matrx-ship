# AWS Terraform state

This isolated bootstrap root owns the production S3 backend used by Matrx Ship AWS stacks. The
bucket is private, `BucketOwnerEnforced`, SSE-S3 encrypted, versioned, TLS-only, and protected from
Terraform destroy. Terraform 1.15 native S3 lockfiles provide state locking; no DynamoDB table or
credential is stored in state.

Bootstrap is deliberately two-stage:

1. Initialize and apply this root locally after reviewing its additive plan.
2. Add the checked-in `backend.tf`, then run `terraform init -migrate-state -force-copy` so this
   root's own state moves into `s3://matrx-terraform-state-872515272894/aws/terraform-state/terraform.tfstate`.
3. Confirm a remote plan is empty and remove no provider resource. Local `.tfstate` artifacts are
   ignored and are not a backup; S3 version history is the recovery path.

Recovery uses the prior S3 object version for the affected state key. Removal requires migrating
every consumer state elsewhere first, proving no lock is active, deliberately removing
`prevent_destroy`, and applying a separately reviewed teardown. Never empty or delete this bucket
as part of another stack.
