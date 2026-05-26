# AWS S3 Migration: Cross-Region Bucket Consolidation to us-east-1

## Context

You are working inside the `matrx-python-server` EC2 instance (us-east-1). The task is to migrate several S3 buckets from non-primary regions (us-east-2 / us-west-2) into us-east-1 while **preserving the original bucket names exactly**. Object data has been partially synced for some buckets; you need to finish those and execute same-name cutovers.

**AWS Account ID:** `872515272894`
**Primary region:** `us-east-1`

## Bucket migration status

| Bucket | Original Region | Object Count | Size | Temp Bucket (us-east-1) | Sync Status |
|---|---|---|---|---|---|
| `matrx-user-files` | us-east-2 | 26,467 | ~6.8 GB | `matrx-user-files-tmp-mig` | ~28% (7,392 done, partial) |
| `aimatrx-scraper` | us-east-2 | 30,584 | ~3.4 GB | `aimatrx-scraper-tmp-mig` | ~25% (7,596 done, partial) |
| `matrx-backups` | us-east-2 | 159 | 1.37 GB | `matrx-backups-tmp-mig` | ✅ 100% synced (verify only) |

**Priority order:** `matrx-user-files` FIRST (highest priority), then `aimatrx-scraper`, then `matrx-backups` cutover.

## Preserved bucket configurations

Bucket configs were captured in CloudShell at `~/bucket-configs/` but you don't have access to that. The known settings to restore are:

**`matrx-user-files`** (us-east-2 → us-east-1):
- Public Access Block: `BlockPublicAcls=true, IgnorePublicAcls=true, BlockPublicPolicy=true, RestrictPublicBuckets=true`
- CORS: present (rules unknown — re-create from app needs OR ask user before cutover)
- No bucket policy
- No versioning

**`aimatrx-scraper`** (us-east-2 → us-east-1):
- Public Access Block: all four flags `true`
- No CORS, no policy, no versioning

**`matrx-backups`** (us-east-2 → us-east-1):
- Public Access Block: all four flags `true`
- Versioning: `Enabled` (must re-enable after cutover)
- No CORS, no policy

## Prerequisites

1. Verify you're on the EC2 instance in us-east-1:
```bash
curl -s http://169.254.169.254/latest/meta-data/placement/region
# Expect: us-east-1
```

2. Verify AWS CLI works with instance role (no keys needed):
```bash
aws sts get-caller-identity
# Expect account: 872515272894
```

3. Install/check tools:
```bash
aws --version  # need v2.x
which jq || sudo yum install -y jq
```

4. Run inside `tmux` or `screen` so disconnects don't kill long syncs:
```bash
tmux new -s s3mig
# (later: tmux attach -t s3mig)
```

## STEP 1 — Finish syncs to temp buckets

Run these sequentially (they're idempotent — `s3 sync` only copies missing/changed objects). Tune `--cli-read-timeout` and concurrency for the EC2 instance type.

```bash
# Bump S3 concurrency for faster transfer on EC2
aws configure set default.s3.max_concurrent_requests 50
aws configure set default.s3.multipart_threshold 64MB
aws configure set default.s3.multipart_chunksize 16MB

# --- matrx-user-files (HIGHEST PRIORITY) ---
aws s3 sync s3://matrx-user-files s3://matrx-user-files-tmp-mig \
  --source-region us-east-2 --region us-east-1 \
  --only-show-errors
echo "matrx-user-files sync complete"

# --- aimatrx-scraper ---
aws s3 sync s3://aimatrx-scraper s3://aimatrx-scraper-tmp-mig \
  --source-region us-east-2 --region us-east-1 \
  --only-show-errors
echo "aimatrx-scraper sync complete"

# --- matrx-backups (likely already 100%, just verify) ---
aws s3 sync s3://matrx-backups s3://matrx-backups-tmp-mig \
  --source-region us-east-2 --region us-east-1 \
  --only-show-errors
echo "matrx-backups sync complete"
```

## STEP 2 — Verify parity per bucket

For each bucket, confirm object count and total size match the original before cutting over. A small `n` mismatch is acceptable ONLY if it's zero-byte "folder placeholder" keys ending in `/` (these don't carry data). Real data must match byte-for-byte.

```bash
verify_bucket() {
  local SRC=$1 SRC_REGION=$2 DST=$3
  echo "=== Verifying $SRC ($SRC_REGION) vs $DST (us-east-1) ==="
  echo "Source:"
  aws s3 ls s3://$SRC --recursive --summarize --region $SRC_REGION | tail -2
  echo "Destination:"
  aws s3 ls s3://$DST --recursive --summarize --region us-east-1 | tail -2
}

verify_bucket matrx-user-files us-east-2 matrx-user-files-tmp-mig
verify_bucket aimatrx-scraper  us-east-2 aimatrx-scraper-tmp-mig
verify_bucket matrx-backups    us-east-2 matrx-backups-tmp-mig
```

If counts differ by more than the folder-placeholder count, find missing keys:

```bash
aws s3api list-objects-v2 --bucket matrx-user-files --region us-east-2 \
  --query 'Contents[].Key' --output text | tr '\t' '\n' | sort > /tmp/src.txt
aws s3api list-objects-v2 --bucket matrx-user-files-tmp-mig --region us-east-1 \
  --query 'Contents[].Key' --output text | tr '\t' '\n' | sort > /tmp/dst.txt
diff /tmp/src.txt /tmp/dst.txt | head -50
```

**STOP and report to the user before proceeding to cutover if real data is missing.**

## STEP 3 — Same-name cutover (per bucket)

This is the destructive step. Do ONE bucket at a time. Order: `matrx-user-files`, then `aimatrx-scraper`, then `matrx-backups`.

### Template (substitute `<BUCKET>`, `<SRC_REGION>`, `<TEMP>`):

```bash
BUCKET=matrx-user-files
SRC_REGION=us-east-2
TEMP=matrx-user-files-tmp-mig

# 3a. Final delta sync (catches any new objects written during the gap)
aws s3 sync s3://$BUCKET s3://$TEMP \
  --source-region $SRC_REGION --region us-east-1 --only-show-errors
echo "Final delta sync done"

# 3b. Delete the original bucket (must be empty — use --force to clear contents)
aws s3 rb s3://$BUCKET --region $SRC_REGION --force
echo "Original $BUCKET deleted from $SRC_REGION"

# 3c. Wait for the global S3 name to free up. This can take 5–30+ minutes.
#     Retry every 60s for up to 60 minutes.
for i in $(seq 1 60); do
  echo "=== Attempt $i (waiting 60s) ==="
  sleep 60
  if aws s3api create-bucket --bucket $BUCKET --region us-east-1 2>&1 | tee /tmp/cb.out | grep -q -v "OperationAborted"; then
    if grep -q "Location" /tmp/cb.out || ! grep -q "ERROR" /tmp/cb.out; then
      echo "SUCCESS: $BUCKET created in us-east-1"
      break
    fi
  fi
done

# 3d. Verify it was actually created
aws s3api head-bucket --bucket $BUCKET --region us-east-1 && echo "Bucket exists" || { echo "ABORT: bucket not created, do not continue"; exit 1; }
```

### Re-apply settings (run AFTER bucket is created)

**For `matrx-user-files`:**
```bash
BUCKET=matrx-user-files
aws s3api put-public-access-block --bucket $BUCKET --region us-east-1 \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
# CORS: ASK USER before applying — the rules from the original were not captured in a portable form on EC2.
# If user provides cors.json:
# aws s3api put-bucket-cors --bucket $BUCKET --region us-east-1 --cors-configuration file://cors.json
```

**For `aimatrx-scraper`:**
```bash
BUCKET=aimatrx-scraper
aws s3api put-public-access-block --bucket $BUCKET --region us-east-1 \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

**For `matrx-backups`:**
```bash
BUCKET=matrx-backups
aws s3api put-public-access-block --bucket $BUCKET --region us-east-1 \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
aws s3api put-bucket-versioning --bucket $BUCKET --region us-east-1 \
  --versioning-configuration Status=Enabled
```

### Sync temp → final (same-region, fast)
```bash
BUCKET=matrx-user-files   # change per bucket
TEMP=matrx-user-files-tmp-mig
aws s3 sync s3://$TEMP s3://$BUCKET --region us-east-1 --only-show-errors
echo "$BUCKET restored from temp"
```

### Verify final
```bash
aws s3 ls s3://$BUCKET --recursive --summarize --region us-east-1 | tail -2
```

### Delete temp bucket
```bash
aws s3 rb s3://$TEMP --region us-east-1 --force
echo "$TEMP deleted"
```

## STEP 4 — Final report

After all three buckets are done, output:

```bash
echo "=== FINAL BUCKET STATE ==="
for B in matrx-user-files aimatrx-scraper matrx-backups; do
  REGION=$(aws s3api get-bucket-location --bucket $B --query LocationConstraint --output text 2>/dev/null)
  REGION=${REGION:-us-east-1}
  COUNT=$(aws s3 ls s3://$B --recursive --region $REGION | wc -l)
  echo "$B: region=$REGION objects=$COUNT"
done
```

## Rules / Constraints

1. **Do not merge or rename buckets.** Each bucket keeps its original name.
2. **Do one bucket end-to-end before starting the next** — don't delete two originals at once. If S3 holds the name for both, you double the downtime.
3. **Never delete the temp bucket until the final bucket is verified with matching object count.**
4. **If the create-bucket retry loop exhausts 60 minutes without success**, STOP and report to the user. Do not delete temp or start the next bucket.
5. **If a sync reports any errors** (not just zero-byte folder mismatches), STOP and report.
6. **matrx-backups versioning must be re-enabled** before syncing data back, otherwise you lose version history protection going forward (existing versions in the source are already flattened by `s3 sync` — this is acceptable per user).
7. **Do not touch any other AWS resources** (EC2, IAM, CloudFront, RDS, Supabase). S3 only.
8. **Do not download files locally to the EC2 disk** — `s3 sync` streams server-side; if you see large local disk usage, abort.

## Expected total runtime

- Sync completion: 20–60 min (depends on EC2 network)
- Per-bucket cutover wait (S3 name release): 5–60 min unpredictable
- Total: likely 2–4 hours for all three buckets

Report progress every 15 minutes and at every cutover boundary.
