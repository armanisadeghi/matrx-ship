resource "aws_cloudwatch_metric_alarm" "static_web_healthy_hosts" {
  for_each = aws_lb_target_group.static_web

  alarm_name          = "matrx-production-${each.key}-fewer-than-two-healthy-tasks"
  alarm_description   = "The ${each.key} service no longer has a healthy task in both availability zones."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  comparison_operator = "LessThanThreshold"
  threshold           = 2
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = each.value.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "static_web_target_5xx" {
  for_each = aws_lb_target_group.static_web

  alarm_name          = "matrx-production-${each.key}-target-5xx"
  alarm_description   = "The ${each.key} tasks returned more than ten server errors in five minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = each.value.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "browser_worker_running" {
  alarm_name          = "matrx-production-browser-worker-not-running"
  alarm_description   = "The persistent Cloud Browser worker has no running ECS task."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.production.name
    ServiceName = aws_ecs_service.browser_worker.name
  }
}

resource "aws_cloudwatch_metric_alarm" "browser_worker_memory" {
  alarm_name          = "matrx-production-browser-worker-memory-high"
  alarm_description   = "The persistent Cloud Browser worker averaged more than 85 percent memory utilization for 15 minutes."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 300
  statistic           = "Average"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.production.name
    ServiceName = aws_ecs_service.browser_worker.name
  }
}

resource "aws_cloudwatch_dashboard" "production" {
  dashboard_name = "matrx-production"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "# Matrx production\nECS/Fargate service health in us-east-1. Runtime logs use `/matrx/production/<service>`; audited ECS Exec uses `/matrx/production/ecs-exec`."
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          title  = "Healthy tasks behind the load balancer"
          region = var.aws_region
          period = 60
          stat   = "Minimum"
          metrics = [for name, target_group in aws_lb_target_group.static_web : [
            "AWS/ApplicationELB",
            "HealthyHostCount",
            "TargetGroup",
            target_group.arn_suffix,
            "LoadBalancer",
            aws_lb.public.arn_suffix,
            { label = name },
          ]]
          yAxis = { left = { min = 0 } }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          title  = "Requests and target errors"
          region = var.aws_region
          period = 300
          stat   = "Sum"
          metrics = concat(
            [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.public.arn_suffix, { label = "requests" }]],
            [for name, target_group in aws_lb_target_group.static_web : [
              "AWS/ApplicationELB",
              "HTTPCode_Target_5XX_Count",
              "TargetGroup",
              target_group.arn_suffix,
              "LoadBalancer",
              aws_lb.public.arn_suffix,
              { label = "${name} 5xx" },
            ]],
          )
          yAxis = { left = { min = 0 } }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 24
        height = 6
        properties = {
          title  = "ECS service CPU and memory"
          region = var.aws_region
          period = 300
          stat   = "Average"
          metrics = concat(
            [for name, service in aws_ecs_service.static_web : [
              "AWS/ECS", "CPUUtilization", "ServiceName", service.name, "ClusterName", aws_ecs_cluster.production.name, { label = "${name} CPU" },
            ]],
            [for name, service in aws_ecs_service.static_web : [
              "AWS/ECS", "MemoryUtilization", "ServiceName", service.name, "ClusterName", aws_ecs_cluster.production.name, { label = "${name} memory" },
            ]],
            [
              ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.aidream.name, "ClusterName", aws_ecs_cluster.production.name, { label = "aidream CPU" }],
              ["AWS/ECS", "MemoryUtilization", "ServiceName", aws_ecs_service.aidream.name, "ClusterName", aws_ecs_cluster.production.name, { label = "aidream memory" }],
              ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.workflow_worker.name, "ClusterName", aws_ecs_cluster.production.name, { label = "workflow-worker CPU" }],
              ["AWS/ECS", "MemoryUtilization", "ServiceName", aws_ecs_service.workflow_worker.name, "ClusterName", aws_ecs_cluster.production.name, { label = "workflow-worker memory" }],
              ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.browser_worker.name, "ClusterName", aws_ecs_cluster.production.name, { label = "browser-worker CPU" }],
              ["AWS/ECS", "MemoryUtilization", "ServiceName", aws_ecs_service.browser_worker.name, "ClusterName", aws_ecs_cluster.production.name, { label = "browser-worker memory" }],
            ],
          )
          yAxis = { left = { min = 0, max = 100 } }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 14
        width  = 12
        height = 6
        properties = {
          title  = "Persistent browser worker task count"
          region = var.aws_region
          period = 60
          stat   = "Minimum"
          metrics = [[
            "ECS/ContainerInsights",
            "RunningTaskCount",
            "ServiceName",
            aws_ecs_service.browser_worker.name,
            "ClusterName",
            aws_ecs_cluster.production.name,
            { label = "running browser workers" },
          ]]
          yAxis = { left = { min = 0 } }
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 14
        width  = 12
        height = 6
        properties = {
          title  = "Persistent browser worker logs"
          region = var.aws_region
          view   = "table"
          query  = "SOURCE '${aws_cloudwatch_log_group.application["aidream"].name}' | fields @timestamp, @message | filter @logStream like /browser-worker/ | sort @timestamp desc | limit 50"
        }
      },
    ]
  })
}

output "cloudwatch_dashboard_url" {
  description = "AWS console dashboard for the production ECS platform."
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.production.dashboard_name}"
}
