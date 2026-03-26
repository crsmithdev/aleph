#!/usr/bin/env python3
"""Search semantic memory and print formatted results. Used by session-start.ts.

Usage: python memory-reader.py "query string" [n_results]
Prints compact formatted results to stdout. Exits 0 on any error (non-blocking).
"""
import asyncio
import os
import sys

DB_PATH = os.environ.get("MEMORY_DB_PATH", os.path.expanduser("~/.local/share/mcp-memory/sqlite_vec.db"))


async def main():
    if len(sys.argv) < 2:
        sys.exit(0)

    query = sys.argv[1]
    n_results = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    if not os.path.exists(DB_PATH):
        sys.exit(0)

    from mcp_memory_service.storage.factory import create_storage_instance
    from mcp_memory_service.services.memory_service import MemoryService

    storage = await create_storage_instance(DB_PATH)
    await storage.initialize()
    svc = MemoryService(storage)

    result = await svc.retrieve_memories(query, n_results=n_results)

    if not isinstance(result, dict) or "memories" not in result:
        sys.exit(0)

    memories = result["memories"]
    if not memories:
        sys.exit(0)

    for mem in memories:
        content = mem.get("content", "").strip().replace("\n", " ")
        tags = mem.get("tags", [])
        if isinstance(tags, list):
            tags = ", ".join(tags)
        mem_type = mem.get("memory_type", "")
        print(f"  - [{mem_type}] {content}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        sys.exit(0)
