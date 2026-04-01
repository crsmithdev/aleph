import type { Sqlite } from '@construct/data';
import type { LLMProvider } from './engine.js';
import type { Monitor, MatchCriteria, MonitorAlert } from './types.js';
import * as monitors from './services/monitors.js';
import { createHash } from 'crypto';

export interface MonitorEngineOptions {
  sqlite: Sqlite;
  provider: LLMProvider;
}

interface ParsedItem {
  title: string;
  url: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export class MonitorEngine {
  private sqlite: Sqlite;
  private provider: LLMProvider;

  constructor(opts: MonitorEngineOptions) {
    this.sqlite = opts.sqlite;
    this.provider = opts.provider;
  }

  async runCycle(monitorId: string): Promise<{
    snapshotId: string;
    alerts: MonitorAlert[];
    cost: number;
  }> {
    const monitor = monitors.getMonitor(this.sqlite, monitorId);
    if (!monitor || monitor.status !== 'active') {
      throw new Error(`Monitor ${monitorId} not found or not active`);
    }

    // Step 1: Execute queries
    const results = await this.executeQueries(monitor);

    // Step 2: Parse into discrete items
    const items = await this.parseResults(monitor, results);

    // Step 3: Create snapshot
    const rawResults = JSON.stringify(items);
    const snapshot = monitors.createSnapshot(
      this.sqlite,
      monitorId,
      rawResults,
      items.length,
      results.cost
    );

    // Step 4: Diff against previous snapshot
    const prevSnapshot = monitors.listSnapshots(this.sqlite, monitorId, 2)[1]; // second-latest
    const diff = prevSnapshot
      ? this.diffSnapshots(items, JSON.parse(prevSnapshot.raw_results) as ParsedItem[])
      : { newItems: items, removedItems: [], changedItems: [] };

    // Step 5: Filter through match criteria and create alerts
    const alerts: MonitorAlert[] = [];

    for (const item of diff.newItems) {
      if (this.matchesCriteria(item, monitor.match_criteria)) {
        if (monitors.isAlertDuplicate(this.sqlite, monitorId, item.title, item.url)) continue;

        const severity = this.evaluateSeverity(item, monitor.match_criteria);
        const alert = monitors.createAlert(this.sqlite, {
          monitor_id: monitorId,
          snapshot_id: snapshot.id,
          alert_type: 'new_item',
          title: item.title,
          content: item.content,
          source_url: item.url,
          matched_criteria: this.getMatchedCriteria(item, monitor.match_criteria),
          severity,
        });
        alerts.push(alert);
      }
    }

    for (const item of diff.removedItems) {
      const alert = monitors.createAlert(this.sqlite, {
        monitor_id: monitorId,
        snapshot_id: snapshot.id,
        alert_type: 'removed_item',
        title: `Removed: ${item.title}`,
        content: item.content,
        source_url: item.url,
        severity: 'info',
      });
      alerts.push(alert);
    }

    for (const { current, previous } of diff.changedItems) {
      if (monitors.isAlertDuplicate(this.sqlite, monitorId, current.title, current.url)) continue;

      const alert = monitors.createAlert(this.sqlite, {
        monitor_id: monitorId,
        snapshot_id: snapshot.id,
        alert_type: 'changed_item',
        title: `Changed: ${current.title}`,
        content: `Previous: ${previous.content}\n\nCurrent: ${current.content}`,
        source_url: current.url,
        severity: 'notable',
      });
      alerts.push(alert);
    }

    return { snapshotId: snapshot.id, alerts, cost: results.cost };
  }

  private async executeQueries(monitor: Monitor): Promise<{ text: string; cost: number }> {
    const allResults: string[] = [];
    let totalCost = 0;

    for (const query of monitor.queries) {
      try {
        const result = await this.provider.searchWeb(monitor.model, query);
        allResults.push(result.text);
        const cost = (result.promptTokens * 3 + result.completionTokens * 15) / 1_000_000;
        totalCost += cost;
      } catch {
        // Skip failed queries, continue
      }
    }

    return { text: allResults.join('\n\n---\n\n'), cost: totalCost };
  }

  private async parseResults(monitor: Monitor, results: { text: string }): Promise<ParsedItem[]> {
    if (!results.text.trim()) return [];

    const response = await this.provider.complete(
      monitor.model,
      `Parse these search results into discrete items. Each item should have a title, URL (if available), and content summary.

Search results:
${results.text}

Return a JSON array of objects with: title, url (null if none), content, metadata (any additional data like price, date, location).
Return ONLY valid JSON array.`,
      4096
    );

    try {
      const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [{
        title: 'Unparsed results',
        url: null,
        content: results.text.slice(0, 1000),
        metadata: {},
      }];
    }
  }

  private diffSnapshots(
    current: ParsedItem[],
    previous: ParsedItem[]
  ): {
    newItems: ParsedItem[];
    removedItems: ParsedItem[];
    changedItems: Array<{ current: ParsedItem; previous: ParsedItem }>;
  } {
    const prevMap = new Map<string, ParsedItem>();
    for (const item of previous) {
      const key = item.url ?? item.title;
      prevMap.set(key, item);
    }

    const currentMap = new Map<string, ParsedItem>();
    for (const item of current) {
      const key = item.url ?? item.title;
      currentMap.set(key, item);
    }

    const newItems: ParsedItem[] = [];
    const changedItems: Array<{ current: ParsedItem; previous: ParsedItem }> = [];

    for (const [key, item] of currentMap) {
      const prev = prevMap.get(key);
      if (!prev) {
        newItems.push(item);
      } else {
        const prevHash = createHash('md5').update(JSON.stringify(prev.metadata)).digest('hex');
        const currHash = createHash('md5').update(JSON.stringify(item.metadata)).digest('hex');
        if (prevHash !== currHash) {
          changedItems.push({ current: item, previous: prev });
        }
      }
    }

    const removedItems: ParsedItem[] = [];
    for (const [key, item] of prevMap) {
      if (!currentMap.has(key)) removedItems.push(item);
    }

    return { newItems, removedItems, changedItems };
  }

  private matchesCriteria(item: ParsedItem, criteria: MatchCriteria): boolean {
    const text = `${item.title} ${item.content}`.toLowerCase();

    if (criteria.keywords_include?.length) {
      if (!criteria.keywords_include.some(kw => text.includes(kw.toLowerCase()))) return false;
    }

    if (criteria.keywords_exclude?.length) {
      if (criteria.keywords_exclude.some(kw => text.includes(kw.toLowerCase()))) return false;
    }

    if (criteria.location_filter) {
      if (!text.includes(criteria.location_filter.toLowerCase())) return false;
    }

    return true;
  }

  private evaluateSeverity(item: ParsedItem, criteria: MatchCriteria): MonitorAlert['severity'] {
    const text = `${item.title} ${item.content}`.toLowerCase();

    if (criteria.severity_rules?.urgent) {
      if (text.includes(criteria.severity_rules.urgent.toLowerCase())) return 'urgent';
    }
    if (criteria.severity_rules?.notable) {
      if (text.includes(criteria.severity_rules.notable.toLowerCase())) return 'notable';
    }

    return 'info';
  }

  private getMatchedCriteria(item: ParsedItem, criteria: MatchCriteria): string[] {
    const matched: string[] = [];
    const text = `${item.title} ${item.content}`.toLowerCase();

    for (const kw of criteria.keywords_include ?? []) {
      if (text.includes(kw.toLowerCase())) matched.push(`keyword: ${kw}`);
    }
    if (criteria.location_filter && text.includes(criteria.location_filter.toLowerCase())) {
      matched.push(`location: ${criteria.location_filter}`);
    }

    return matched;
  }
}
