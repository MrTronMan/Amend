// Node 20 has global fetch. CommonJS to avoid ESM warnings.
const { Octokit } = require("@octokit/rest");

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

// Markers to identify bot comments
const CHECKLIST_MARKER = "<!-- amend-bot-checklist -->";
const STATUS_MARKER    = "<!-- amend-bot-status -->";

// ===== Helpers =====
function normalizeCandidates(version) {
  return version.endsWith(".0") ? [version, version.replace(/\.0$/, "")] : [version];
}
function versionFromTitle(title) {
  const m = title && title.match(/\b(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}
function versionFromComment(cmd) {
  const m = cmd && cmd.match(/\/track\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}
async function getIssue(issueNumber) {
  return octokit.issues.get({ owner, repo, issue_number: issueNumber });
}
async function setIssueBody(issueNumber, body) {
  return octokit.issues.update({ owner, repo, issue_number: issueNumber, body });
}
async function listComments(issueNumber) {
  const { data } = await octokit.issues.listComments({
    owner, repo, issue_number: issueNumber, per_page: 100,
  });
  return data;
}
async function upsertComment(issueNumber, marker, body) {
  const comments = await listComments(issueNumber);
  const existing = comments.find(c => c.body && c.body.includes(marker));
  if (existing) {
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { id: existing.id, created: false };
  } else {
    const { data } = await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    return { id: data.id, created: true };
  }
}

async function fetchPaperHas(version) {
  const res = await fetch("https://api.papermc.io/v2/projects/paper");
  if (!res.ok) throw new Error(`Paper API HTTP ${res.status}`);
  const data = await res.json();
  return normalizeCandidates(version).some(v => data.versions.includes(v));
}
async function fetchPurpurHas(version) {
  const res = await fetch("https://api.purpurmc.org/v2/purpur");
  if (!res.ok) throw new Error(`Purpur API HTTP ${res.status}`);
  const data = await res.json();
  return normalizeCandidates(version).some(v => data.versions.includes(v));
}

function derivePrevPatch(version) {
  const parts = version.split(".");
  if (parts.length === 3) {
    const n = parseInt(parts[2], 10);
    return `${parts[0]}.${parts[1]}.${Math.max(0, n - 1)}`;
  }
  return version;
}

// Initial template used ONLY when the checklist comment is first created
function buildChecklistTemplate(version, { paperReady, purpurReady }) {
  const ts = new Date().toISOString();
  return `${CHECKLIST_MARKER}
# ${version}
This will help keep track for you of Amend's ${version} release.

- [ ] Waiting on Spigot to release buid
- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)
- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)
- [ ] Build Amend
- [ ] Build into API ${derivePrevPatch(version)}
- [ ] Test Amend and Verify
- [ ] Add Version to Website and other third party plugin distributors

_Last updated: ${ts}_
`;
}


//time function
const dayjs = require("dayjs");
const tz = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(tz);

function formatTimestamp() {
  return dayjs().tz("America/New_York").format("YYYY-MM-DD HH:mm EST");
}

// Patch ONLY the two auto lines + timestamp; leave everything else as-is
function patchChecklist(existingBody, version, { paperReady, purpurReady }) {
  const NL = "\n";
  let body = existingBody || "";

  // Ensure marker exists; if not, treat as creation
  if (!body.includes(CHECKLIST_MARKER)) {
    return buildChecklistTemplate(version, { paperReady, purpurReady });
  }

  // Replace Paper line (case-insensitive, tolerant of CRLF)
  const paperPattern = /- \[[ xX]\]\s*Waiting on Paper.*(\r?\n)/i;
  const paperLine    = `- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)${NL}`;
  if (paperPattern.test(body)) {
    body = body.replace(paperPattern, paperLine);
  } else {
    // If missing (user removed), append near top after header
    const headerMatch = body.match(/^# .*(\r?\n)/m);
    const idx = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
    body = body.slice(0, idx) + paperLine + body.slice(idx);
  }

  // Replace Purpur line
  const purpurPattern = /- \[[ xX]\]\s*Waiting on Purpur.*(\r?\n)/i;
  const purpurLine    = `- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)${NL}`;
  if (purpurPattern.test(body)) {
    body = body.replace(purpurPattern, purpurLine);
  } else {
    const headerMatch2 = body.match(/^# .*(\r?\n)/m);
    const idx2 = headerMatch2 ? headerMatch2.index + headerMatch2[0].length : 0;
    body = body.slice(0, idx2) + purpurLine + body.slice(idx2);
  }

  // Refresh timestamp (if present), or append it at the end
  const tsLine = `_Last updated: ${formatTimestamp()}_`;


  if (/_Last updated: .*_/i.test(body)) {
    body = body.replace(/_Last updated: .*_/i, tsLine);
  } else {
    body = body.trimEnd() + NL + NL + tsLine + NL;
  }

  return body;
}

// Status comment content (rewritten each run — it's bot-only)
function buildStatus(version, { paperReady, purpurReady }) {
  const ts = `_Last updated: ${formatTimestamp()}_`;

  return `${STATUS_MARKER}
### 📝 Amend Paper/Purpur Status (AUTO)

- ${paperReady ? "✅" : "❌"} Paper: ${version}
- ${purpurReady ? "✅" : "❌"} Purpur: ${version}

_${ts}_
`;
}

async function resolveIssueNumber() {
  if (issueNumberEnv) return parseInt(issueNumberEnv, 10);
  // Fallback: last updated open issue with label update-tracker
  const { data: issues } = await octokit.issues.listForRepo({
    owner, repo, labels: "update-tracker", state: "open", per_page: 1,
    sort: "updated", direction: "desc",
  });
  if (issues.length) return issues[0].number;
  throw new Error("No ISSUE_NUMBER provided and no open 'update-tracker' issues found.");
}

// ===== Main =====
(async () => {
  const issueNumber = await resolveIssueNumber();
  const issue = await getIssue(issueNumber);

  // Resolve version: /track <ver> -> title token -> (optional) heading from original body
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    ((issue.data.body || "").match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1]) ||
    null;

  if (!version) {
    console.log("No version found. Use issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // Refresh Paper/Purpur
  const [paperReady, purpurReady] = await Promise.all([
    fetchPaperHas(version),
    fetchPurpurHas(version),
  ]);

  // Blank the issue body to a single space (only once)
  const currentBody = issue.data.body ?? "";
  if (currentBody.trim() !== "") {
    await setIssueBody(issueNumber, " ");
  }

  // Upsert checklist comment: create from template if missing; otherwise PATCH it
  const comments = await listComments(issueNumber);
  const existingChecklist = comments.find(c => c.body && c.body.includes(CHECKLIST_MARKER));
  let checklistBody;

  if (existingChecklist) {
    checklistBody = patchChecklist(existingChecklist.body, version, { paperReady, purpurReady });
    if (checklistBody !== existingChecklist.body) {
      await octokit.issues.updateComment({ owner, repo, comment_id: existingChecklist.id, body: checklistBody });
    }
  } else {
    checklistBody = buildChecklistTemplate(version, { paperReady, purpurReady });
    await upsertComment(issueNumber, CHECKLIST_MARKER, checklistBody);
  }

  // Upsert separate status comment (always rebuilt)
  const statusBody = buildStatus(version, { paperReady, purpurReady });
  await upsertComment(issueNumber, STATUS_MARKER, statusBody);

  // Check if all checklist items are done
  const allDone = /\- \[ \]/.test(checklistBody) === false; // no unchecked boxes remain
  
  if (allDone) {
  const comments = await listComments(issueNumber);
  const alreadyPosted = comments.some(
    c => c.body && c.body.includes("🎉 Amend")
  );

  if (!alreadyPosted) {
    await octokit.issues.createComment({
      owner, repo,
      issue_number: issueNumber,
      body: `### 📝 Amend Paper/Purpur Build Status (AUTO)\n\n` +
            `# 🎉 Amend ${version} has been released! Download @ [amend.mrtron.dev](https://amend.mrtron.dev/download)!`
    });
  }
}

  console.log("Done.");
})().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
