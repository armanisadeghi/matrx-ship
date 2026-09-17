# Dedicated tasks retain an allocation UUID across API replicas. These rights
# never allow updating/stopping the singleton service or unrelated ECS tasks.
data "aws_iam_policy_document" "browser_fleet" {
  statement {
    sid       = "ReadBrowserServiceConfiguration"
    actions   = ["ecs:DescribeServices"]
    resources = [aws_ecs_service.browser_worker.id]
  }

  statement {
    sid       = "ReadBrowserTaskDefinition"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid       = "FindAllocatedBrowserTasks"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
  }

  statement {
    sid       = "InspectAllocatedBrowserTasks"
    actions   = ["ecs:DescribeTasks", "ecs:ListTagsForResource"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
  }

  statement {
    sid       = "LaunchDedicatedBrowserTasks"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/${aws_ecs_task_definition.browser_worker.family}:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed-by"
      values   = ["matrx-cloud-browser"]
    }
  }

  statement {
    sid       = "TagBrowserAllocationAtCreation"
    actions   = ["ecs:TagResource"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
    condition {
      test     = "StringEquals"
      variable = "ecs:CreateAction"
      values   = ["RunTask"]
    }
  }

  statement {
    sid       = "StopOnlyOwnedBrowserAllocations"
    actions   = ["ecs:StopTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = ["matrx-cloud-browser"]
    }
  }

  statement {
    sid     = "PassOnlyBrowserTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.browser_worker_task.arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "browser_fleet" {
  for_each = toset(["aidream", "workflow-worker"])
  name     = "dedicated-browser-task-lifecycle"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.browser_fleet.json
}

# Standalone allocations have no ServiceName. Inspect the hottest individual
# task, rather than averaging a saturated browser into an otherwise idle fleet.
resource "aws_cloudwatch_metric_alarm" "browser_fleet_memory" {
  alarm_name          = "matrx-production-browser-fleet-task-memory-high"
  alarm_description   = "An individual dedicated browser task exceeds 85 percent of its 4 GiB allocation."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3481.6
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "fleet_memory"
    expression  = "SELECT MAX(MemoryUtilized) FROM SCHEMA(\"ECS/ContainerInsights\", ClusterName, TaskDefinitionFamily, TaskId) WHERE ClusterName = '${aws_ecs_cluster.production.name}' AND TaskDefinitionFamily = '${aws_ecs_task_definition.browser_worker.family}'"
    period      = 60
    return_data = true
  }
}
