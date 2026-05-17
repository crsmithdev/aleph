#!/usr/bin/env bun
import { chromium } from 'playwright';
import * as path from 'node:path';

// Example: Automating interaction with static HTML files using file:// URLs

const htmlFilePath = path.resolve('path/to/your/file.html');
const fileUrl = `file://${htmlFilePath}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

// Navigate to local HTML file
await page.goto(fileUrl);

// Take screenshot
await page.screenshot({ path: '/mnt/user-data/outputs/static_page.png', fullPage: true });

// Interact with elements
await page.click('text=Click Me');
await page.fill('#name', 'John Doe');
await page.fill('#email', 'john@example.com');

// Submit form
await page.click('button[type="submit"]');
await page.waitForTimeout(500);

// Take final screenshot
await page.screenshot({ path: '/mnt/user-data/outputs/after_submit.png', fullPage: true });

await browser.close();

console.log('Static HTML automation completed!');
