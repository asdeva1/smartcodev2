# Provision production (one time)

Everything is defined in `infra/cdk` (`environments.ts` holds the production sizing: 2 NAT gateways, Multi-AZ database, 35-day backups, deletion protection, 2–6 API tasks, 365-day log retention). Nothing here can be done by the build environment; it needs the production AWS account owner.

## Decisions needed first

| #   | Decision                                                                  | Why                                                                    |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Production AWS account and region                                         | Data residency; the region cannot be changed later without a migration |
| 2   | Domain names (web and API) and who controls DNS                           | Certificates and cookies                                               |
| 3   | SES: verified sender domain and **production access** (leave the sandbox) | Activation and reset emails                                            |
| 4   | Who approves production deployments                                       | GitHub environment reviewers                                           |
| 5   | On-call email for alarms                                                  | SNS subscription                                                       |

## Steps

1. **AWS account**: enable MFA on root, create an admin role for the operator, turn on CloudTrail, GuardDuty and Security Hub.
2. **CDK bootstrap**: `cdk bootstrap aws://<account>/<region>`.
3. **Certificates**: request ACM certificates for the API domain (and the web domain if not on Vercel); validate through DNS.
4. **Deploy**, in this order, with `-c env=production`: `SmartCode-Prod-Network`, `-Data`, `-Storage`, `-Api` (first with `-c desiredCountOverride=0` because no image exists yet), `-Monitoring`.
5. **Secrets**: fill the app secret (`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`) in the AWS console — see [secrets-rotation.md](secrets-rotation.md). Create a restricted database user for the API (no DDL) and a migration user.
6. **Image**: run **Deploy production** with a tag that has passed staging; it copies the image, migrates and starts the service.
7. **GitHub**: create the `production` environment with required reviewers and the variables used by `deploy-production.yml` (`AWS_ROLE_ARN_PRODUCTION`, `AWS_REGION_PRODUCTION`, `ECR_REPOSITORY_PRODUCTION`, `RDS_INSTANCE_PRODUCTION`, `ECS_CLUSTER_PRODUCTION`, `PRIVATE_SUBNETS_PRODUCTION`, `API_SECURITY_GROUP_PRODUCTION`, `PRODUCTION_*` URLs and certificate ARN, `PRODUCTION_MAIL_FROM`, `PRODUCTION_DEPLOY_ENABLED=true`). The role trusts only this repository and environment through GitHub OIDC.
8. **Vercel**: create the production project, set `NEXT_PUBLIC_APP_ENV=production`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`; attach the domain. Remove the staging API proxy variable (`API_PROXY_TARGET`) — production uses a shared parent domain so cookies are first-party.
9. **DNS**: point the API domain at the load balancer / API Gateway, the web domain at Vercel.
10. **Bootstrap Manager**: [bootstrap-manager.md](bootstrap-manager.md).
11. **Verify**: `pnpm smoke`, then the go-live checklist.

Also redo live notifications (server-sent events) once the production network path allows streaming; staging's API Gateway buffers responses.
