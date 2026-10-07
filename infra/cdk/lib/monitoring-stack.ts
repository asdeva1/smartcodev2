import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type * as rds from 'aws-cdk-lib/aws-rds';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from './environments';

/** CloudWatch alarms → SNS topic (subscribe the on-call email in the runbook; no addresses in code). */
export class MonitoringStack extends Stack {
  readonly alarmTopic: sns.Topic;

  constructor(
    scope: Construct,
    id: string,
    config: EnvironmentConfig,
    api: ecsPatterns.ApplicationLoadBalancedFargateService,
    database: rds.DatabaseInstance,
    props?: StackProps,
  ) {
    super(scope, id, props);
    this.alarmTopic = new sns.Topic(this, 'Alarms', {
      displayName: `SmartCode ${config.name} alarms`,
      enforceSSL: true,
    });
    const notify = new actions.SnsAction(this.alarmTopic);
    const alarm = (name: string, metric: cloudwatch.IMetric, threshold: number, periods = 3) =>
      new cloudwatch.Alarm(this, name, {
        metric,
        threshold,
        evaluationPeriods: periods,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(notify);

    const lb = api.loadBalancer.metrics;
    alarm(
      'Api5xx',
      lb.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5) }),
      10,
    );
    alarm('ApiLatencyP95', lb.targetResponseTime({ statistic: 'p95', period: Duration.minutes(5) }), 2);
    alarm(
      'ApiUnhealthyTargets',
      api.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      1,
      2,
    );
    alarm('ApiCpu', api.service.metricCpuUtilization({ period: Duration.minutes(5) }), 85);
    alarm('DbCpu', database.metricCPUUtilization({ period: Duration.minutes(5) }), 80);
    alarm('DbConnections', database.metricDatabaseConnections({ period: Duration.minutes(5) }), 150);
    new cloudwatch.Alarm(this, 'DbFreeStorage', {
      metric: database.metricFreeStorageSpace({ period: Duration.minutes(15) }),
      threshold: 5 * 1024 ** 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
    }).addAlarmAction(notify);
  }
}
