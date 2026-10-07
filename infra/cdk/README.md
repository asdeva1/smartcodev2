# @smartcode/infra (AWS CDK)

Infrastructure for one environment per synth: `-c env=staging|production`. Nothing is deployed until Phase 13 (and only with approval).

| Stack      | Contents                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network    | VPC (public / private-app / isolated-data subnets), NAT, S3 gateway endpoint, VPC flow logs                                                                                                                    |
| Data       | RDS PostgreSQL 16 — KMS-encrypted, TLS enforced, isolated, PITR backups, Multi-AZ + deletion protection in production, generated credentials in Secrets Manager                                                |
| Storage    | Uploads and reports buckets — KMS, TLS-only, no public access, versioning, access logs, retention lifecycle, CORS limited to the web origin                                                                    |
| Api        | ECR (scan on push, immutable tags), ECS Fargate service behind ALB (HTTPS, circuit-breaker rollback, autoscaling), migration task, WAF (managed rules + auth rate limit), runtime secrets from Secrets Manager |
| Monitoring | CloudWatch alarms (5xx, latency, unhealthy targets, CPU, DB CPU/connections/storage) → SNS                                                                                                                     |

```bash
pnpm synth:staging
pnpm synth:production     # requires -c certificateArn=… (a placeholder is used for synth checks)
pnpm test                 # assertion tests on the synthesised templates
```

Context values: `env`, `certificateArn`, `imageTag`, `webUrl`, `apiUrl`, `appUrl` (domains are configuration — D-06). Account and region come from `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`; the production region must be confirmed for healthcare data before real PHI (D-05). Redis (ElastiCache) and SES are added with the phases that use them.
