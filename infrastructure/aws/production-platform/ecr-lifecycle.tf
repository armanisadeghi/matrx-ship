# One image-retention rule for every ECR repository: a few rollback images, nothing more.
# ECR storage was ~$185/month (2026-10-18) because old builds and build caches were never expired.
locals {
  ecr_lifecycle_rules = {
    for keep in [20, 30] : keep => jsonencode({
      rules = [
        {
          # Images a build pins by digest (the proven Selkies runtime the browser
          # worker COPYs from) are tagged pinned-*; this rule claims them first so
          # the rollback window below can never expire them. Without it the pinned
          # base aged out and every browser/Cloud Computer build failed (2026-10-18).
          rulePriority = 1
          description  = "Never expire images a build pins (pinned-*)"
          selection    = { tagStatus = "tagged", tagPrefixList = ["pinned-"], countType = "imageCountMoreThan", countNumber = 100 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 2
          description  = "Keep only the current build cache"
          selection    = { tagStatus = "tagged", tagPrefixList = ["buildcache"], countType = "imageCountMoreThan", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 3
          description  = "Keep only the current latest pointer"
          selection    = { tagStatus = "tagged", tagPrefixList = ["latest"], countType = "imageCountMoreThan", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 4
          description  = "Remove untagged leftovers after one day"
          selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 5
          # Tagged releases only: an untagged index child or SOCI index of a kept release is never
          # expired, and counting them made "keep 20" only 4-7 releases (2026-10-18 review).
          description = "Rollback window: keep the ${keep} newest tagged releases"
          selection   = { tagStatus = "tagged", tagPatternList = ["*"], countType = "imageCountMoreThan", countNumber = keep }
          action      = { type = "expire" }
        },
      ]
    })
  }
}

# The browser worker's repository holds the pinned Selkies runtime every browser
# and Cloud Computer build COPYs from (packages/matrx-scraper/Dockerfile), so it
# needs the pinned-* rule above more than any other repository.
resource "aws_ecr_lifecycle_policy" "browser_worker" {
  repository = "matrx-browser-worker"
  policy     = local.ecr_lifecycle_rules[20]
}

# Every image Terraform itself deploys is pinned at apply time, so no lifecycle rule above can expire an image a
# live task definition runs. Incident 2026-10-21: the live Cloud Computer image 9adaa4b600 carried no pinned-* tag
# (the pin ran only on an apply that moved the tag), aged out of the rollback window, and every wake failed.
# Add an entry here for any task definition whose image Terraform owns (no ignore_changes on container_definitions).
# Release-owned images are pinned by the release itself (aidream scripts/pin_ecr_image.sh, before it registers a
# revision). Guard over both: scripts/check_ecr_live_images_pinned.py.
locals {
  terraform_deployed_images = {
    "cloud-computer" = { repository = aws_ecr_repository.cloud_computer.name, tag = var.cloud_computer_image_tag }
  }
}

resource "terraform_data" "pin_deployed_image" {
  for_each = local.terraform_deployed_images

  # A promotion (new tag) re-runs the pin.
  triggers_replace = [each.value.tag]

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    environment = {
      REPO = each.value.repository
      SHA  = each.value.tag
      PIN  = "pinned-${each.key}-${each.value.tag}"
    }
    command = <<-EOT
      set -euo pipefail
      if aws ecr describe-images --region us-east-1 --repository-name "$REPO" --image-ids imageTag="$PIN" >/dev/null 2>&1; then exit 0; fi
      TYPES="application/vnd.oci.image.index.v1+json application/vnd.docker.distribution.manifest.list.v2+json application/vnd.oci.image.manifest.v1+json application/vnd.docker.distribution.manifest.v2+json"
      MANIFEST=$(aws ecr batch-get-image --region us-east-1 --repository-name "$REPO" --image-ids imageTag="$SHA" --accepted-media-types $TYPES --query 'images[0].imageManifest' --output text)
      MEDIA=$(aws ecr batch-get-image --region us-east-1 --repository-name "$REPO" --image-ids imageTag="$SHA" --accepted-media-types $TYPES --query 'images[0].imageManifestMediaType' --output text)
      if [ -z "$MANIFEST" ] || [ "$MANIFEST" = "None" ]; then echo "Cannot pin $REPO:$SHA: the image does not exist in ECR." >&2; exit 1; fi
      aws ecr put-image --region us-east-1 --repository-name "$REPO" --image-tag "$PIN" --image-manifest "$MANIFEST" --image-manifest-media-type "$MEDIA" >/dev/null
    EOT
  }
}
