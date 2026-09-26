mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "872515272894"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = jsonencode({
        Version   = "2012-10-17"
        Statement = []
      })
    }
  }

  mock_data "aws_vpc" {
    defaults = {
      cidr_block = "10.0.0.0/16"
    }
  }
}

run "dedicated_browser_memory_alarm_tracks_the_hottest_task" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.browser_fleet_memory.alarm_name == "matrx-production-browser-fleet-task-memory-high"
    error_message = "Dedicated browser sessions must retain their per-task memory alarm."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.browser_fleet_memory.treat_missing_data == "notBreaching"
    error_message = "An idle dedicated browser fleet is expected and must not alarm."
  }

  assert {
    condition = anytrue([
      for query in aws_cloudwatch_metric_alarm.browser_fleet_memory.metric_query :
      strcontains(query.expression, "TaskDefinitionFamily") && strcontains(query.expression, "TaskId")
    ])
    error_message = "The browser memory alarm must target individual dedicated tasks, not the zero-count ECS service."
  }
}
