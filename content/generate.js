#!/usr/bin/env node
/**
 * generate.js: Local Traffic AI content visual generator
 *
 * Reuses the "Artisan agent" pattern: a JSON queue drives the work, each item
 * is submitted to Higgsfield, jobs are polled until done, and finished assets
 * are pulled down to disk. Same shape as the Gasparilla generation queue, but
 * for square Instagram stills instead of cinematic video.
 *
 * Two ways to run it, pick based on how you generate:
 *
 *   1. AGENT MODE (default, no API key needed)
 *      Emits content/assets/manifest.json: a clean, ordered job list that
 *      Claude (this agent) consumes through the Higgsfield MCP tools
 *      (generate_image with nano_banana_2 / soul, then job_status, then
 *      reveal_generation to grab the URL). This is the "unlimited models on
 *      the plan" path. Run this, then tell the agent: "generate the assets
 *      from content/assets/manifest.json."
 *
 *   2. REST MODE (set HIGGSFIELD_API_KEY)
 *      Submits each job to the Higgsfield REST API directly, polls until the
 *      image is ready, and downloads it into content/assets/. Fully headless,
 *      good for cron. Mirrors the higgsfieldClient pattern from agent-nexus.
 *
 * Usage:
 *   node generate.js                  # build manifest for agent mode
 *   node generate.js --rest           # submit + poll + download via REST
 *   node generate.js --only 1,4,6     # restrict to specific post ids
 *   node generate.js --force          # regenerate even if asset exists
 *
 * Env (REST mode only):
 *   HIGGSFIELD_API_KEY        required for --rest
 *   HIGGSFIELD_API_BASE_URL   optional override, default https://platform.higgsfield.ai/v1
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const CALENDAR_PATH = path.join(ROOT, "calendar.json");
const ASSETS_DIR = path.join(ROOT, "assets");
const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

const BASE_URL = (process.env.HIGGSFIELD_API_BASE_URL || "https://platform.higgsfield.ai/v1").replace(/\/$/, "");
const API_KEY = process.env.HIGGSFIELD_API_KEY;

// Instagram feed stills are square. Models per the plan + the saved default:
// nano_banana_2 for all stills, soul reserved for the cinematic hero/proof frames.
const ASPECT_RATIO = "1:1";
const VALID_MODELS = new Set(["nano_banana_2", "soul"]);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const useRest = args.includes("--rest");
const force = args.includes("--force");

let onlyIds = null;
const onlyFlag = args.indexOf("--only");
if (onlyFlag !== -1 && args[onlyFlag + 1]) {
  onlyIds = new Set(args[onlyFlag + 1].split(",").map((s) => parseInt(s.trim(), 10)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCalendar() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    fail(`calendar.json not found at ${CALENDAR_PATH}`);
  }
  const cal = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
  if (!Array.isArray(cal.posts) || cal.posts.length === 0) {
    fail("calendar.json has no posts array.");
  }
  return cal;
}

function assetFileName(post) {
  // e.g. 2026-06-08_post-01_education.png
  const id = String(post.id).padStart(2, "0");
  return `${post.date}_post-${id}_${post.pillar}.png`;
}

function selectPosts(cal) {
  let posts = cal.posts;
  if (onlyIds) posts = posts.filter((p) => onlyIds.has(p.id));
  return posts.map((p) => {
    const model = VALID_MODELS.has(p.model) ? p.model : "nano_banana_2";
    return {
      id: p.id,
      date: p.date,
      pillar: p.pillar,
      model,
      aspect_ratio: ASPECT_RATIO,
      prompt: p.visual_prompt,
      file: assetFileName(p),
      path: path.join(ASSETS_DIR, assetFileName(p)),
    };
  });
}

function ensureAssetsDir() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Agent mode: write the manifest the MCP-driven agent consumes
// ---------------------------------------------------------------------------

function runAgentMode(jobs) {
  ensureAssetsDir();

  const pending = force ? jobs : jobs.filter((j) => !fs.existsSync(j.path));
  const skipped = jobs.length - pending.length;

  const manifest = {
    generated_for: "Higgsfield MCP (agent mode)",
    aspect_ratio: ASPECT_RATIO,
    instructions:
      "For each job: call generate_image with the given model + prompt + aspect_ratio. " +
      "Poll job_status until completed, then reveal_generation to get the URL and save " +
      "the file to content/assets/ using the exact 'file' name below.",
    count: pending.length,
    jobs: pending.map((j) => ({
      id: j.id,
      file: j.file,
      model: j.model,
      aspect_ratio: j.aspect_ratio,
      prompt: j.prompt,
    })),
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\n  Local Traffic AI, content manifest built (agent mode)\n`);
  console.log(`  Jobs to generate : ${pending.length}`);
  if (skipped) console.log(`  Already on disk   : ${skipped} (use --force to redo)`);
  console.log(`  Manifest         : ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  console.log(`\n  Next step:`);
  console.log(`  Tell the agent: "Generate the assets from content/assets/manifest.json`);
  console.log(`  using the Higgsfield MCP, save each to content/assets/."`);
  console.log(`\n  Or run headless: HIGGSFIELD_API_KEY=... node generate.js --rest\n`);
}

// ---------------------------------------------------------------------------
// REST mode: submit, poll, download (mirrors the higgsfieldClient pattern)
// ---------------------------------------------------------------------------

async function hfCall(pathname, init = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "LocalTrafficAI-Social/1.0",
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    fail(`Higgsfield rejected the API key (${res.status}). Check HIGGSFIELD_API_KEY.`);
  }
  if (res.status === 404) {
    fail(
      `Higgsfield 404 at ${BASE_URL}${pathname}. The default API base may be wrong for ` +
        `your account. Set HIGGSFIELD_API_BASE_URL to the value from your dashboard.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield ${res.status} on ${pathname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function submitJob(job) {
  // Endpoint/field names follow the documented generation shape; override the
  // base URL via env if your account exposes a different path.
  const body = {
    model: job.model,
    prompt: job.prompt,
    aspect_ratio: job.aspect_ratio,
    count: 1,
  };
  const out = await hfCall("/image/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return out.id || out.job_id || out.generation_id;
}

async function pollJob(jobId, { tries = 60, intervalMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const status = await hfCall(`/image/generations/${jobId}`);
    const state = status.status || status.state;
    if (state === "completed" || state === "succeeded") {
      const url =
        status.image_url ||
        status.url ||
        (Array.isArray(status.results) && status.results[0] && status.results[0].url) ||
        (Array.isArray(status.medias) && status.medias[0] && status.medias[0].url);
      if (!url) throw new Error(`Job ${jobId} completed but no image URL in response.`);
      return url;
    }
    if (state === "failed" || state === "error") {
      throw new Error(`Job ${jobId} failed: ${status.error || "unknown error"}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Job ${jobId} timed out after ${(tries * intervalMs) / 1000}s.`);
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function runRestMode(jobs) {
  if (!API_KEY) fail("--rest needs HIGGSFIELD_API_KEY in the environment.");
  ensureAssetsDir();

  const pending = force ? jobs : jobs.filter((j) => !fs.existsSync(j.path));
  console.log(`\n  Local Traffic AI, generating ${pending.length} visuals via Higgsfield REST\n`);

  let done = 0;
  let failed = 0;
  for (const job of pending) {
    const label = `[${job.id}] ${job.file} (${job.model})`;
    try {
      process.stdout.write(`  → ${label} ... submitting`);
      const jobId = await submitJob(job);
      process.stdout.write(`\r  → ${label} ... polling   `);
      const url = await pollJob(jobId);
      process.stdout.write(`\r  → ${label} ... downloading`);
      await download(url, job.path);
      console.log(`\r  ✓ ${label}            `);
      done++;
    } catch (err) {
      console.log(`\r  ✗ ${label}, ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  Done. ${done} generated, ${failed} failed, into ${path.relative(process.cwd(), ASSETS_DIR)}/\n`);
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const cal = loadCalendar();
  const jobs = selectPosts(cal);
  if (jobs.length === 0) fail("No posts matched. Check your --only ids.");

  if (useRest) {
    await runRestMode(jobs);
  } else {
    runAgentMode(jobs);
  }
})().catch((err) => fail(err.stack || err.message));
