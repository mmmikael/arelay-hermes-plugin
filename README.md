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

Delivery appears in the **arelay.app inbox**, not in the Hermes chat. The agent's
text response is uploaded as `cron-output.txt` (`text/plain` by default), plus any
`MEDIA:` attachments as encrypted artifacts.

### Rich payloads (HTML, PDF, images, …)

The inbox previews each artifact by its filename and content type, and the plugin
already tells the agent (via its platform hint) to deliver rich formats as files.
So the cron prompt stays simple — just ask for the format:

```bash
/cron add "0 9 * * *" "Generate the daily France news briefing as an HTML page." --deliver arelay
```

The agent writes the file and references it with `MEDIA:/path/report.html`; the
extension determines the type and preview (`report.html` → HTML, `report.pdf` →
PDF, `report.md` → rendered Markdown). The text reply is uploaded as a plain-text
artifact alongside it.

To rename or retype that inline text artifact, set in `~/.hermes/.env`:

```bash
AGENT_RELAY_OUTPUT_FILENAME=cron-output.md      # optional; default cron-output.txt
AGENT_RELAY_OUTPUT_CONTENT_TYPE=text/markdown   # optional; default derived from filename extension
```

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

## Related

- [arelay-skills](https://github.com/mmmikael/arelay-skills) — `agent-relay` skill for interactive API deliveries
- [arelay](https://github.com/mmmikael/arelay) — Agent Relay app

## License

MIT — see [LICENSE](LICENSE).
