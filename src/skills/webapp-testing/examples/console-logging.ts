#!/usr/bin/env bun
import { chromium } from 'playwright';
import * as fs from 'node:fs';

// Example: Capturing console logs during browser automation

const url = 'http://localhost:5173'; // Replace with your URL

const consoleLogs: string[] = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

// Set up console log capture
page.on('console', (msg) => {
  const line = `[${msg.type()}] ${msg.text()}`;
  consoleLogs.push(line);
  console.log(`Console: ${line}`);
});

// Navigate to page
await page.goto(url);
await page.waitForLoadState('networkidle');

// Interact with the page (triggers console logs)
await page.click('text=Dashboard');
await page.waitForTimeout(1000);

await browser.close();

// Save console logs to file
fs.writeFileSync('/mnt/user-data/outputs/console.log', consoleLogs.join('\n'));

console.log(`\nCaptured ${consoleLogs.length} console messages`);
console.log(`Logs saved to: /mnt/user-data/outputs/console.log`);
