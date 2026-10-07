import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as rds from 'aws-cdk-lib/aws-rds';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from './environments';

export interface ApiStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: ec2.IVpc;
  database: rds.DatabaseInstance;
  databaseSecurityGroup: ec2.SecurityGroup;
  uploads: s3.Bucket;
  reports: s3.Bucket;
  storageKey: kms.Key;
  /** ACM certificate for the API domain (D-06: configured, not hard-coded). */
  certificateArn?: string;
  /** Image tag to run; set by CI to the digest-pinned tag that passed staging. */
  imageTag: string;
  /** Public URLs (D-06). */
  urls: { web: string; api: string; app: string };
  /** Verified SES sender (MAIL_FROM). Required when deployed: the API refuses to start without it. */
  mailFrom?: string;
  /** Parent domain for the session cookies when web and API are on sibling hosts (optional). */
  cookieDomain?: string;
  /** First-deploy escape hatch: 0 creates the service before an image exists in ECR. */
  desiredCountOverride?: number;
}

/**
 * NestJS API on ECS Fargate behind an ALB with WAF, plus a one-off migration task definition.
 * Runtime secrets come from Secrets Manager (never task environment literals). The application secret is
 * created empty here and populated through the deployment runbook (Phase 13).
 */
export class ApiStack extends Stack {
  readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;
  readonly repository: ecr.Repository;
  readonly appSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.repository = new ecr.Repository(this, 'ApiRepository', {
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.KMS,
      lifecycleRules: [{ maxImageCount: 50 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      description: `SmartCode ${config.name} API runtime secrets (DATABASE_URL, JWT keys) - populated via runbook`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          DATABASE_URL: '',
          DATABASE_MIGRATION_URL: '',
          JWT_PRIVATE_KEY: '',
          JWT_PUBLIC_KEY: '',
        }),
        generateStringKey: 'UNUSED_GENERATED',
      },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: config.logRetentionDays as logs.RetentionDays,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    if (!props.mailFrom) {
      Annotations.of(this).addWarning(
        'No mailFrom supplied: the API will fail config validation when deployed.',
      );
    }
    const environment: Record<string, string> = {
      APP_ENV: config.name,
      NODE_ENV: 'production',
      APP_MODE: 'api',
      PORT: '4000',
      LOG_LEVEL: 'info',
      WEB_URL: props.urls.web,
      API_URL: props.urls.api,
      APP_URL: props.urls.app,
      AWS_REGION: this.region,
      S3_UPLOADS_BUCKET: props.uploads.bucketName,
      S3_REPORTS_BUCKET: props.reports.bucketName,
      MAIL_TRANSPORT: 'ses',
      ...(props.mailFrom ? { MAIL_FROM: props.mailFrom } : {}),
      ...(props.cookieDomain ? { COOKIE_DOMAIN: props.cookieDomain } : {}),
    };
    const secrets = {
      DATABASE_URL: ecs.Secret.fromSecretsManager(this.appSecret, 'DATABASE_URL'),
      JWT_PRIVATE_KEY: ecs.Secret.fromSecretsManager(this.appSecret, 'JWT_PRIVATE_KEY'),
      JWT_PUBLIC_KEY: ecs.Secret.fromSecretsManager(this.appSecret, 'JWT_PUBLIC_KEY'),
    };

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
      : undefined;
    if (!certificate) {
      const message = 'No certificateArn supplied: the API listener will be HTTP only.';
      if (config.name === 'production')
        Annotations.of(this).addError(`${message} Production requires HTTPS.`);
      else Annotations.of(this).addWarning(message);
    }

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Api', {
      cluster,
      desiredCount: Math.max(1, props.desiredCountOverride ?? config.api.desiredCount),
      cpu: config.api.cpu,
      memoryLimitMiB: config.api.memoryMiB,
      publicLoadBalancer: true,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      certificate,
      protocol: certificate ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
      redirectHTTP: Boolean(certificate),
      sslPolicy: certificate ? elbv2.SslPolicy.RECOMMENDED_TLS : undefined,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(this.repository, props.imageTag),
        containerPort: 4000,
        environment,
        secrets,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup }),
      },
    });
    if (props.desiredCountOverride === 0) {
      // The L2 pattern rejects 0; the first deploy happens before any image exists in ECR.
      (this.service.service.node.defaultChild as ecs.CfnService).desiredCount = 0;
    }
    this.service.targetGroup.configureHealthCheck({
      path: '/health/live',
      healthyHttpCodes: '200',
      interval: Duration.seconds(15),
    });
    this.service.loadBalancer.setAttribute('routing.http.drop_invalid_header_fields.enabled', 'true');
    this.service.service
      .autoScaleTaskCount({
        minCapacity: props.desiredCountOverride ?? config.api.desiredCount,
        maxCapacity: config.api.maxCount,
      })
      .scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });

    // Least privilege: database reachable only from the API tasks; buckets read/write only.
    props.databaseSecurityGroup.addIngressRule(
      this.service.service.connections.securityGroups[0]!,
      ec2.Port.tcp(5432),
      'API tasks to PostgreSQL',
    );
    props.uploads.grantReadWrite(this.service.taskDefinition.taskRole);
    props.reports.grantReadWrite(this.service.taskDefinition.taskRole);
    const sendMail = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`],
    });
    this.service.taskDefinition.taskRole.addToPrincipalPolicy(sendMail);

    // One-off migration task (`prisma migrate deploy`), run by CI before each service update.
    const migrate = new ecs.FargateTaskDefinition(this, 'MigrateTask', { cpu: 256, memoryLimitMiB: 512 });
    migrate.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, `${props.imageTag}-migrator`),
      environment: { APP_ENV: config.name },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(this.appSecret, 'DATABASE_URL'),
        DATABASE_MIGRATION_URL: ecs.Secret.fromSecretsManager(this.appSecret, 'DATABASE_MIGRATION_URL'),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup }),
    });

    // One-off bootstrap task (`pnpm bootstrap:manager` equivalent). Uses the migrator image, which carries the
    // scripts and tsx. The Manager's details are passed as run-task overrides, never stored here.
    const bootstrap = new ecs.FargateTaskDefinition(this, 'BootstrapTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    bootstrap.addContainer('bootstrap', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, `${props.imageTag}-migrator`),
      command: ['pnpm', 'exec', 'tsx', 'scripts/bootstrap-manager.ts'],
      environment,
      secrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'bootstrap', logGroup }),
    });
    bootstrap.taskRole.addToPrincipalPolicy(sendMail);
    props.databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'One-off tasks in the VPC to PostgreSQL',
    );

    // WAF: AWS managed protections + rate limit on authentication endpoints.
    const waf = new wafv2.CfnWebACL(this, 'Waf', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `smartcode-${config.name}-waf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        managedRule('AWSManagedRulesCommonRuleSet', 1),
        managedRule('AWSManagedRulesKnownBadInputsRuleSet', 2),
        managedRule('AWSManagedRulesSQLiRuleSet', 3),
        {
          name: 'auth-rate-limit',
          priority: 10,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: config.authRateLimitPer5Min,
              aggregateKeyType: 'IP',
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/api/v1/auth',
                  textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'auth-rate-limit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WafAssociation', {
      resourceArn: this.service.loadBalancer.loadBalancerArn,
      webAclArn: waf.attrArn,
    });

    new CfnOutput(this, 'ApiRepositoryUri', { value: this.repository.repositoryUri });
    new CfnOutput(this, 'LoadBalancerDns', { value: this.service.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, 'MigrateTaskDefinitionArn', { value: migrate.taskDefinitionArn });
    new CfnOutput(this, 'BootstrapTaskDefinitionArn', { value: bootstrap.taskDefinitionArn });
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn });
  }
}

function managedRule(name: string, priority: number): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
    visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
  };
}
