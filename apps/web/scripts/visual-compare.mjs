/**
 * Playwright visual comparison: design templates vs Next.js implementation.
 * Design export is served at DS_BASE; app at APP_BASE.
 *
 * Usage: node scripts/visual-compare.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "visual-compare");
const DS_BASE = process.env.DS_BASE || "http://127.0.0.1:8765";
const APP_BASE = process.env.APP_BASE || "http://127.0.0.1:3000";

/** Map: design template path → app route */
const PAGES = [
  { id: "home", design: "/templates/home/Home.dc.html", app: "/" },
  { id: "pricing", design: "/templates/pricing/Pricing.dc.html", app: "/pricing" },
  { id: "about", design: "/templates/about/About.dc.html", app: "/about" },
  { id: "blog", design: "/templates/blog/Blog.dc.html", app: "/blog" },
  { id: "blog-post", design: "/templates/blog-post/BlogPost.dc.html", app: "/blog/rally-length-trends" },
  { id: "changelog", design: "/templates/changelog/Changelog.dc.html", app: "/changelog" },
  { id: "docs", design: "/templates/documentation/Documentation.dc.html", app: "/docs" },
  { id: "privacy", design: "/templates/privacy/Privacy.dc.html", app: "/privacy" },
  { id: "terms", design: "/templates/terms/Terms.dc.html", app: "/terms" },
  { id: "feature-video-analysis", design: "/templates/feature-video-analysis/FeatureVideoAnalysis.dc.html", app: "/features/video-analysis" },
  { id: "feature-highlights", design: "/templates/feature-highlights/FeatureHighlights.dc.html", app: "/features/highlights" },
  { id: "feature-dashboard", design: "/templates/feature-dashboard/FeatureDashboard.dc.html", app: "/features/dashboard" },
  { id: "feature-replay", design: "/templates/feature-replay/FeatureReplay.dc.html", app: "/features/replay" },
  { id: "auth", design: "/templates/auth/Auth.dc.html", app: "/auth" },
  { id: "bwf", design: "/templates/bwf/Bwf.dc.html", app: "/bwf" },
  { id: "dashboard", design: "/templates/dashboard/Dashboard.dc.html", app: "/dashboard" },
  { id: "library", design: "/templates/library/Library.dc.html", app: "/dashboard/library" },
  { id: "analysis", design: "/templates/analysis/Analysis.dc.html", app: "/dashboard/analysis" },
  { id: "highlights", design: "/templates/highlights/Highlights.dc.html", app: "/dashboard/highlights" },
  { id: "settings", design: "/templates/settings/Settings.dc.html", app: "/dashboard/settings" },
  { id: "help-support", design: "/templates/help-support/HelpSupport.dc.html", app: "/dashboard/help-support" },
  { id: "compare", design: "/templates/compare/Compare.dc.html", app: "/dashboard/compare" },
  { id: "video-analysis", design: "/templates/video-analysis/VideoAnalysis.dc.html", app: "/video-analysis" },
  { id: "calibration", design: "/templates/calibration/Calibration.dc.html", app: "/calibration" },
  { id: "replay", design: "/templates/replay/Replay.dc.html", app: "/replay" },
];

const VIEWPORT = { width: 1440, height: 900 };

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function compareImages(designPath, appPath, diffPath) {
  const img1 = readPng(designPath);
  const img2 = readPng(appPath);
  const w = Math.min(img1.width, img2.width);
  const h = Math.min(img1.height, img2.height);

  // Crop both to common size
  const crop = (img) => {
    if (img.width === w && img.height === h) return img;
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * img.width + x) << 2;
        const di = (y * w + x) << 2;
        out.data[di] = img.data[si];
        out.data[di + 1] = img.data[si + 1];
        out.data[di + 2] = img.data[si + 2];
        out.data[di + 3] = img.data[si + 3];
      }
    }
    return out;
  };

  const a = crop(img1);
  const b = crop(img2);
  const diff = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(a.data, b.data, diff.data, w, h, {
    threshold: 0.15,
    includeAA: false,
  });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const total = w * h;
  const pct = (mismatched / total) * 100;
  return { mismatched, total, pct, width: w, height: h };
}

async function settle(page) {
  // Wait for fonts / layout / ds runtime
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  }).catch(() => {});
  // Hide scrollbars / disable animations for stable shots
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-delay: 0s !important;
        transition-duration: 0.001s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      [data-reveal] { opacity: 1 !important; transform: none !important; }
      ::-webkit-scrollbar { display: none !important; }
    `,
  }).catch(() => {});
  await page.waitForTimeout(400);
}

async function capture(page, url, outFile) {
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  const status = res?.status() ?? 0;
  await settle(page);
  await page.screenshot({ path: outFile, fullPage: false });
  const text = await page.locator("body").innerText().catch(() => "");
  return { status, textLen: text.trim().length, textSample: text.trim().slice(0, 120).replace(/\s+/g, " ") };
}

async function main() {
  ensureDir(OUT);
  ensureDir(path.join(OUT, "design"));
  ensureDir(path.join(OUT, "app"));
  ensureDir(path.join(OUT, "diff"));

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const results = [];

  for (const p of PAGES) {
    const designShot = path.join(OUT, "design", `${p.id}.png`);
    const appShot = path.join(OUT, "app", `${p.id}.png`);
    const diffShot = path.join(OUT, "diff", `${p.id}.png`);

    process.stdout.write(`\n▸ ${p.id}\n`);

    let designInfo, appInfo, cmp;
    try {
      designInfo = await capture(page, DS_BASE + p.design, designShot);
      process.stdout.write(`  design: ${designInfo.status} text=${designInfo.textLen}\n`);
    } catch (e) {
      designInfo = { status: 0, error: e.message, textLen: 0 };
      process.stdout.write(`  design FAIL: ${e.message}\n`);
    }

    try {
      appInfo = await capture(page, APP_BASE + p.app, appShot);
      process.stdout.write(`  app:    ${appInfo.status} text=${appInfo.textLen}\n`);
    } catch (e) {
      appInfo = { status: 0, error: e.message, textLen: 0 };
      process.stdout.write(`  app FAIL: ${e.message}\n`);
    }

    if (fs.existsSync(designShot) && fs.existsSync(appShot)) {
      try {
        cmp = compareImages(designShot, appShot, diffShot);
        process.stdout.write(
          `  diff:   ${cmp.pct.toFixed(1)}% (${cmp.mismatched}/${cmp.total} px)\n`,
        );
      } catch (e) {
        cmp = { error: e.message };
        process.stdout.write(`  diff FAIL: ${e.message}\n`);
      }
    }

    // Structural checks
    const appMissing = appInfo?.status === 404 || (appInfo?.textLen ?? 0) < 40;
    const designEmpty = (designInfo?.textLen ?? 0) < 40;

    results.push({
      id: p.id,
      design: p.design,
      app: p.app,
      designStatus: designInfo?.status,
      appStatus: appInfo?.status,
      designTextLen: designInfo?.textLen,
      appTextLen: appInfo?.textLen,
      designSample: designInfo?.textSample,
      appSample: appInfo?.textSample,
      diffPct: cmp?.pct ?? null,
      mismatched: cmp?.mismatched ?? null,
      appMissing,
      designEmpty,
      error: designInfo?.error || appInfo?.error || cmp?.error || null,
    });
  }

  await browser.close();

  // Report
  const reportPath = path.join(OUT, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  const ranked = [...results].sort((a, b) => (b.diffPct ?? 100) - (a.diffPct ?? 100));
  const missing = results.filter((r) => r.appMissing || r.appStatus === 404);
  const high = results.filter((r) => (r.diffPct ?? 100) > 35);
  const mid = results.filter((r) => (r.diffPct ?? 0) > 15 && (r.diffPct ?? 0) <= 35);
  const low = results.filter((r) => (r.diffPct ?? 0) <= 15);

  const md = [];
  md.push("# Visual comparison report");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push(`| Bucket | Count |`);
  md.push(`|--------|------:|`);
  md.push(`| Missing / 404 | ${missing.length} |`);
  md.push(`| High diff (>35%) | ${high.length} |`);
  md.push(`| Medium diff (15–35%) | ${mid.length} |`);
  md.push(`| Low diff (≤15%) | ${low.length} |`);
  md.push("");
  md.push("## Per page");
  md.push("");
  md.push("| Page | Diff % | App status | Design text | App text |");
  md.push("|------|-------:|-----------:|------------:|---------:|");
  for (const r of ranked) {
    md.push(
      `| ${r.id} | ${r.diffPct == null ? "—" : r.diffPct.toFixed(1)} | ${r.appStatus ?? "—"} | ${r.designTextLen ?? 0} | ${r.appTextLen ?? 0} |`,
    );
  }
  md.push("");
  md.push("Screenshots: `visual-compare/design|app|diff/*.png`");
  md.push("");

  const mdPath = path.join(OUT, "REPORT.md");
  fs.writeFileSync(mdPath, md.join("\n"));
  console.log("\n" + md.join("\n"));
  console.log(`\nWrote ${reportPath}`);
  console.log(`Wrote ${mdPath}`);

  // Exit non-zero if any missing pages
  if (missing.length) {
    console.error(`\n${missing.length} missing app routes: ${missing.map((m) => m.id).join(", ")}`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
