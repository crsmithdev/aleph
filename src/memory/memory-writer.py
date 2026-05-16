#!/usr/bin/env python3
"""Store extracted memories via mcp-memory-service. Reads JSON array from stdin.

Each entry: { content: string, tags: string, memory_type: string, source?: string,
              insight?: string, session_id?: string, memory_type_detail?: string }
Fire-and-forget — called from memory-extract.ts, runs in background.
"""
import asyncio
import datetime
import hashlib
import json
import os
import re
import sys

DB_PATH = os.environ.get("MEMORY_DB_PATH", os.path.expanduser("~/.local/share/mcp-memory/sqlite_vec.db"))

PROVENANCE_PATH = os.environ.get(
    "LEARNING_PROVENANCE_PATH",
    os.path.expanduser("~/.construct/signals/learning-provenance.jsonl"),
)


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
            result = await svc.store_memory(
                content=content,
                tags=mem.get("tags", "auto_extract"),
                memory_type=mem.get("memory_type", "observation"),
            )
            try:
                memory_id = None
                is_duplicate = False
                if isinstance(result, dict):
                    if result.get('success'):
                        memory_id = (result.get('memory') or {}).get('content_hash')
                    else:
                        # Extract hash from duplicate error message, or compute from content
                        err = result.get('error', '')
                        m = re.search(r'[0-9a-f]{8,}', err)
                        memory_id = m.group(0) if m else hashlib.sha256(content.encode()).hexdigest()[:16]
                        is_duplicate = True
                else:
                    memory_id = getattr(result, 'id', None) or getattr(result, 'memory_id', None)
                if memory_id:
                    entry = {
                        "ts": datetime.datetime.utcnow().isoformat() + "Z",
                        "sessionId": mem.get("session_id", "unknown"),
                        "memoryId": memory_id,
                        "type": mem.get("memory_type_detail", "session"),
                        "source": mem.get("source", ""),
                        "insight": mem.get("insight", ""),
                        "content": content,
                        "tags": mem.get("tags", ""),
                        **({"duplicate": True} if is_duplicate else {}),
                    }
                    os.makedirs(os.path.dirname(PROVENANCE_PATH), exist_ok=True)
                    with open(PROVENANCE_PATH, "a") as f:
                        f.write(json.dumps(entry) + "\n")
            except Exception:
                pass  # provenance write must never crash the main loop
        except Exception:
            pass  # dedup rejection or other — silently continue


if __name__ == "__main__":
    asyncio.run(main())
