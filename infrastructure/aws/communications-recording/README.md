# Twilio Voice recording storage

This production Terraform root owns the non-secret storage boundary for the owner-only Twilio
Voice beta. It creates:

- private recording bucket `matrx-voice-recordings-prod-872515272894`;
- write-only IAM user `twilio-voice-recording-writer-prod`, a direct policy, and the same maximum
  as a permissions boundary;
- a dedicated CloudTrail and private log bucket for all object data events under
  `twilio/us1/owner-beta/`.

The writer can only put objects and complete/recover multipart uploads under that prefix. It cannot
read, list objects, delete, change ACLs/tags, administer the bucket, or write elsewhere. The one
unavoidable bucket-level `s3:ListBucketMultipartUploads` action is isolated to this dedicated
recording bucket. Recording objects expire after 30 days and incomplete multipart uploads after one
day. CloudTrail logs expire after 365 days.

## Apply and verify

Run Terraform with an approved AWS operator identity and inspect the saved binary plan before
applying it. After apply:

1. Re-read bucket public-access, ownership, encryption, lifecycle, and policy controls.
2. Validate both IAM policy documents with IAM Access Analyzer.
3. Simulate the writer: the four documented multipart/write operations must be allowed; object
   read/list/delete, bucket administration, and an outside-prefix PUT must be denied.
4. Confirm CloudTrail is logging and its event selector is scoped to the owner-beta object prefix.

**This stack never creates `aws_iam_access_key`.** A future one-time key and direct Twilio Console
handoff are separate operator actions only after the application and canary gates are ready.
Applying this root does not configure Twilio and does not enable recording.

## Recovery and removal

State recovery uses the versioned remote-state object. These buckets use `prevent_destroy` and
`force_destroy` is not enabled. To remove the integration: first disable recording creation and
Twilio external storage, deactivate/delete every key and Twilio credential, retain or govern-delete
recording objects, wait for multipart uploads to drain, then deliberately remove `prevent_destroy`
and apply a separately reviewed teardown. Delete the IAM identity only after provider-side key
absence is verified. Never empty either bucket as an incidental Terraform step.

Cross-repo system-of-record:
`/Users/armanisadeghi/code/common-docs/projects/communications-platform/P6-ai-voice-proof.md` — read
it before touching recording storage, credentials, or capture in any repository.
