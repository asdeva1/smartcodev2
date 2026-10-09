# Incident response

## Severity

| Level | Meaning                                     | Respond within          |
| ----- | ------------------------------------------- | ----------------------- |
| 1     | System down, data loss, or suspected breach | 15 minutes, any hour    |
| 2     | Major feature unusable for many users       | 1 hour (business hours) |
| 3     | Minor defect, workaround exists             | Next working day        |

## First 15 minutes

1. Name an incident lead; open an incident record (time, who, symptoms).
2. Check `/health/ready`, the CloudWatch alarms (ErrorRate, latency p95, CPU, database), and ECS service events.
3. Recent release? Roll back first ([rollback.md](rollback.md)); investigate afterwards.
4. Tell the Manager what users see and when the next update will come.

## Where to look

- API logs: CloudWatch log group of the API stack (filter by `requestId`; error responses carry it).
- Who did what: Audit log screen (Manager) or the `audit_logs` table; every state change is recorded with actor and reason.
- WAF: sampled requests and the rate-limit rule on the authentication endpoints.
- Database: RDS Performance Insights (enabled).

## Suspected security incident

1. Contain: rotate the exposed secret ([secrets-rotation.md](secrets-rotation.md)); deactivate affected employees (this ends their sessions); if needed scale the API to 0.
2. Preserve: do not delete logs; take a database snapshot.
3. Assess what was exposed. SmartCode holds employee data, chart references and counts, not chart contents.
4. Notify the client and the data-protection owner as required by the contract and local law.
5. After recovery: write the timeline, root cause and actions, and track them to completion.

## Alarm subscriptions

Subscribe the on-call email to the SNS topic `SmartCode <env> alarms` (SNS → Topics → Create subscription). Test by publishing a message.
