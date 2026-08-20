#!/usr/bin/env bash
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-matrx-production}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

instance_id="i-084f757c1e47d4efb"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_base64="$(base64 < "${script_dir}/Caddyfile" | tr -d '\n')"

commands=$(jq -cn --arg config "${config_base64}" '{commands:[
  "set -euo pipefail",
  "candidate=/opt/matrx-files/Caddyfile.candidate",
  "backup=/opt/matrx-files/Caddyfile.bak.$(date +%s)",
  ("printf %s " + $config + " | base64 -d | sudo tee $candidate >/dev/null"),
  "sudo docker run --rm -v $candidate:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile",
  "sudo cp /opt/matrx-files/Caddyfile $backup",
  "sudo tee /opt/matrx-files/Caddyfile < $candidate >/dev/null",
  "sudo chmod 0644 /opt/matrx-files/Caddyfile",
  "if ! sudo docker exec -i matrx-files-tls caddy reload --config - --adapter caddyfile < $candidate; then sudo tee /opt/matrx-files/Caddyfile < $backup >/dev/null; sudo docker exec -i matrx-files-tls caddy reload --config - --adapter caddyfile < $backup; exit 1; fi",
  "sudo rm $candidate"
]}')

command_id=$(aws ssm send-command \
  --instance-ids "${instance_id}" \
  --document-name AWS-RunShellScript \
  --comment "Reconcile Files SEO public origin TLS" \
  --parameters "${commands}" \
  --query 'Command.CommandId' \
  --output text)

aws ssm wait command-executed --command-id "${command_id}" --instance-id "${instance_id}"
aws ssm get-command-invocation \
  --command-id "${command_id}" \
  --instance-id "${instance_id}" \
  --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' \
  --output json
