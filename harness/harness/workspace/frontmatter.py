"""Frontmatter parsing (Hermes parse_frontmatter): YAML between --- fences, with a
key: value fallback for malformed YAML and BOM stripping for Windows editors."""

from __future__ import annotations

import re
from typing import Any

import yaml


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    content = content.removeprefix("﻿")
    if not content.startswith("---"):
        return {}, content
    end = re.search(r"\n---\s*(\n|$)", content[3:])
    if not end:
        return {}, content
    raw = content[3: end.start() + 3]
    body = content[end.end() + 3:]
    fm: dict[str, Any] = {}
    try:
        parsed = yaml.safe_load(raw)
        if isinstance(parsed, dict):
            fm = parsed
    except yaml.YAMLError:
        for line in raw.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = v.strip()
    return fm, body


def dump_frontmatter(fm: dict[str, Any], body: str) -> str:
    head = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, default_flow_style=False).strip()
    return f"---\n{head}\n---\n\n{body.strip()}\n"
