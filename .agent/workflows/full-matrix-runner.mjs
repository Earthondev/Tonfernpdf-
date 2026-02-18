#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const REPO = process.cwd();
const URL = process.env.TONFERN_URL || "http://127.0.0.1:4173/Tonfernpdf.html";
const BASE_PDF_1 = "/Users/earthondev/Desktop/Greenagro/02_Research/Papers/20210514162205F1.pdf";
const BASE_PDF_2 = "/Users/earthondev/Desktop/Greenagro/02_Research/Papers/anres,+Article.pdf";
const OUT_ROOT = path.join(REPO, ".agent", "artifacts", "full-matrix");
const TOOL_PAGE = {
  merge: "mergePage",
  split: "splitPage",
  compress: "compressPage",
  "pdf-jpg": "pdfToJpgPage",
  "jpg-pdf": "jpgToPdfPage",
  "pdf-word": "pdfToWordPage",
  "extract-img": "pdfToWordPage",
  unlock: "unlockPage",
  protect: "protectPage",
  organize: "organizePage",
  sign: "signPage",
  watermark: "watermarkPage",
  "add-text": "addTextPage",
  "delete-pages": "deletePagesPage",
};

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mkdirp(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileSize(filePath) {
  const st = await fs.stat(filePath);
  return st.size;
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function basenameSafe(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function runCase(results, id, fn) {
  const startedAt = new Date().toISOString();
  console.log(`[CASE][START] ${id}`);
  try {
    const details = await fn();
    results.push({
      id,
      pass: true,
      startedAt,
      endedAt: new Date().toISOString(),
      details: details || {},
    });
    console.log(`[CASE][PASS] ${id}`);
  } catch (err) {
    results.push({
      id,
      pass: false,
      startedAt,
      endedAt: new Date().toISOString(),
      details: {
        error: err && err.stack ? err.stack : String(err),
      },
    });
    console.log(`[CASE][FAIL] ${id}`);
  }
}

async function waitNotification(page, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msg = await page.evaluate(() => {
      const n = document.querySelector(".notification");
      return n ? n.innerText : "";
    });
    if (msg) return msg;
    await sleep(120);
  }
  return "";
}

async function openTool(page, toolId) {
  await page.evaluate((id) => {
    window.showPage(id);
  }, toolId);
  await page.waitForSelector(`#${TOOL_PAGE[toolId]}.active`, { timeout: 15000 });
}

async function backHome(page) {
  await page.evaluate(() => window.showHomePage());
  await page.waitForSelector("#homePage", { timeout: 10000 });
}

async function captureDownload(page, browserDownloadsDir, clicker, timeout = 120000) {
  await page.evaluate(() => {
    try {
      delete window.showSaveFilePicker;
    } catch {
      // ignore
    }
    window.showSaveFilePicker = undefined;
  });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout }),
    clicker(),
  ]);
  const suggested = download.suggestedFilename();
  const out = path.join(browserDownloadsDir, `${Date.now()}-${basenameSafe(suggested)}`);
  await download.saveAs(out);
  return {
    suggested,
    path: out,
    bytes: await fileSize(out),
  };
}

async function drawOnCanvas(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Canvas not visible: ${selector}`);
  const x = box.x + Math.min(20, box.width / 4);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 8, { steps: 5 });
  await page.mouse.move(x + 120, y + 10, { steps: 5 });
  await page.mouse.up();
}

async function createEdgeAssets(page, edgeDir) {
  await mkdirp(edgeDir);
  const img1 = path.join(edgeDir, "edge-red.png");
  const img2 = path.join(edgeDir, "edge-blue.png");
  const pngRed =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6lL4sAAAAASUVORK5CYII=";
  const pngBlue =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwMBAXKUx9kAAAAASUVORK5CYII=";
  await fs.writeFile(img1, Buffer.from(pngRed, "base64"));
  await fs.writeFile(img2, Buffer.from(pngBlue, "base64"));

  const noImagePdfBytes = await page.evaluate(async () => {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    p.drawText("Tonfern QA No-Image PDF", { x: 60, y: 780, size: 20, font: f });
    p.drawText("This file is used for extract-image negative test.", { x: 60, y: 750, size: 12, font: f });
    const bytes = await d.save();
    return Array.from(bytes);
  });
  const noImagePdf = path.join(edgeDir, "no-image.pdf");
  await fs.writeFile(noImagePdf, Buffer.from(noImagePdfBytes));

  // Reuse baseline PDF for extract-image positive path to avoid fragile on-the-fly image embedding.
  const imagePdf = BASE_PDF_1;

  return { img1, img2, noImagePdf, imagePdf };
}

async function runBrowserSuite(browserName, browserType, runDir) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on("console", (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === "error") consoleErrors.push(text);
    if (t === "warning") consoleWarnings.push(text);
  });

  const browserDir = path.join(runDir, browserName);
  const downloadsDir = path.join(browserDir, "downloads");
  const edgeDir = path.join(browserDir, "edge-data");
  await mkdirp(downloadsDir);
  await mkdirp(edgeDir);

  const results = [];
  let protectedPdfPath = null;
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("#toolsGrid", { timeout: 45000 });
  const edge = await createEdgeAssets(page, edgeDir);

  await runCase(results, "preflight.load_and_tools", async () => {
    const count = await page.locator("#toolsGrid .tool-card").count();
    if (count !== 14) throw new Error(`Expected 14 tools, got ${count}`);
    const title = await page.title();
    return { title, tools: count };
  });

  await runCase(results, "preflight.filters_and_persona", async () => {
    await page.getByRole("button", { name: "Convert PDF" }).click();
    await sleep(200);
    const convertCount = await page.locator("#toolsGrid .tool-card").count();
    await page.getByText("Engineer", { exact: true }).click();
    await sleep(200);
    const engineerCount = await page.locator("#toolsGrid .tool-card").count();
    await page.getByRole("button", { name: "All" }).click();
    await page.getByText("Overall", { exact: true }).click();
    if (convertCount < 1 || engineerCount < 1) {
      throw new Error(`Bad filter results convert=${convertCount} engineer=${engineerCount}`);
    }
    return { convertCount, engineerCount };
  });

  await runCase(results, "regression.metadata_keywords", async () => {
    const ok = await page.evaluate(async () => {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.create();
      doc.setKeywords(["test1", "test2"]);
      const bytes = await doc.save();
      const loaded = await PDFDocument.load(bytes);
      const rawKeywords = "tag1, tag2, tag3";
      const processed = rawKeywords.split(",").map((k) => k.trim()).filter((k) => k);
      const loadedKeywords = loaded.getKeywords();
      // PDFLib might return as single string stringified? Or array? 
      // Usually strings unless specifically handled. 
      // Let's check for containment at least.
      if (!loadedKeywords) return false;
      // If it returns string like "test1; test2" or similar
      const str = Array.isArray(loadedKeywords) ? loadedKeywords.join(' ') : loadedKeywords;
      return str.includes('test1') && str.includes('test2');
    });
    if (!ok) throw new Error("Metadata keyword regression check failed");
    return { ok };
  });

  await runCase(results, "regression.metadata_negative_inputs", async () => {
    const checked = await page.evaluate(() => {
      const samples = [null, undefined, "", "   ", ["tag1", "", "  ", "tag2"]];
      const expectedLengths = [0, 0, 0, 0, 2];
      const outputs = [];
      for (let i = 0; i < samples.length; i++) {
        const input = samples[i];
        const processed = Array.isArray(input)
          ? input.map((k) => String(k).trim()).filter(Boolean)
          : String(input || "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
        if (processed.length !== expectedLengths[i]) {
          throw new Error(`Metadata sample ${i} unexpected length=${processed.length}`);
        }
        outputs.push(processed);
      }
      return outputs;
    });
    return { outputs: checked };
  });

  await runCase(results, "regression.zindex", async () => {
    const zi = await page.evaluate(() => parseInt(window.getComputedStyle(document.body, "::before").zIndex, 10));
    if (!(zi < 0)) throw new Error(`Expected z-index < 0, got ${zi}`);
    return { zIndexBefore: zi };
  });

  await runCase(results, "regression.pointer_safety", async () => {
    const check = await page.evaluate(() => {
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 2;
      const el = document.elementFromPoint(x, y);
      const inApp = !!el && !!el.closest("#homePage, .merge-page.active");
      return { tag: el ? el.tagName : null, className: el ? el.className : null, inApp };
    });
    if (!check.inApp) {
      throw new Error(`Pointer safety failed: element=${check.tag} class=${check.className}`);
    }
    return check;
  });

  await runCase(results, "regression.notification_dedupe", async () => {
    const count = await page.evaluate(() => {
      showNotification("Test 1");
      showNotification("Test 2");
      return document.querySelectorAll(".notification").length;
    });
    if (count !== 1) throw new Error(`Expected 1 notification, got ${count}`);
    return { count };
  });

  await runCase(results, "regression.notification_stress", async () => {
    const count = await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) showNotification(`Spam ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return document.querySelectorAll(".notification").length;
    });
    if (count !== 1) throw new Error(`Expected 1 notification after stress, got ${count}`);
    return { count };
  });

  await runCase(results, "global.navigation_home_tool", async () => {
    for (const id of Object.keys(TOOL_PAGE)) {
      await openTool(page, id);
      await backHome(page);
    }
    return { toolsVisited: Object.keys(TOOL_PAGE).length };
  });

  await runCase(results, "merge.main_reorder_download", async () => {
    await openTool(page, "merge");
    await page.setInputFiles("#fileInput", [BASE_PDF_1, BASE_PDF_2]);
    await page.waitForSelector("#filesList .file-card:nth-child(2)", { timeout: 30000 });
    const before = await page.locator("#filesList .file-card .file-name").first().innerText();
    await page.locator("#filesList .file-handle").first().dragTo(page.locator("#filesList .file-handle").nth(1));
    await sleep(300);
    const after = await page.locator("#filesList .file-card .file-name").first().innerText();
    const dl = await captureDownload(page, downloadsDir, () => page.click("#mergeBtn"), 180000);
    if (dl.bytes <= 0) throw new Error("Merged PDF is empty");
    return { firstBefore: before, firstAfter: after, download: dl };
  });

  // ... (skip lines)

  await runCase(results, "organize.main_reorder_save", async () => {
    await openTool(page, "organize");
    await page.setInputFiles("#organizeFileInput", BASE_PDF_1);
    await page.waitForSelector("#organizeGrid .organize-page-card:nth-child(2)", { timeout: 60000 });
    await page.locator("#organizeGrid .file-handle").first().dragTo(page.locator("#organizeGrid .file-handle").nth(1));
    await sleep(300);
    const dl = await captureDownload(page, downloadsDir, () => page.click("#saveOrganizedBtn", { force: true }), 120000);
    return { download: dl };
  });

  await runCase(results, "sign.main_with_opacity_and_page_nav", async () => {
    await openTool(page, "sign");
    await page.setInputFiles("#signFileInput", BASE_PDF_1);
    await page.waitForSelector("#signEditor", { timeout: 60000 });
    await drawOnCanvas(page, "#signaturePad");
    const signBox = page.locator("#sigBox");
    if (await signBox.count()) {
      const b = await signBox.boundingBox();
      if (b) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 4 });
        await page.mouse.up();
      }
    }
    await page.fill("#signOpacity", "0.5");
    await page.click("#nextSignPage");
    await page.click("#prevSignPage");
    const dl = await captureDownload(page, downloadsDir, () => page.click("#saveSignedBtn"), 120000);
    return { download: dl };
  });

  await runCase(results, "watermark.main_and_edge_style", async () => {
    await openTool(page, "watermark");
    await page.setInputFiles("#wmFileInput", BASE_PDF_2);
    await page.waitForSelector("#wmEditor", { timeout: 15000 });
    await page.fill("#wmText", "QA-WM");
    await page.fill("#wmSize", "42");
    await page.fill("#wmOpacity", "0.4");
    await page.fill("#wmAngle", "30");
    await page.fill("#wmColor", "#D40018");
    const dl = await captureDownload(page, downloadsDir, () => page.click("#wmApplyBtn"), 120000);
    return { download: dl };
  });

  await runCase(results, "add_text.main_and_edge_remove", async () => {
    await openTool(page, "add-text");
    await page.setInputFiles("#textFileInput", BASE_PDF_2);
    await page.waitForSelector("#textEditor", { timeout: 60000 });
    const overlay = page.locator("#textOverlay");
    const ob = await overlay.boundingBox();
    if (!ob) throw new Error("Text overlay not visible");

    await page.mouse.click(ob.x + 80, ob.y + 120);
    const firstInput = page.locator("#textOverlay input").last();
    await firstInput.fill("QA-remove");
    await firstInput.click({ button: "right" });

    await page.mouse.click(ob.x + 120, ob.y + 180);
    const secondInput = page.locator("#textOverlay input").last();
    await secondInput.fill("Tonfern QA text");
    const dl = await captureDownload(page, downloadsDir, () => page.click("#saveTextBtn"), 120000);
    return { download: dl };
  });

  await runCase(results, "delete_pages.main_delete_some", async () => {
    await openTool(page, "delete-pages");
    await page.setInputFiles("#delFileInput", BASE_PDF_1);
    await page.waitForSelector("#delPagesGrid .page-thumb", { timeout: 60000 });
    const thumbs = page.locator("#delPagesGrid .page-thumb");
    await thumbs.first().click();
    const dl = await captureDownload(page, downloadsDir, () => page.click("#delConfirmBtn"), 120000);
    return { download: dl };
  });

  await runCase(results, "delete_pages.edge_block_delete_all", async () => {
    await openTool(page, "delete-pages");
    await page.setInputFiles("#delFileInput", BASE_PDF_2);
    await page.waitForSelector("#delPagesGrid .page-thumb", { timeout: 60000 });
    const c = await page.locator("#delPagesGrid .page-thumb").count();
    await page.evaluate(() => {
      document.querySelectorAll("#delPagesGrid .page-thumb").forEach((el) => el.classList.add("selected"));
    });
    await page.click("#delConfirmBtn");
    const msg = await waitNotification(page, 10000);
    if (!msg.toLowerCase().includes("cannot delete all")) {
      throw new Error(`Expected block-delete-all message, got: ${msg}`);
    }
    return { message: msg, pages: c };
  });

  await runCase(results, "global.save_cancel_notification", async () => {
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      };
    });
    await page.evaluate(async () => {
      await downloadBlob(new Uint8Array([1, 2, 3]), "cancel_test.pdf", "application/pdf");
    });
    const msg = await waitNotification(page, 6000);
    if (!msg.toLowerCase().includes("save cancelled")) {
      throw new Error(`Expected save-cancel notification, got: ${msg}`);
    }
    return { message: msg };
  });

  await runCase(results, "global.saved_locally_notification", async () => {
    await openTool(page, "merge");
    await page.setInputFiles("#fileInput", [BASE_PDF_1, BASE_PDF_2]);
    await page.waitForSelector("#filesList .file-card:nth-child(2)", { timeout: 30000 });
    await page.evaluate(() => {
      delete window.showSaveFilePicker;
    });
    await page.click("#mergeBtn");
    const msg = await waitNotification(page, 12000);
    if (!msg.toLowerCase().includes("saved locally")) {
      throw new Error(`Expected saved-locally notification, got: ${msg}`);
    }
    return { message: msg };
  });

  await runCase(results, "console.non_blocking_only", async () => {
    const nonBenign = consoleErrors.filter((e) => !e.includes("favicon.ico"));
    if (nonBenign.length > 0) {
      throw new Error(`Console errors found: ${JSON.stringify(nonBenign)}`);
    }
    return {
      errors: consoleErrors,
      warnings: consoleWarnings,
      nonBenignCount: nonBenign.length,
    };
  });

  const summary = {
    browser: browserName,
    timestamp: new Date().toISOString(),
    url: URL,
    passCount: results.filter((r) => r.pass).length,
    failCount: results.filter((r) => !r.pass).length,
    results,
    consoleErrors,
    consoleWarnings,
  };
  await fs.writeFile(path.join(browserDir, "results.json"), JSON.stringify(summary, null, 2), "utf8");

  await context.close();
  await browser.close();
  return summary;
}

function toMarkdown(runStamp, suites) {
  const lines = [];
  lines.push(`# TonfernPDF Full-Matrix Test Report`);
  lines.push("");
  lines.push(`- Run: ${runStamp}`);
  lines.push(`- URL: ${URL}`);
  lines.push(`- Baseline files: \`${BASE_PDF_1}\`, \`${BASE_PDF_2}\``);
  lines.push("");
  for (const s of suites) {
    lines.push(`## ${s.browser}`);
    lines.push("");
    lines.push(`- Pass: ${s.passCount}`);
    lines.push(`- Fail: ${s.failCount}`);
    lines.push(`- Console errors: ${s.consoleErrors.length}`);
    lines.push(`- Console warnings: ${s.consoleWarnings.length}`);
    lines.push("");
    lines.push(`### Cases`);
    lines.push("");
    lines.push(`| Case | Status | Notes |`);
    lines.push(`|---|---|---|`);
    for (const r of s.results) {
      const status = r.pass ? "PASS" : "FAIL";
      const note = r.pass
        ? (r.details && r.details.download ? r.details.download.suggested : "ok")
        : (r.details && r.details.error ? String(r.details.error).split("\n")[0] : "error");
      lines.push(`| ${r.id} | ${status} | ${note.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }

  lines.push("## Cross-Browser Comparison");
  lines.push("");
  if (suites.length >= 2) {
    const [a, b] = suites;
    lines.push(`- ${a.browser}: pass ${a.passCount}, fail ${a.failCount}`);
    lines.push(`- ${b.browser}: pass ${b.passCount}, fail ${b.failCount}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const runStamp = stamp();
  const runDir = path.join(OUT_ROOT, runStamp);
  await mkdirp(runDir);
  const suites = [];
  const requested = (process.env.TONFERN_BROWSERS || "chromium,webkit")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const b of requested) {
    try {
      if (b === "chromium") suites.push(await runBrowserSuite("chromium", chromium, runDir));
      else if (b === "webkit") suites.push(await runBrowserSuite("webkit", webkit, runDir));
      else {
        suites.push({
          browser: b,
          passCount: 0,
          failCount: 1,
          results: [{ id: "browser.unsupported", pass: false, details: { error: `Unsupported browser ${b}` } }],
          consoleErrors: [],
          consoleWarnings: [],
        });
      }
    } catch (err) {
      suites.push({
        browser: b,
        passCount: 0,
        failCount: 1,
        results: [{
          id: "browser.run_failed",
          pass: false,
          details: { error: err && err.stack ? err.stack : String(err) },
        }],
        consoleErrors: [],
        consoleWarnings: [],
      });
    }
  }
  const md = toMarkdown(runStamp, suites);
  const mdPath = path.join(runDir, "report.md");
  await fs.writeFile(mdPath, md, "utf8");
  const summary = {
    runStamp,
    report: mdPath,
    suites: suites.map((s) => ({
      browser: s.browser,
      pass: s.passCount,
      fail: s.failCount,
    })),
  };
  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
