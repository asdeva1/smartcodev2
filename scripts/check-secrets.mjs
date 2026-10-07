#!/usr/bin/env node
// pnpm secrets:check — scans every git-tracked (and staged) file for committed secrets and forbidden files.
// Complements gitleaks in CI; runs locally with no network access. Prints file:line and rule, never the value.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const FORBIDDEN_FILES = [
  /(^|\/)\.env(\.|$)(?!example$)/,
  /\.pem$/,
  /\.p12$/,
  /\.key$/,
  /(^|\/)id_(rsa|ed25519)$/,
];
const RULES = [
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret access key', /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/],
  [
    'Database URL with password',
    /postgres(?:ql)?:\/\/[^:\s/'"]+:(?!<|\$\{|placeholder@|\*\*\*@|p@|pass@|password@)[^@\s'"]+@(?!localhost[:/]|127\.0\.0\.1)/,
  ],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  [
    'Generic secret assignment',
    /\b(?:SECRET|PASSWORD|API_KEY|TOKEN)[A-Z_]*\s*=\s*['"]?(?![<$]|\s*$)[A-Za-z0-9/+=_-]{16,}/,
  ],
];
const SKIP = [/^pnpm-lock\.yaml$/, /\.(png|ico|jpg|jpeg|gif|woff2?|ttf)$/, /^scripts\/check-secrets\.mjs$/];

const findings = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) {
    findings.push(`${file}: forbidden file type (must never be committed)`);
    continue;
  }
  if (SKIP.some((re) => re.test(file))) continue;
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) findings.push(`${file}:${i + 1}: ${name}`);
  });
}

if (findings.length) {
  console.error(`Secret scan FAILED (${findings.length}):\n  ${findings.join('\n  ')}`);
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files checked, no secrets found.`);
