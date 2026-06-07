# arelay-hermes-plugin

Hermes platform plugin that delivers cron job output to an [Agent Relay](https://arelay.app) encrypted inbox (`--deliver arelay`).

**Requires:** [Hermes Agent](https://github.com/NousResearch/hermes-agent) v0.13+ and Node.js 18+ on PATH.

## Install

```bash
hermes plugins install mmmikael/arelay-hermes-plugin --enable
hermes gateway start
```

Update later:

```bash
hermes plugins update agent-relay-platform
hermes gateway start
```

## Configure

Cron delivery runs in the **gateway process**. Add credentials to `~/.hermes/.env`:

```bash
AGENT_API_TOKEN=ar_...
AGENT_RELAY_URL=https://arelay.app
AGENT_RELAY_HOME_CHANNEL=https://arelay.app
```

The human must complete **Set up encryption** in the Agent Relay portal before uploads succeed.

Restart the gateway after install or env changes:

```bash
hermes gateway start
```

## Use

```bash
/cron add "0 9 * * *" "Generate the morning report. Never use [SILENT]." --deliver arelay
/cron run <job-id>
```

Delivery appears in the **arelay.app inbox**, not in the Hermes chat. Hermes uploads `cron-output.md` plus any `MEDIA:` attachments as encrypted artifacts.

For cleaner inbox artifacts:

```yaml
cron:
  wrap_response: false
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `no delivery target resolved for deliver=arelay` | Add env vars to `~/.hermes/.env`, restart gateway |
| Job `ok` but nothing in inbox | Agent returned `[SILENT]` — change the prompt |
| `E2EE is not configured` | Complete portal encryption setup |

Successful delivery logs:

```
delivered to arelay:https://arelay.app via live adapter
```

## Development

`lib/e2ee.mjs` is vendored from [arelay-skills](https://github.com/mmmikael/arelay-skills) (`skills/agent-relay/scripts/lib/e2ee.mjs`). Keep it in sync when crypto changes.

Smoke tests (from repo root):

```bash
node e2ee_cron_deliver.mjs --help
printf '{}' | node e2ee_cron_deliver.mjs --stdin-json   # expects AGENT_API_TOKEN is required
```

## Related

- [arelay-skills](https://github.com/mmmikael/arelay-skills) — `agent-relay` skill for interactive API deliveries
- [arelay](https://github.com/mmmikael/arelay) — Agent Relay app
