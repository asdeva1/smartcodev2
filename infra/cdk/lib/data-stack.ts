import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from './environments';

/**
 * PostgreSQL on RDS: encrypted with a customer-managed KMS key, TLS enforced, isolated subnets, automated
 * backups/PITR, Performance Insights and log export. Master credentials are generated into Secrets Manager —
 * nobody types or sees a database password. Redis (ElastiCache) is added in Phase 3.
 */
export class DataStack extends Stack {
  readonly database: rds.DatabaseInstance;
  readonly databaseSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, config: EnvironmentConfig, vpc: ec2.IVpc, props?: StackProps) {
    super(scope, id, props);
    const key = new kms.Key(this, 'DatabaseKey', {
      enableKeyRotation: true,
      description: `SmartCode ${config.name} database encryption`,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc,
      description: 'SmartCode PostgreSQL - ingress only from the API and worker tasks',
      allowAllOutbound: false,
    });

    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 });
    const parameterGroup = new rds.ParameterGroup(this, 'Parameters', {
      engine,
      parameters: { 'rds.force_ssl': '1', log_min_duration_statement: '1000', log_connections: '1' },
    });

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine,
      parameterGroup,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.databaseSecurityGroup],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize[
          config.database.instanceSize.toUpperCase() as 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE'
        ],
      ),
      databaseName: 'smartcode',
      credentials: rds.Credentials.fromGeneratedSecret('smartcode_admin'),
      storageEncrypted: true,
      storageEncryptionKey: key,
      allocatedStorage: config.database.allocatedStorageGb,
      maxAllocatedStorage: config.database.maxAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      multiAz: config.database.multiAz,
      backupRetention: Duration.days(config.database.backupRetentionDays),
      deletionProtection: config.database.deletionProtection,
      removalPolicy: config.database.deletionProtection ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: key,
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      copyTagsToSnapshot: true,
    });
  }
}
