"""
Agent Relay platform plugin for Hermes Agent.

This plugin is intentionally one-way: cron deliveries are uploaded to the
human's Agent Relay encrypted inbox instead of a chat room.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult

DEFAULT_RELAY_URL = "https://arelay.app"
DEFAULT_OUTPUT_FILENAME = "cron-output.txt"
HELPER_SCRIPT = Path(__file__).with_name("e2ee_cron_deliver.mjs")
HELPER_TIMEOUT_SECONDS = 300


def _relay_url() -> str:
    return (os.getenv("AGENT_RELAY_URL") or DEFAULT_RELAY_URL).rstrip("/")


def _api_token() -> str:
    return os.getenv("AGENT_API_TOKEN", "").strip()


def _output_filename() -> str:
    name = os.getenv("AGENT_RELAY_OUTPUT_FILENAME", "").strip()
    return name or DEFAULT_OUTPUT_FILENAME


def _output_content_type() -> Optional[str]:
    value = os.getenv("AGENT_RELAY_OUTPUT_CONTENT_TYPE", "").strip()
    return value or None


def _node_path() -> Optional[str]:
    return shutil.which("node")


def _node_meets_minimum() -> tuple[bool, str]:
    node = _node_path()
    if not node:
        return False, "Node.js 18+ is required on PATH for Agent Relay delivery"
    try:
        result = subprocess.run(
            [
                node,
                "-e",
                "const v=parseInt(process.versions.node.split('.')[0],10);"
                "process.exit(v<18?1:0)",
            ],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False, "Could not verify Node.js version for Agent Relay delivery"
    if result.returncode != 0:
        return False, "Node.js 18+ is required for Agent Relay delivery"
    return True, ""


def _ensure_home_channel_env() -> None:
    """Let `deliver=arelay` resolve without exposing the API token as chat_id."""
    if _api_token() and not os.getenv("AGENT_RELAY_HOME_CHANNEL"):
        os.environ["AGENT_RELAY_HOME_CHANNEL"] = _relay_url()


def check_requirements() -> bool:
    _ensure_home_channel_env()
    node_ok, _ = _node_meets_minimum()
    return bool(_api_token()) and node_ok


def _env_enablement() -> Optional[dict[str, Any]]:
    _ensure_home_channel_env()
    if not _api_token():
        return None

    relay_url = _relay_url()
    return {
        "relay_url": relay_url,
        "home_channel": {
            "chat_id": os.getenv("AGENT_RELAY_HOME_CHANNEL", relay_url),
            "name": "Agent Relay Inbox",
        },
    }


def _title_from_message(message: str) -> str:
    for raw_line in message.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("(job_id:") or set(line) <= {"-"}:
            continue
        if line.lower().startswith("cronjob response:"):
            line = line.split(":", 1)[1].strip()
        return line[:120] or "Hermes cron delivery"
    return "Hermes cron delivery"


async def _run_helper(payload: dict[str, Any]) -> dict[str, Any]:
    node_ok, node_error = _node_meets_minimum()
    if not node_ok:
        return {"error": node_error}

    if not HELPER_SCRIPT.exists():
        return {"error": f"Agent Relay helper not found: {HELPER_SCRIPT}"}

    env = {
        **os.environ,
        "AGENT_RELAY_URL": _relay_url(),
        "AGENT_API_TOKEN": _api_token(),
    }
    proc = await asyncio.create_subprocess_exec(
        "node",
        str(HELPER_SCRIPT),
        "--stdin-json",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(json.dumps(payload).encode("utf-8")),
            timeout=HELPER_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {
            "error": (
                f"Agent Relay delivery timed out after {HELPER_TIMEOUT_SECONDS}s"
            )
        }

    if proc.returncode != 0:
        error = stderr.decode("utf-8", errors="replace").strip()
        return {"error": error or f"helper exited with code {proc.returncode}"}

    output = stdout.decode("utf-8", errors="replace").strip()
    try:
        result = json.loads(output)
    except json.JSONDecodeError:
        return {"error": f"helper returned non-JSON output: {output[:500]}"}

    return result


async def _standalone_deliver_to_arelay(
    pconfig,
    chat_id: str,
    message: str,
    *,
    thread_id=None,
    media_files=None,
    force_document: bool = False,
) -> dict[str, Any]:
    if not _api_token():
        return {"error": "AGENT_API_TOKEN is required for Agent Relay delivery"}
    node_ok, node_error = _node_meets_minimum()
    if not node_ok:
        return {"error": node_error}

    payload = {
        "title": _title_from_message(message),
        "summary": "Uploaded by Hermes cron via Agent Relay.",
        "filename": _output_filename(),
        "message": message,
        "mediaFiles": list(media_files or []),
    }
    content_type = _output_content_type()
    if content_type:
        payload["contentType"] = content_type
    result = await _run_helper(payload)
    if result.get("error"):
        return result

    session_id = result.get("sessionId", "")
    return {"success": True, "message_id": session_id or "agent-relay-delivery"}


class AgentRelayAdapter(BasePlatformAdapter):
    """Minimal adapter that treats Agent Relay as a one-way delivery target."""

    def __init__(self, config, **kwargs):
        super().__init__(config=config, platform=Platform("arelay"))
        self.relay_url = _relay_url()

    @property
    def name(self) -> str:
        return "Agent Relay"

    async def connect(self) -> bool:
        if not _api_token():
            self._set_fatal_error(
                "config_missing",
                "AGENT_API_TOKEN is required for Agent Relay delivery",
                retryable=False,
            )
            return False
        node_ok, node_error = _node_meets_minimum()
        if not node_ok:
            self._set_fatal_error(
                "config_missing",
                node_error,
                retryable=False,
            )
            return False
        self._mark_connected()
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> SendResult:
        result = await _standalone_deliver_to_arelay(
            None,
            chat_id,
            content,
            media_files=(metadata or {}).get("media_files"),
        )
        if result.get("success"):
            return SendResult(success=True, message_id=result.get("message_id"))
        return SendResult(success=False, error=result.get("error", "Agent Relay delivery failed"))

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": "Agent Relay Inbox", "type": "inbox"}


def register(ctx) -> None:
    # Hermes resolves deliver=arelay from AGENT_RELAY_HOME_CHANNEL at plugin load time.
    _ensure_home_channel_env()
    ctx.register_platform(
        name="arelay",
        label="Agent Relay",
        adapter_factory=lambda cfg: AgentRelayAdapter(cfg),
        check_fn=check_requirements,
        validate_config=lambda _cfg: check_requirements(),
        required_env=["AGENT_API_TOKEN"],
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="AGENT_RELAY_HOME_CHANNEL",
        standalone_sender_fn=_standalone_deliver_to_arelay,
        max_message_length=0,
        pii_safe=True,
        emoji="AR",
        platform_hint=(
            "Agent Relay is a one-way encrypted inbox. Do not expect replies from "
            "this platform; deliver complete artifacts or reports. "
            "Requires Hermes Agent v0.13+ and Node.js 18+."
        ),
    )
