# Runbooks

| Runbook                                            | When to use it                                           |
| -------------------------------------------------- | -------------------------------------------------------- |
| [go-live-checklist.md](go-live-checklist.md)       | Before and during the first production launch            |
| [provision-production.md](provision-production.md) | One-time creation of the production AWS and Vercel setup |
| [bootstrap-manager.md](bootstrap-manager.md)       | Create the first Manager in a new environment            |
| [deploy.md](deploy.md)                             | Every release (staging, then production)                 |
| [rollback.md](rollback.md)                         | A release is misbehaving                                 |
| [backup-restore.md](backup-restore.md)             | Restore data, test the backups                           |
| [secrets-rotation.md](secrets-rotation.md)         | Rotate signing keys and database credentials             |
| [incident-response.md](incident-response.md)       | Alarm fired, outage, or suspected security incident      |

Commands are written for PowerShell on Windows with the AWS CLI configured for the target account. Replace the values in `<angle brackets>`.
Never paste passwords or keys into chat, tickets or commits.
