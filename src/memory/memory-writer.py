#!/usr/bin/env python3
"""Store extracted memories via mcp-memory-service. Reads JSON array from stdin.

Each entry: { content: string, tags: string, memory_type: string, source?: string,
              insight?: string, session_id?: string, memory_type_detail?: string }
Fire-and-forget — called from memory-extract.ts, runs in background.

Provenance is written upstream by memory-extract-stop.ts as memory_write events
in events.jsonl; this script is now write-only against the MCP memory store.
"""
import asyncio
import json
import os
import sys

DB_PATH = os.environ.get("MEMORY_DB_PATH", os.path.expanduser("~/.local/share/mcp-memory/sqlite_vec.db"))


async def main():
    raw = sys.stdin.read()
    try:
        memories = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(1)

    if not memories or not os.path.exists(DB_PATH):
        sys.exit(0)

    from mcp_memory_service.storage.factory import create_storage_instance
    from mcp_memory_service.services.memory_service import MemoryService

    storage = await create_storage_instance(DB_PATH)
    await storage.initialize()
    svc = MemoryService(storage)

    for mem in memories:
        content = mem.get("content", "").strip()
        if not content or len(content) < 20:
            continue
        try:
            await svc.store_memory(
                content=content,
                tags=mem.get("tags", "auto_extract"),
                memory_type=mem.get("memory_type", "observation"),
            )
        except Exception:
            pass  # storage failure — silently continue


if __name__ == "__main__":
    asyncio.run(main())
