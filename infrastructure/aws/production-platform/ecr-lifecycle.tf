# One image-retention rule for every ECR repository: a few rollback images, nothing more.
# ECR storage was ~$185/month (2026-10-18) because old builds and build caches were never expired.
locals {
  ecr_lifecycle_rules = {
    for keep in [20, 30] : keep => jsonencode({
      rules = [
        {
          rulePriority = 1
          description  = "Keep only the current build cache"
          selection    = { tagStatus = "tagged", tagPrefixList = ["buildcache"], countType = "imageCountMoreThan", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 2
          description  = "Keep only the current latest pointer"
          selection    = { tagStatus = "tagged", tagPrefixList = ["latest"], countType = "imageCountMoreThan", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 3
          description  = "Remove untagged leftovers after one day"
          selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 1 }
          action       = { type = "expire" }
        },
        {
          rulePriority = 4
          description  = "Rollback window: keep the ${keep} newest images"
          selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = keep }
          action       = { type = "expire" }
        },
      ]
    })
  }
}
