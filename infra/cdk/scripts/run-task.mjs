#!/usr/bin/env node
/**
 * Runs a one-off ECS Fargate task (migrations, status, diff, Manager bootstrap), waits for it to stop,
 * prints its CloudWatch logs and exits with the container's exit code. Runs on the operator's machine.
 *
 *   node scripts/run-task.mjs --profile P --region R --cluster C --task-def ARN --subnets a,b --security-group sg-x \
 *        [--command "pnpm exec prisma migrate status"] [--env KEY=value --env KEY2=value2]
 *
 * Logs are the application's own logs (the API never logs secrets or tokens). Nothing secret is passed here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
for (const required of ['profile', 'region', 'cluster', 'task-def', 'subnets', 'security-group']) {
  if (!opt(required)) {
    console.error(`Missing --${required}`);
    process.exit(2);
  }
}
const base = ['--profile', opt('profile'), '--region', opt('region')];
const aws = (...a) =>
  execFileSync('aws', [...a, ...base], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const json = (...a) => JSON.parse(aws(...a, '--output', 'json'));

const taskDef = json('ecs', 'describe-task-definition', '--task-definition', opt('task-def')).taskDefinition;
const container = taskDef.containerDefinitions[0];
const logOptions = container.logConfiguration?.options ?? {};

const overrides = { containerOverrides: [{ name: container.name }] };
if (opt('command')) overrides.containerOverrides[0].command = opt('command').split(/\s+/).filter(Boolean);
const envPairs = all('env').map((pair) => {
  const at = pair.indexOf('=');
  return { name: pair.slice(0, at), value: pair.slice(at + 1) };
});
if (envPairs.length) overrides.containerOverrides[0].environment = envPairs;

const dir = mkdtempSync(join(tmpdir(), 'sc-task-'));
let started;
try {
  const file = join(dir, 'overrides.json');
  writeFileSync(file, JSON.stringify(overrides), { mode: 0o600 });
  started = json(
    'ecs',
    'run-task',
    '--cluster',
    opt('cluster'),
    '--task-definition',
    opt('task-def'),
    '--launch-type',
    'FARGATE',
    '--network-configuration',
    `awsvpcConfiguration={subnets=[${opt('subnets')}],securityGroups=[${opt('security-group')}],assignPublicIp=DISABLED}`,
    '--overrides',
    `file://${file.replaceAll('\\', '/')}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (started.failures?.length || !started.tasks?.length) {
  console.error('Task did not start:', JSON.stringify(started.failures));
  process.exit(1);
}
const taskArn = started.tasks[0].taskArn;
const taskId = taskArn.split('/').pop();
console.log(`Started task ${taskId}; waiting for it to finish (up to 10 minutes)...`);
try {
  aws('ecs', 'wait', 'tasks-stopped', '--cluster', opt('cluster'), '--tasks', taskArn);
} catch {
  console.error('Timed out waiting for the task. Check the ECS console.');
}
const stopped = json('ecs', 'describe-tasks', '--cluster', opt('cluster'), '--tasks', taskArn).tasks[0];
const exitCode = stopped.containers?.[0]?.exitCode;
console.log(`Stopped: ${stopped.stoppedReason ?? 'n/a'}; container exit code: ${exitCode ?? 'none'}`);
if (logOptions['awslogs-group']) {
  try {
    const stream = `${logOptions['awslogs-stream-prefix']}/${container.name}/${taskId}`;
    const events = json(
      'logs',
      'get-log-events',
      '--log-group-name',
      logOptions['awslogs-group'],
      '--log-stream-name',
      stream,
      '--limit',
      '300',
      '--start-from-head',
    ).events;
    console.log('----- task logs -----');
    for (const e of events) console.log(e.message);
  } catch (error) {
    console.error('Could not read logs:', String(error.stderr ?? error.message).slice(0, 300));
  }
}
process.exit(exitCode === 0 ? 0 : 1);
