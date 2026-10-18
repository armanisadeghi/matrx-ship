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
          description  = "Rollback window: keep the ${keep} newest images"
          selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = keep }
          action       = { type = "expire" }
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
