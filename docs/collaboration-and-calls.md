# Collaboration: chat, channels and calls

## What people get

- **Messages** (left menu, every role): a team channel for each team (made automatically), open and private channels, and direct messages.
- **Calls**: audio call, video call and screen sharing inside any conversation (Audio call / Video call / Join call buttons).
- Unread counts, edit and delete your own messages. A Manager can delete any message.

## Who sees what

- Vendor staff only meet their own vendor's people and spaces. Managers meet everyone.
- Open channels: everyone inside the vendor boundary. Private channels and direct messages: members only (the Manager does not read private spaces they are not in).
- A team channel follows the team: its Team Lead, its members, and the Manager.
- Chat is plain text. The screen reminds people not to share patient information (PHI).

## How it is delivered

- Chat and channels live in PostgreSQL. The screen refreshes every few seconds while the tab is open (no live connection is needed, so it works through the current staging network setup).
- Calls use LiveKit. The API only signs a short-lived token for one room (`sc-<channel id>`); audio, video and screen sharing travel between the browser and LiveKit directly.

## Switch calls on (once per environment)

1. Create a LiveKit Cloud project (or run LiveKit yourself). Note the project address (`wss://<project>.livekit.cloud`), a key (the LiveKit "API key") and its signing key (the LiveKit "API secret").
2. Store the keys privately (never in chat or in git):
   ```powershell
   aws secretsmanager put-secret-value --profile smartcode-staging --region ap-south-1 `
     --secret-id <CallsSecretArn from the cdk output> `
     --secret-string '{"LIVEKIT_KEY_ID":"<LiveKit API key>","LIVEKIT_SIGNING_KEY":"<LiveKit API secret>"}'
   ```
3. Deploy the API with the address: add `-c callsUrl=wss://<project>.livekit.cloud` to the `cdk deploy` command, then restart the service (`aws ecs update-service --force-new-deployment`).
4. Web (Vercel): set `NEXT_PUBLIC_CALLS_URL` to the same address if it is not a `*.livekit.cloud` address, then redeploy.
5. Check: open Messages in two browsers, press Video call in one and Join call in the other.

Until step 2 and 3 are done the screens show "Calls not set up yet" and everything else works.

## Limits to know

- Messages arrive within a few seconds, not instantly (live push needs production networking).
- Browsers ask for camera, microphone and screen permission the first time.
- Calls are not recorded.
