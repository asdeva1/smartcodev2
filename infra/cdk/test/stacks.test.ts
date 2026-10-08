import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/app';

const CERT = 'arn:aws:acm:us-east-1:000000000000:certificate/placeholder';

function synth(env: 'staging' | 'production', certificateArn?: string) {
  const app = new App();
  const stacks = buildApp(app, { env, certificateArn, imageTag: 'test' });
  return {
    stacks,
    data: Template.fromStack(stacks.data),
    storage: Template.fromStack(stacks.storage),
    api: Template.fromStack(stacks.api),
    network: Template.fromStack(stacks.network),
    monitoring: Template.fromStack(stacks.monitoring),
  };
}

describe('production', () => {
  const t = synth('production', CERT);

  it('RDS PostgreSQL is encrypted, private, Multi-AZ, protected and backed up for 35 days', () => {
    t.data.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      MultiAZ: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 35,
    });
    t.data.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: Match.objectLike({ 'rds.force_ssl': '1' }),
    });
    t.data.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('database credentials are generated into Secrets Manager', () => {
    t.data.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('S3 buckets block public access, use KMS and are versioned', () => {
    const buckets = t.storage.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(3);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
    t.storage.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }) }),
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('uploads accept browser PUTs only from the configured web origin', () => {
    t.storage.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedOrigins: ['https://app.production.example.invalid'] })],
      },
    });
    expect(JSON.stringify(t.storage.toJSON())).not.toContain('"AllowedOrigins":["*"]');
  });

  it('every bucket denies non-TLS access', () => {
    const policies = Object.values(t.storage.findResources('AWS::S3::BucketPolicy'));
    expect(policies.length).toBe(3);
    for (const policy of policies) {
      expect(JSON.stringify(policy)).toContain('aws:SecureTransport');
    }
  });

  it('API runs on Fargate with 2+ tasks, HTTPS and circuit-breaker rollback', () => {
    t.api.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 2,
      LaunchType: 'FARGATE',
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
    t.api.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Protocol: 'HTTPS' });
    t.api.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/health/live',
    });
  });

  it('secrets are injected from Secrets Manager, never as plain environment values', () => {
    const taskDefs = Object.values(t.api.findResources('AWS::ECS::TaskDefinition'));
    for (const td of taskDefs) {
      for (const container of td.Properties.ContainerDefinitions) {
        const envNames = (container.Environment ?? []).map((e: { Name: string }) => e.Name);
        expect(envNames).not.toContain('DATABASE_URL');
        expect(envNames).not.toContain('JWT_PRIVATE_KEY');
        expect((container.Secrets ?? []).map((s: { Name: string }) => s.Name)).toContain('DATABASE_URL');
      }
    }
  });

  it('domains come from configuration (D-06)', () => {
    const api = Object.values(t.api.findResources('AWS::ECS::TaskDefinition'))[0]!;
    const env = api.Properties.ContainerDefinitions[0].Environment as { Name: string; Value: unknown }[];
    expect(env.find((e) => e.Name === 'WEB_URL')?.Value).toMatch(/^https:\/\//);
    expect(JSON.stringify(env)).not.toContain('localhost');
  });

  it('WAF with managed rules and auth rate limiting is attached to the load balancer', () => {
    t.api.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({ Name: 'AWSManagedRulesSQLiRuleSet' }),
        Match.objectLike({ Name: 'auth-rate-limit' }),
      ]),
    });
    t.api.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  it('ECR images are scanned and immutable; migration and bootstrap tasks exist', () => {
    t.api.hasResourceProperties('AWS::ECR::Repository', {
      ImageScanningConfiguration: { ScanOnPush: true },
      ImageTagMutability: 'IMMUTABLE',
    });
    t.api.resourceCountIs('AWS::ECS::TaskDefinition', 3);
  });

  it('VPC flow logs and alarms exist', () => {
    t.network.resourceCountIs('AWS::EC2::FlowLog', 1);
    expect(Object.keys(t.monitoring.findResources('AWS::CloudWatch::Alarm')).length).toBeGreaterThanOrEqual(
      7,
    );
  });

  it('resource descriptions are ASCII (CloudFormation rejects others for security groups)', () => {
    for (const template of [t.data, t.api, t.storage, t.network, t.monitoring]) {
      const json = JSON.stringify(template.toJSON());
      for (const m of json.matchAll(/"(?:GroupDescription|Description)":"([^"]*)"/g)) {
        expect(m[1], m[1]).toMatch(/^[\x20-\x7E]*$/);
      }
    }
  });

  it('production without a certificate is a synth error', () => {
    const app = new App();
    const { api } = buildApp(app, { env: 'production', imageTag: 'test' });
    Annotations.fromStack(api).hasError('*', Match.stringLikeRegexp('Production requires HTTPS'));
  });
});

describe('staging', () => {
  const t = synth('staging');

  it('is smaller and not deletion-protected, with a warning instead of HTTPS', () => {
    t.data.hasResourceProperties('AWS::RDS::DBInstance', {
      MultiAZ: false,
      DeletionProtection: false,
      BackupRetentionPeriod: 7,
    });
    t.api.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
    Annotations.fromStack(t.stacks.api).hasWarning('*', Match.stringLikeRegexp('HTTP only'));
  });

  it('allows a shorter backup retention for free-plan accounts, but never in production', () => {
    const app = new App();
    const { data } = buildApp(app, { env: 'staging', imageTag: 'test', backupRetentionDays: 1 });
    Template.fromStack(data).hasResourceProperties('AWS::RDS::DBInstance', { BackupRetentionPeriod: 1 });
    expect(() => buildApp(new App(), { env: 'production', backupRetentionDays: 1 })).toThrow(/production/);
  });

  it('can put an https CloudFront front door in front of the ALB (staging stop-gap), never production', () => {
    const { api } = buildApp(new App(), { env: 'staging', imageTag: 'test', cloudFrontApi: true });
    const template = Template.fromStack(api);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'https-only' }),
      }),
    });
    const prod = buildApp(new App(), { env: 'production', imageTag: 'test', cloudFrontApi: true });
    Annotations.fromStack(prod.api).hasError('*', Match.stringLikeRegexp('stop-gap'));
  });

  it('rejects unknown environments', () => {
    expect(() => buildApp(new App(), { env: 'dev' })).toThrow(/Unknown deployment environment/);
  });
});
