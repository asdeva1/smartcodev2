#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { buildApp } from '../lib/app';

const app = new App();
const ctx = (key: string): string | undefined => app.node.tryGetContext(key) ?? undefined;

buildApp(app, {
  env: ctx('env') ?? 'staging',
  certificateArn: ctx('certificateArn'),
  imageTag: ctx('imageTag'),
  webUrl: ctx('webUrl'),
  apiUrl: ctx('apiUrl'),
  appUrl: ctx('appUrl'),
  mailFrom: ctx('mailFrom'),
  cookieDomain: ctx('cookieDomain'),
  desiredCount: ctx('desiredCount') === undefined ? undefined : Number(ctx('desiredCount')),
});
