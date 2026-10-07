"""Atelier AI Harness — provider-agnostic agent core for the BIT Atelier App.

Package layout: config (YAML + .env), providers (profile data + two HTTP transports +
mock), agent (message schema, tool-calling loop, system prompt, session), tools
(registry, files, shell, memory, project, skills), workspace, skills, server, cli.
"""

__version__ = "0.1.0"
