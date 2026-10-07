/**
 * Per-environment sizing and protection (docs/11-deployment-architecture.md).
 * Account and region are supplied at deploy time (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION) — the production
 * region must be confirmed for healthcare data before real PHI is introduced (D-05).
 */
export type DeployEnv = 'staging' | 'production';

export interface EnvironmentConfig {
  name: DeployEnv;
  maxAzs: number;
  natGateways: number;
  database: {
    instanceSize: 'micro' | 'small' | 'medium' | 'large';
    allocatedStorageGb: number;
    maxAllocatedStorageGb: number;
    multiAz: boolean;
    backupRetentionDays: number;
    deletionProtection: boolean;
  };
  api: { desiredCount: number; maxCount: number; cpu: number; memoryMiB: number };
  logRetentionDays: number;
  /** Raw uploaded CSV files are deleted after this many days (retention control, D-05). */
  uploadRetentionDays: number;
  /** Requests per 5 minutes per IP before WAF blocks auth endpoints. */
  authRateLimitPer5Min: number;
}

export const ENVIRONMENTS: Readonly<Record<DeployEnv, EnvironmentConfig>> = {
  staging: {
    name: 'staging',
    maxAzs: 2,
    natGateways: 1,
    database: {
      instanceSize: 'micro',
      allocatedStorageGb: 20,
      maxAllocatedStorageGb: 50,
      multiAz: false,
      backupRetentionDays: 7,
      deletionProtection: false,
    },
    api: { desiredCount: 1, maxCount: 2, cpu: 512, memoryMiB: 1024 },
    logRetentionDays: 30,
    uploadRetentionDays: 30,
    authRateLimitPer5Min: 300,
  },
  production: {
    name: 'production',
    maxAzs: 2,
    natGateways: 2,
    database: {
      instanceSize: 'medium',
      allocatedStorageGb: 100,
      maxAllocatedStorageGb: 500,
      multiAz: true,
      backupRetentionDays: 35,
      deletionProtection: true,
    },
    api: { desiredCount: 2, maxCount: 6, cpu: 1024, memoryMiB: 2048 },
    logRetentionDays: 365,
    uploadRetentionDays: 90,
    authRateLimitPer5Min: 300,
  },
};

export function resolveEnvironment(name: string | undefined): EnvironmentConfig {
  if (name === 'staging' || name === 'production') return ENVIRONMENTS[name];
  throw new Error(`Unknown deployment environment "${name ?? ''}". Use -c env=staging or -c env=production.`);
}
