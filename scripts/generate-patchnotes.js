#!/usr/bin/env node
// Auto-generates a patch note entry and prepends it to frontend/src/patchNotes.js.
// Uses the locally installed `claude` CLI — no ANTHROPIC_API_KEY required.
//
// Modes:
//   node scripts/generate-patchnotes.js            — CI: diff HEAD~1..HEAD
//   node scripts/generate-patchnotes.js --staged   — pre-commit hook: diff of staged changes

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PATCH_NOTES_PATH = path.join(__dirname, "..", "frontend", "src", "patchNotes.js");
const STAGED_MODE = process.argv.includes("--staged");

function run(cmd) {
  const result = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return result.stdout || "";
}

function getDiff() {
  const base = STAGED_MODE ? "HEAD" : "HEAD~1";
  const result = spawnSync("git", [
    "diff", base,
    STAGED_MODE ? "--cached" : "HEAD",
    "--", ".", ":!frontend/src/patchNotes.js", ":!*.lock", ":!package-lock.json",
  ], { encoding: "utf8" });
  return (result.stdout || "").slice(0, 6000);
}

function getContext() {
  if (STAGED_MODE) return run("git rev-parse --abbrev-ref HEAD").trim();
  return run('git log --pretty=format:"%s%n%b" HEAD~1..HEAD');
}

function callClaude(prompt) {
  const os = require("os");
  const tmpFile = path.join(os.tmpdir(), `patchnotes-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, "utf8");

  const npmBin = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm");
  const claudePath = path.join(npmBin, "claude.cmd");
  const cmd = `"${claudePath}" < "${tmpFile}"`;

  const result = spawnSync(cmd, [], { encoding: "utf8", timeout: 60000, shell: true });
  try { fs.unlinkSync(tmpFile); } catch {}

  if (result.error) throw new Error(`claude CLI not found: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`claude exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

function parseCurrentNotes(content) {
  const idMatch = content.match(/id:\s*(\d+)/);
  const versionMatch = content.match(/version:\s*"v(\d+)\.(\d+)"/);
  return {
    currentId: idMatch ? parseInt(idMatch[1]) : 0,
    major: versionMatch ? parseInt(versionMatch[1]) : 1,
    minor: versionMatch ? parseInt(versionMatch[2]) : 0,
  };
}

function insertEntry(content, entry, newId, newVersion) {
  const today = new Date().toISOString().slice(0, 10);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const itemsStr = entry.items.map((item) => `      "${escape(item)}",`).join(eol);
  const block = [
    "  {",
    `    id: ${newId},`,
    `    version: "${newVersion}",`,
    `    date: "${today}",`,
    `    title: "${escape(entry.title)}",`,
    "    items: [",
    itemsStr,
    "    ],",
    "  },",
    "",
  ].join(eol);
  return content.replace(`export const PATCH_NOTES = [${eol}`, `export const PATCH_NOTES = [${eol}${block}`);
}

function main() {
  const diff = getDiff();
  const context = getContext();

  if (!diff) {
    console.log("[patchnotes] No relevant diff — skipping.");
    return;
  }

  const notesContent = fs.readFileSync(PATCH_NOTES_PATH, "utf8");
  const { currentId, major, minor } = parseCurrentNotes(notesContent);
  const styleContext = notesContent.slice(0, 700);

  const prompt = `You write patch notes for a sports pool web app called "Office Pooling Sports". Users predict FIFA World Cup match results, earn points, and compete in pools.

Existing patch notes (newest first — match this style exactly):
${styleContext}

${STAGED_MODE ? `Branch: ${context}` : `Commits:\n${context}`}

Git diff of the changes:
${diff}

Generate a new patch note entry. Respond with ONLY a valid JSON object — no markdown, no explanation:
{"title": "Short Title", "items": ["Change description 1", "Change description 2"]}

Rules:
- Write from the user's perspective ("You can now…", "Fixed…", "Added…", "Improved…")
- Only include changes that affect user experience
- Skip linting fixes, CI/CD, Docker, internal refactors with no visible effect
- If there are no user-visible changes, respond: {"skip": true}
- Maximum 5 items, one concise sentence each`;

  let raw;
  try {
    raw = callClaude(prompt);
    console.log("[patchnotes] Claude:", raw);
  } catch (e) {
    console.error("[patchnotes]", e.message);
    console.error("[patchnotes] Ensure `claude` is in your PATH. Skipping patch note.");
    return;
  }

  let entry;
  try {
    const cleaned = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    entry = JSON.parse(cleaned);
  } catch {
    console.error("[patchnotes] Could not parse response as JSON:", raw);
    return;
  }

  if (entry.skip) {
    console.log("[patchnotes] No user-visible changes — skipping.");
    return;
  }

  if (!entry.title || !Array.isArray(entry.items) || entry.items.length === 0) {
    console.error("[patchnotes] Invalid entry structure:", entry);
    return;
  }

  const newId = currentId + 1;
  const newVersion = `v${major}.${minor + 1}`;
  const updated = insertEntry(notesContent, entry, newId, newVersion);
  fs.writeFileSync(PATCH_NOTES_PATH, updated);

  if (STAGED_MODE) {
    spawnSync("git", ["add", "frontend/src/patchNotes.js"], { encoding: "utf8" });
  }

  console.log(`[patchnotes] Generated ${newVersion} (id: ${newId}): "${entry.title}"`);
}

main();
