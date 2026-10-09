# Create the first Manager

A new environment has no users. The first Manager is created by a one-off task; the Manager then sets their own password through an emailed activation link. No password is ever typed, stored or sent by the operator.

Prerequisites: migrations applied; SES can send from `MAIL_FROM` (in a new AWS account, request SES production access first, otherwise the recipient address must be verified).

1. Run the bootstrap task (output `BootstrapTaskDefinitionArn`):
   ```powershell
   node infra/cdk/scripts/run-task.mjs --profile <profile> --region <region> --cluster <cluster> `
     --task-def <BootstrapTaskDefinitionArn> --subnets <private-subnets> --security-group <api-sg> `
     --env BOOTSTRAP_MANAGER_EMAIL=<email> --env "BOOTSTRAP_MANAGER_NAME=<full name>" --env BOOTSTRAP_MANAGER_EMPLOYEE_ID=<code>
   ```
2. The task prints `created` and sends the activation email. The link is valid for a limited time.
3. The Manager opens the link, sets a password, and signs in.
4. Running the task again is safe: if an active Manager exists it does nothing; if activation is still pending it resends the email.
5. The Manager creates the other accounts from Employees. Consider a second Manager for cover.

If the email does not arrive, check SES sending status and the spam folder; do not use `--print-link` (refused outside local development).
