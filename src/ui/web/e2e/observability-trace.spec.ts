/**
 * E2E tests for the observability session trace view.
 *
 * Ground truth independently computed from raw JSONL transcripts:
 *   152f9e26 — 17 turns, 3 stop.blocked hook spans
 *   9c457cd7 — 27 turns, 4 stop.blocked hook spans
 *   88f56c12 — 29 turns, 2 stop.blocked hook spans
 *
 * Key invariants tested:
 *  1. API returns the expected turn count for each session.
 *  2. API returns the expected number of stop.blocked hook spans.
 *  3. Hook feedback ("Stop hook...") messages are NOT rendered as user turns
 *     (they appear as hook spans instead).
 *  4. The first visible user message matches the actual first real user message.
 *  5. The "Messages" stat card on the trace page reflects the API turn count.
 */

import { test, expect, type Page } from "playwright/test";

// ── Session ground truth ───────────────────────────────────────────────────────

const SESSIONS = [
  {
    id: "152f9e26-c413-43a2-89a0-800b92a2261e",
    shortId: "152f9e26",
    expectedTurns: 17,
    expectedStopBlocked: 3,
    firstMessageSnippet: "many personal AIs",
  },
  {
    id: "9c457cd7-d114-4865-b454-3c543ed3e196",
    shortId: "9c457cd7",
    expectedTurns: 27,
    expectedStopBlocked: 4,
    firstMessageSnippet: "topic coherenced",
  },
  {
    id: "88f56c12-9011-4149-b965-aeda1a92db57",
    shortId: "88f56c12",
    expectedTurns: 29,
    expectedStopBlocked: 2,
    firstMessageSnippet: "Workers",
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

type TraceSpan = {
  id: string;
  kind: string;
  label: string;
  isError?: boolean;
};

type TraceTurn = {
  index: number;
  userMessage: string;
  spans: TraceSpan[];
};

type TraceResponse = {
  turns: TraceTurn[];
};

async function fetchTrace(page: Page, sessionId: string): Promise<TraceResponse> {
  const response = await page.request.get(
    `/api/observability/sessions/${sessionId}/trace`
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<TraceResponse>;
}

function countStopBlocked(turns: TraceTurn[]): number {
  return turns.reduce((acc, turn) => {
    return acc + turn.spans.filter((s) => s.label === "stop.blocked").length;
  }, 0);
}

function hasHookFeedbackUserMessage(turns: TraceTurn[]): boolean {
  return turns.some((turn) => {
    const msg = turn.userMessage ?? "";
    return (
      msg.startsWith("Stop hook feedback:") ||
      msg.startsWith("Stop hook blocking error:")
    );
  });
}

// ── API-level tests ────────────────────────────────────────────────────────────

test.describe("Session trace API", () => {
  for (const session of SESSIONS) {
    test(`${session.shortId}: returns ${session.expectedTurns} turns`, async ({
      page,
    }) => {
      const trace = await fetchTrace(page, session.id);
      expect(trace.turns).toHaveLength(session.expectedTurns);
    });

    test(`${session.shortId}: has ${session.expectedStopBlocked} stop.blocked spans`, async ({
      page,
    }) => {
      const trace = await fetchTrace(page, session.id);
      const blocked = countStopBlocked(trace.turns);
      expect(blocked).toBe(session.expectedStopBlocked);
    });

    test(`${session.shortId}: hook feedback is not stored as a user turn`, async ({
      page,
    }) => {
      const trace = await fetchTrace(page, session.id);
      expect(hasHookFeedbackUserMessage(trace.turns)).toBe(false);
    });

    test(`${session.shortId}: first user message contains expected text`, async ({
      page,
    }) => {
      const trace = await fetchTrace(page, session.id);
      const firstReal = trace.turns.find(
        (t) =>
          t.userMessage &&
          !t.userMessage.includes("<command-name>") &&
          !t.userMessage.includes("<task-notification>") &&
          !t.userMessage.includes("[Request interrupted")
      );
      expect(firstReal?.userMessage).toContain(session.firstMessageSnippet);
    });
  }
});

// ── UI-level tests ─────────────────────────────────────────────────────────────

test.describe("Session trace page UI", () => {
  for (const session of SESSIONS) {
    test(`${session.shortId}: Messages stat card shows ${session.expectedTurns}`, async ({
      page,
    }) => {
      await page.goto(`/observability/sessions/${session.id}`);

      // Wait for the page to load (stat cards appear when data is ready)
      await page.waitForSelector("text=Messages", { timeout: 10_000 });

      // The "Messages" stat card shows the turn count
      const statSection = page.locator("text=Messages").first();
      const card = statSection.locator("..");
      const value = await card.locator("text=/^\\d+$/").first().textContent();
      expect(Number(value)).toBe(session.expectedTurns);
    });

    test(`${session.shortId}: first user message is visible on the page`, async ({
      page,
    }) => {
      await page.goto(`/observability/sessions/${session.id}`);
      await page.waitForSelector("text=You", { timeout: 10_000 });

      // Page body should contain the first message snippet somewhere
      const body = await page.textContent("body");
      expect(body).toContain(session.firstMessageSnippet);
    });

    test(`${session.shortId}: no "Stop hook" text visible in user bubbles`, async ({
      page,
    }) => {
      await page.goto(`/observability/sessions/${session.id}`);
      await page.waitForSelector("text=You", { timeout: 10_000 });

      const body = await page.textContent("body");
      // Hook feedback must not appear as a user-facing "Stop hook feedback:" message
      expect(body).not.toContain("Stop hook feedback:");
      expect(body).not.toContain("Stop hook blocking error:");
    });
  }
});
