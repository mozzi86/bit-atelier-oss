"""Minimal MCP client over stdio (106-05): spawn the server, initialize, tools/list, tools/call, close.

Transport: JSON-RPC 2.0, one JSON message per line (newline-delimited), exactly what tools/mcp-server.mjs speaks. No dependency
(the official `mcp` package is not installed and a new dependency needs the owner's yes) - the protocol surface the harness needs
is four methods.

The subprocess is driven with threads, not with asyncio's subprocess API: that API needs a ProactorEventLoop on Windows and fails
with NotImplementedError on a selector loop, and uvicorn may run either. Reader threads hand answers to the event loop with
`call_soon_threadsafe`, so the client works on every loop.

In:  the command line to start the server, optional env/cwd. Out: McpClient with `start()`, `list_tools()`, `call_tool()`, `close()`.
Errors are McpError with a German sentence; a server that dies or stops answering fails every pending call at once.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
from collections import deque
from typing import Any

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "atelier-ai-harness", "version": "0.1.0"}


class McpError(Exception):
    """A failure of the MCP connection or an error answer of the server (German sentence)."""


class McpClient:
    """timeout_s: longest wait for one answer, in s [ASSUMED: 60 s - one call is one HTTP round trip of the server to the app]."""

    def __init__(self, command: list[str], *, env: dict[str, str] | None = None, cwd: str | None = None, timeout_s: float = 60.0) -> None:
        self.command = list(command)
        self.env = env
        self.cwd = cwd
        self.timeout_s = timeout_s
        self.server_info: dict[str, Any] = {}
        self._proc: subprocess.Popen[str] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id = 0
        self._write_lock = threading.Lock()
        self._stderr: deque[str] = deque(maxlen=20)
        self._closed = False

    # --- lifecycle -------------------------------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None and not self._closed

    async def start(self) -> None:
        """Spawn the server and run the handshake (initialize + notifications/initialized)."""
        if self.running:
            return
        self._loop = asyncio.get_running_loop()
        self._closed = False
        try:
            self._proc = subprocess.Popen(
                self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", bufsize=1, env=self.env, cwd=self.cwd,
            )
        except FileNotFoundError:
            raise McpError(f"MCP-Server nicht startbar: {self.command[0]!r} wurde nicht gefunden (Node.js installiert?)")
        except OSError as exc:
            raise McpError(f"MCP-Server nicht startbar: {exc}")
        threading.Thread(target=self._read_stdout, args=(self._proc,), daemon=True, name="mcp-stdout").start()
        threading.Thread(target=self._read_stderr, args=(self._proc,), daemon=True, name="mcp-stderr").start()
        try:
            init = await self._request("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO})
        except McpError:
            await self.close()
            raise
        self.server_info = init.get("serverInfo") or {}
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    async def close(self) -> None:
        """Stop the server (stdin closed first: the server finishes answers in flight, then exits)."""
        self._closed = True
        proc, self._proc = self._proc, None
        self._fail_all("Die MCP-Verbindung wurde geschlossen")
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        try:
            await asyncio.get_running_loop().run_in_executor(None, lambda: proc.wait(timeout=3))
        except (subprocess.TimeoutExpired, Exception):
            proc.kill()

    # --- protocol --------------------------------------------------------------------------------
    async def list_tools(self) -> list[dict[str, Any]]:
        """All tools of the server (follows `nextCursor`)."""
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):  # a server that never ends its list must not hold us forever
            res = await self._request("tools/list", {"cursor": cursor} if cursor else {})
            tools.extend(res.get("tools") or [])
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """One tools/call; returns the server's result object {content: [...], isError?}."""
        return await self._request("tools/call", {"name": name, "arguments": arguments or {}})

    # --- plumbing --------------------------------------------------------------------------------
    def _send(self, message: dict[str, Any]) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None or proc.poll() is not None:
            raise McpError(self._died_text())
        line = json.dumps(message, ensure_ascii=False)
        try:
            with self._write_lock:
                proc.stdin.write(line + "\n")
                proc.stdin.flush()
        except (OSError, ValueError):
            raise McpError(self._died_text())

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        self._next_id += 1
        rid = self._next_id
        fut: asyncio.Future = loop.create_future()
        self._pending[rid] = fut
        try:
            self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
            try:
                return await asyncio.wait_for(fut, timeout=self.timeout_s)
            except asyncio.TimeoutError:
                raise McpError(f"Der MCP-Server antwortet nicht auf {method} (nach {self.timeout_s:.0f} s)")
        finally:
            self._pending.pop(rid, None)

    def _resolve(self, rid: int, result: Any = None, error: Exception | None = None) -> None:
        fut = self._pending.get(rid)
        if fut is None or fut.done():
            return
        if error is not None:
            fut.set_exception(error)
        else:
            fut.set_result(result if isinstance(result, dict) else {})

    def _fail_all(self, text: str) -> None:
        for rid in list(self._pending):
            self._resolve(rid, error=McpError(text))

    def _died_text(self) -> str:
        tail = " | ".join(list(self._stderr)[-3:])
        return "Der MCP-Server läuft nicht mehr" + (f" ({tail})" if tail else "")

    def _on_loop(self, fn, *args) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(fn, *args)

    def _read_stdout(self, proc: subprocess.Popen[str]) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                self._stderr.append(f"kein JSON: {line[:80]}")
                continue
            if not isinstance(msg, dict):
                continue
            rid = msg.get("id")
            if "method" in msg:
                # a request of the server (ping): answer politely, ignore notifications
                if rid is not None and msg.get("method") == "ping":
                    try:
                        self._send({"jsonrpc": "2.0", "id": rid, "result": {}})
                    except McpError:
                        pass
                continue
            if not isinstance(rid, int):
                continue
            if "error" in msg:
                err = msg["error"] if isinstance(msg["error"], dict) else {}
                self._on_loop(self._resolve, rid, None, McpError(f"MCP-Fehler {err.get('code', '?')}: {err.get('message', 'unbekannt')}"))
            else:
                self._on_loop(self._resolve, rid, msg.get("result"), None)
        # stdout closed: the server is gone
        self._on_loop(self._fail_all, self._died_text())

    def _read_stderr(self, proc: subprocess.Popen[str]) -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.strip()
            if line:
                self._stderr.append(line[:200])
