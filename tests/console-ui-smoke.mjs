import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "file:///C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(root, "artifacts");
const consoleUrl = process.env.BIM_AGENT_CONSOLE_URL ?? "http://127.0.0.1:4180";
await mkdir(artifacts, { recursive: true });

async function verify(page, screenshotName) {
  await page.goto(consoleUrl, { waitUntil: "networkidle" });
  await page.locator("#task-list .task-row").first().waitFor();
  assert.equal(await page.locator(".summary-strip > div").count(), 4);
  assert.equal((await page.locator("main").innerText()).includes("Codex Token"), false);
  assert.equal((await page.locator("#task-list").innerText()).includes("個事件"), false);
  await page.locator("#open-result-detail").click();
  await page.locator("#result-drawer:not([hidden])").waitFor();
  assert.equal(await page.locator('[data-section="input"]').isVisible(), false);
  assert.equal(await page.locator('[data-section="raw"]').isVisible(), false);
  const body = await page.locator("#drawer-body").innerText();
  assert.equal(body.includes("Request ID"), false);
  assert.equal(body.includes("Source hash"), false);
  const box = await page.locator("#result-drawer").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport);
  assert.ok(box.x >= 0 && box.y >= 0);
  assert.ok(box.x + box.width <= viewport.width + 1);
  assert.ok(box.y + box.height <= viewport.height + 1);
  await page.screenshot({ path: resolve(artifacts, screenshotName), fullPage: true });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
});
try {
  await verify(await browser.newPage({ viewport: { width: 1440, height: 900 } }), "console-v08-default-desktop.png");
  await verify(await browser.newPage({ viewport: { width: 390, height: 844 } }), "console-v08-default-mobile.png");
} finally {
  await browser.close();
}
