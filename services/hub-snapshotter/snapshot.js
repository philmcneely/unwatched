// Periodic island snapshotter for the region map. Reads the hub registry, renders each island's
// own clean map view, and writes a PNG the hub serves at /snap/<id>.png. Static, accurate, light.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const HUB = (process.env.HUB_URL || "http://uw2-hub:4600").replace(/\/$/, "");
const OUT = process.env.SNAP_DIR || "/data/snaps";
const CHROMIUM = process.env.CHROMIUM || "/usr/bin/chromium";
const INTERVAL = Math.max(5, parseInt(process.env.INTERVAL_MIN || "45", 10)) * 60 * 1000;
const SETTLE = Math.max(3000, parseInt(process.env.SETTLE_MS || "22000", 10)); // the map camera eases to the whole-island zoom over ~20s; wait it out before the shot
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pass(browser) {
  let islands = [];
  try {
    const r = await fetch(`${HUB}/world/islands`, { signal: AbortSignal.timeout(8000) });
    islands = (await r.json()).islands || [];
  } catch (e) { console.log("[snap] hub fetch failed:", e.message); return false; }
  if (!islands.length) return false;
  fs.mkdirSync(OUT, { recursive: true });
  for (const i of islands) {
    if (!i.url) continue;
    const page = await browser.newPage();
    try {
      // capture at the island's OWN aspect ratio so view=map leaves uniform sea margin all around
      // (a square frame fit a wide island edge-to-edge and clipped the coast)
      const sw = (i.size && i.size.w) || 3000, sh = (i.size && i.size.h) || 1800;
      const W = 1280, H = Math.round(W * sh / sw);
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      // NOT networkidle: the island holds a WebSocket open, so the network never goes idle. DOM + a fixed settle.
      await page.goto(`${i.url}/film?view=map&clean=1&fx=0`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.addStyleTag({ content: "body>*:not(main){display:none!important}" }); // drop analytics/feedback chrome
      await sleep(SETTLE);
      const tmp = path.join(OUT, `.${i.id}.tmp.png`), fin = path.join(OUT, `${i.id}.png`);
      await page.screenshot({ path: tmp });
      fs.renameSync(tmp, fin); // atomic swap so the hub never serves a half-written file
      console.log(`[snap] ${i.id} ok`);
    } catch (e) { console.log(`[snap] ${i.id} failed:`, e.message); }
    finally { await page.close().catch(() => {}); }
  }
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
  });
  for (;;) {
    console.log("[snap] pass", new Date().toISOString());
    const ok = await pass(browser);
    await sleep(ok ? INTERVAL : 15000); // if the hub wasn't ready, retry soon instead of waiting a full interval
  }
})().catch((e) => { console.error("[snap] fatal:", e); process.exit(1); });
