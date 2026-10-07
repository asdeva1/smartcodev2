import { type App, Tags } from 'aws-cdk-lib';
import { ApiStack } from './api-stack';
import { DataStack } from './data-stack';
import { resolveEnvironment } from './environments';
import { MonitoringStack } from './monitoring-stack';
import { NetworkStack } from './network-stack';
import { StorageStack } from './storage-stack';

export interface BuildOptions {
  env: string;
  certificateArn?: string;
  imageTag?: string;
  webUrl?: string;
  apiUrl?: string;
  appUrl?: string;
}

/** Builds every stack for one environment. Used by bin/smartcode.ts and the assertion tests. */
export function buildApp(app: App, options: BuildOptions) {
  const config = resolveEnvironment(options.env);
  const prefix = `SmartCode-${config.name === 'production' ? 'Prod' : 'Staging'}`;
  const awsEnv = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

  const network = new NetworkStack(app, `${prefix}-Network`, config, { env: awsEnv });
  const data = new DataStack(app, `${prefix}-Data`, config, network.vpc, { env: awsEnv });
  const webUrl = options.webUrl ?? `https://app.${config.name}.example.invalid`;
  const storage = new StorageStack(app, `${prefix}-Storage`, config, new URL(webUrl).origin, { env: awsEnv });
  const api = new ApiStack(app, `${prefix}-Api`, {
    env: awsEnv,
    config,
    vpc: network.vpc,
    database: data.database,
    databaseSecurityGroup: data.databaseSecurityGroup,
    uploads: storage.uploads,
    reports: storage.reports,
    storageKey: storage.key,
    certificateArn: options.certificateArn,
    imageTag: options.imageTag ?? 'unset',
    // D-06: domains are configuration. Placeholders until the real domains are decided.
    urls: {
      web: webUrl,
      api: options.apiUrl ?? `https://api.${config.name}.example.invalid`,
      app: options.appUrl ?? webUrl,
    },
  });
  const monitoring = new MonitoringStack(app, `${prefix}-Monitoring`, config, api.service, data.database, {
    env: awsEnv,
  });

  for (const stack of [network, data, storage, api, monitoring]) {
    Tags.of(stack).add('Project', 'SmartCode');
    Tags.of(stack).add('Environment', config.name);
    Tags.of(stack).add('DataClassification', 'healthcare-sensitive');
  }
  return { config, network, data, storage, api, monitoring };
}
