import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from './environments';

/**
 * Private, KMS-encrypted buckets for CSV uploads and generated reports. TLS-only, no public access,
 * access logging, versioning and retention lifecycle (D-05). Files are reached only via presigned URLs.
 */
export class StorageStack extends Stack {
  readonly uploads: s3.Bucket;
  readonly reports: s3.Bucket;
  readonly key: kms.Key;

  constructor(
    scope: Construct,
    id: string,
    config: EnvironmentConfig,
    webOrigin: string,
    props?: StackProps,
  ) {
    super(scope, id, props);
    this.key = new kms.Key(this, 'StorageKey', {
      enableKeyRotation: true,
      description: `SmartCode ${config.name} object storage encryption`,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const accessLogs = new s3.Bucket(this, 'AccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(config.logRetentionDays) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const common: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: accessLogs,
      removalPolicy: RemovalPolicy.RETAIN,
    };

    this.uploads = new s3.Bucket(this, 'Uploads', {
      ...common,
      serverAccessLogsPrefix: 'uploads/',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [webOrigin],
          allowedHeaders: ['*'],
          maxAge: 600,
        },
      ],
      lifecycleRules: [
        {
          expiration: Duration.days(config.uploadRetentionDays),
          noncurrentVersionExpiration: Duration.days(7),
        },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });

    this.reports = new s3.Bucket(this, 'Reports', {
      ...common,
      serverAccessLogsPrefix: 'reports/',
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
    });
  }
}
