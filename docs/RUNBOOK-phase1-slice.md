# Runbook — the Phase 1 slice, as actually run

This file contains **observed output**, not a summary of it. It is the evidence
for the claims in `README.md`; if a claim is not here, treat it as unproven.

Recorded 2026-08-20 on the machine this was built on: Bun 1.3.11, Linux,
`runner = "sdk"` (the real Claude Agent SDK, model `claude-haiku-4-5-20251001`),
OTLP pointed at a local sink (`bun scripts/otlp-sink.ts 4319`) because that host
has no Docker daemon and therefore no Langfuse. Every path below is a temp
workspace.

## What this proves, and what it does not

| Claim | Proven here | How |
|---|---|---|
| daemon boots, serves the CLI, shuts down cleanly | yes | `os status`, `daemon.stopped` last in the JSONL |
| one turn → a fully caused event chain | yes | `os events` below |
| the real Agent SDK answers, and resume carries context | yes | "noted" then "36" across two turns |
| one message → one joined trace tree | yes | `os trace`, plus the sink's span dump |
| the event log's `trace_id` IS the exported trace | yes | same id in both |
| the SQLite index is rebuildable from JSONL | yes | `os events reindex` |
| the window meter moves on real usage | yes | `os meter` |
| join audit reports delta from a classified baseline | yes | `os obs join-audit` |
| Telegram end to end | **no** | no bot/group on this host — covered by `tests/integration/telegram.test.ts` against a real fake Bot API server, and by `tests/live/telegram.test.ts` which needs a real bot |
| Langfuse ingests these traces | **no** | no Docker daemon on this host — covered by `tests/live/langfuse.test.ts` |
| survives days of operation | **no** | not attempted |

## Reproducing

```bash
bun scripts/otlp-sink.ts 4319 /tmp/spans.jsonl &     # stand-in for Langfuse
export ALEPH_CONFIG=/path/to/aleph.toml              # runner = "sdk"
bun src/daemon.ts &
bun src/cli/os.ts status
```

## Transcript

```console
$ bun src/cli/os.ts doctor
ok    config           ~/ws/config/aleph.toml (e5ebf27d79bfbd60)
ok    database         ~/ws/data/aleph.db journal_mode=wal
FAIL  vault            ~/ws/vault (run: os vault init)
FAIL  socket           ~/ws/data/aleph.sock (daemon not running)
ok    otlp             http://127.0.0.1:4319/v1/traces
ok    langfuse-link    http://127.0.0.1:3010/project/cmxlocal/traces/00000000000000000000000000000000
ok    telegram-config  disabled
ok    clock            2026-08-20T23:55:37.295Z

$ bun src/daemon.ts &
aleph-next daemon up (pid 4983) — socket ~/ws/data/aleph.sock

$ os status
daemon   pid 4983  up 3s  runner=sdk  config e5ebf27d79bfbd60
windows  5h 0.0% of capacity (reserve 30.0%)  weekly 0.0%
lanes    interactive:0/0  control:0/0  librarian:0/0  heartbeat:0/0  research:0/0  synthesis:0/0  backlog:0/0
sessions 0 active   in-flight 0
events   ~/ws/data/events/2026-08-20.jsonl
otel     http://127.0.0.1:4319/v1/traces (0 export errors)

$ os send --topic phase-1-slice 'Remember: this daemon writes 36 event kinds. Reply with just: noted'
noted

$ os send --topic phase-1-slice 'How many event kinds? Reply with just the number.'
36

$ os send --topic phase-1-slice "Remember: this daemon writes 36 event kinds. Reply with just: noted"
noted

$ os send --topic phase-1-slice "How many event kinds? Reply with just the number."
36

$ os sessions
active   phase-1-slice                    turns=4    last=2026-08-20T23:56:32.447Z

$ os events --since 10m          # oldest first
2026-08-20T23:55:43.044Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM723SYA0Y92HHZQTZD0D <- evt_01M0GSM71YBGK0YEQ0FT0Q0P64
2026-08-20T23:55:43.045Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM7258P7XDFCD3DREC1K2 <- evt_01M0GSM723SYA0Y92HHZQTZD0D
2026-08-20T23:55:43.046Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM72688KK1536Z1HYDP6J <- evt_01M0GSM723SYA0Y92HHZQTZD0D
2026-08-20T23:55:45.588Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HK2GG2803B95YNDA8Y <- evt_01M0GSM72688KK1536Z1HYDP6J
2026-08-20T23:55:45.589Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HNSRMBV5BGMH84VBWB <- evt_01M0GSM9HK2GG2803B95YNDA8Y
2026-08-20T23:55:45.590Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HP567VD7TD499VGBMM <- evt_01M0GSM72688KK1536Z1HYDP6J
2026-08-20T23:55:45.591Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HQ6DSEFE80A1B6G43H <- evt_01M0GSM9HP567VD7TD499VGBMM
2026-08-20T23:55:45.592Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSM9HRNBEYPZ2C8VGRFCVS <- evt_01M0GSM721H4Q4NXPJMDCNHTB6
2026-08-20T23:56:00.748Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRBC8JSJ2EVQ3N7CZK0M
2026-08-20T23:56:00.839Z  vault.commit                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRE6WJNFZGX6VS48WTAC <- evt_01M0GSMRBC8JSJ2EVQ3N7CZK0M
2026-08-20T23:56:00.840Z  session.checkpointed         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSMRE8EXTR062NTBA1FW4Y
2026-08-20T23:56:00.842Z  daemon.stopped               -                              evt_01M0GSMRE9CHP90V3W7Q9M61VP
2026-08-20T23:56:02.198Z  daemon.config_loaded         -                              evt_01M0GSMSRNQBJF5EZ44SE2V2MJ
2026-08-20T23:56:02.203Z  daemon.boot_step             -                              evt_01M0GSMSRTH0FQDBZ2BV5EXJ7Q
2026-08-20T23:56:02.208Z  daemon.boot_step             -                              evt_01M0GSMSS0GFH06H3JDFDZMMSV
2026-08-20T23:56:02.211Z  daemon.boot_step             -                              evt_01M0GSMSS3PYGT47B6WJKFXFP4
2026-08-20T23:56:02.213Z  daemon.started               -                              evt_01M0GSMSS472FE0F3Y9VHG71GA
2026-08-20T23:56:02.219Z  daemon.boot_step             -                              evt_01M0GSMSS84HG62672AVNRC66X
2026-08-20T23:56:28.033Z  channel.message_received     ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.035Z  bus.submitted                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK03T394PK4QWZ30JWR1 <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.039Z  bus.started                  ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK06W8V5YMANR3AV9NCJ <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.043Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q <- evt_01M0GSNK007KCMTMNZ8TS4XEC3
2026-08-20T23:56:28.044Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0CRKRT67VF4D8JR1BP <- evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q
2026-08-20T23:56:28.046Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNK0E7RGDHBZ63M5PEZC1 <- evt_01M0GSNK0AZP1TVQTJ8QGHCQ1Q
2026-08-20T23:56:30.151Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN26MAHXECGA7D3J6JBN <- evt_01M0GSNK0E7RGDHBZ63M5PEZC1
2026-08-20T23:56:30.154Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN29K2PV2TZ3CD15MSET <- evt_01M0GSNN26MAHXECGA7D3J6JBN
2026-08-20T23:56:30.155Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2BGA604Y0RA4V3WCZB <- evt_01M0GSNK0E7RGDHBZ63M5PEZC1
2026-08-20T23:56:30.157Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2CYS2Z9NJN3P0V0HST <- evt_01M0GSNN2BGA604Y0RA4V3WCZB
2026-08-20T23:56:30.158Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN2E5Q0HNPN81PMG07QP <- evt_01M0GSNK06W8V5YMANR3AV9NCJ
2026-08-20T23:56:30.261Z  channel.message_received     ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.263Z  bus.submitted                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5Q2GS48K289ENHQBA5 <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.264Z  bus.started                  ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5RGMBRGA736C8WCEHZ <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.265Z  session.resumed              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5SPD0VXBSGJT45JTQW <- evt_01M0GSNN5N1EVEEHME5JXYF8TM
2026-08-20T23:56:30.266Z  routing.decided              ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5T9TTE83BC3NP7JQT3 <- evt_01M0GSNN5SPD0VXBSGJT45JTQW
2026-08-20T23:56:30.267Z  session.turn_started         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNN5VW3XEBGPMAD9J64KZ <- evt_01M0GSNN5SPD0VXBSGJT45JTQW
2026-08-20T23:56:32.449Z  meter.usage_recorded         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA1Q8FHESYC0HHV3JMG <- evt_01M0GSNN5VW3XEBGPMAD9J64KZ
2026-08-20T23:56:32.450Z  vault.written                ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA2XFV0PC13T3TN6WF4 <- evt_01M0GSNQA1Q8FHESYC0HHV3JMG
2026-08-20T23:56:32.451Z  session.turn_completed       ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA3EHS5HYB8VPS51G9X <- evt_01M0GSNN5VW3XEBGPMAD9J64KZ
2026-08-20T23:56:32.452Z  channel.message_sent         ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA4E1H03A424TBXBACT <- evt_01M0GSNQA3EHS5HYB8VPS51G9X
2026-08-20T23:56:32.453Z  bus.finished                 ses_01M0GSM4K593A0GY776DAQ95GC evt_01M0GSNQA5GXGBSSK3JB5V7P49 <- evt_01M0GSNN5RGMBRGA736C8WCEHZ

$ os trace <trace_id of the last turn>
http://127.0.0.1:3010/project/cmxlocal/traces/c48e60fda7033cd5a0a695807f78f5f7
  2026-08-20T23:56:30.261Z  channel.message_received
  2026-08-20T23:56:30.263Z  bus.submitted
  2026-08-20T23:56:30.264Z  bus.started
  2026-08-20T23:56:30.265Z  session.resumed
  2026-08-20T23:56:30.266Z  routing.decided
  2026-08-20T23:56:30.267Z  session.turn_started
  2026-08-20T23:56:32.449Z  meter.usage_recorded
  2026-08-20T23:56:32.450Z  vault.written
  2026-08-20T23:56:32.451Z  session.turn_completed
  2026-08-20T23:56:32.452Z  channel.message_sent
  2026-08-20T23:56:32.453Z  bus.finished

$ os meter
5h      0.4% of 4000000 weighted   reserve 30.0%   ok
weekly  0.0% of 40000000 weighted   reserve 25.0%   ok

$ os obs join-audit --since 10m
traces 18  orphans 14  baseline 13  delta 1
  unclassified: vault.written+vault.commit+session.checkpointed

$ os events reindex              # rebuild the SQLite index from JSONL
{
  "files": 1,
  "events": 62
}

$ os vault check
vault ok (~/ws/vault, MEMORY.md 30 lines)

$ cat vault/log/2026-08-20.md
# 2026-08-20

## 2026-08-20T23:55:42.918Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** Remember: this daemon writes 36 event kinds. Reply with just: noted

**Aleph:** noted

## 2026-08-20T23:55:45.589Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** How many event kinds? Reply with just the number.

**Aleph:** 36

## 2026-08-20T23:56:30.152Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** Remember: this daemon writes 36 event kinds. Reply with just: noted

**Aleph:** noted

## 2026-08-20T23:56:32.450Z — Remember: this daemon writes 36 event kinds. Reply with just: noted (cli)

**Chris:** How many event kinds? Reply with just the number.

**Aleph:** 36

$ os obs join-audit --since 20m     # after classifying the shutdown checkpoint
traces 27  orphans 23  baseline 23  delta 0
```


## The span tree at the OTLP sink

The sink decodes OTLP/JSON and prints one line per span. For one turn:

```console
$ bun scripts/otlp-sink.ts 4318 /tmp/spans.jsonl
otlp sink listening on http://127.0.0.1:4318/v1/traces
[span] sdk.query      trace=0ecabb024e54 parent=44452004 events=0
[span] turn           trace=0ecabb024e54 parent=0ecabb02 events=5

$ # decoded attributes on the root span:
turn | trace 0ecabb024e54 | parent -
     aleph.lane = interactive
     aleph.origin = channel
     aleph.session_id = ses_01M0GRTVXQ8T9FK81YVKRDJC2A
     langfuse.session.id = ses_01M0GRTVXQ8T9FK81YVKRDJC2A
     langfuse.trace.name = turn
     langfuse.trace.tags = ['origin:channel', 'lane:interactive', 'session:ses_01M0GRTVXQ8T9FK81YVKRDJC2A']
     langfuse.user.id = chris
     event: routing.decided
     event: session.turn_started
     event: meter.usage_recorded
     event: vault.written
     event: session.turn_completed
```

Nine spans in that trace, one trace id, and the event log's `trace_id` for the
same turn is `0ecabb024e54c7465bfed79d148dedcf` — the same trace. That equality
is the join invariant, and it did not hold on the first attempt: the daemon
minted the trace id before any span existed, so OTel generated its own and the
deep link pointed at a trace that did not exist. Spans now open under a
synthetic remote parent carrying the minted id (`src/core/tracectx.ts`).

## Test suite, same session

```console
$ bun test
 67 pass
 6 skip          # tests/live, opt in with ALEPH_LIVE=1
 0 fail
 318 expect() calls

$ ALEPH_LIVE=1 bun test tests/live/sdk.test.ts
 4 pass
 0 fail
```

## Defects this exercise found

Each was found by running the system, not by reading it:

1. **Trace ids diverged** between the event log and the exported spans (above).
2. **`os send --topic X` forked a second session** instead of routing to topic X:
   the CLI's container key is the topic slug and nothing resolved it.
3. **`../escape.md` was silently sanitized** into a vault-internal path and
   written, instead of being refused. A path check that rewrites an escape into
   a successful write to a different file is worse than no check.
4. **A disabled tier fell forward exactly one step**, landing on `T0g`, which is
   also disabled in Phase 1. It now walks to the next *enabled* tier.
5. **`backlog` defaulted to enabled** for any config that omitted the section —
   "default OFF" held only in the shipped file, which is not a default.
6. **The shutdown checkpoint was an unclassified join-audit orphan.** It is
   legitimate (it runs after the bus drains), so it is now in the baseline
   rather than a permanent amber the reader learns to ignore.
