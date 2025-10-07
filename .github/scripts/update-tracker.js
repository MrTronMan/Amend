import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

// --- Helpers ---
function normalizeCandidates(version) {
  // Try both 1.21.0 and 1.21 when it ends with ".0"
  return version.endsWith(".0") ? [version, version.replace(/\.0$/, "")] : [version];
}
function versionFromTitle(title) {
  // grabs the first x.y or x.y.z in the title
  const m = title.match(/\b(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}
function versionFromComment(cmd) {
  // supports "/track 1.21.10"
  const m = cmd.match(/\/track\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}
function getChecklistCompletion(body) {
  // true if NO unchecked boxes remain
  return !/- \[ \]/.test(body);
}

async function getIssue(issueNumber) {
  return octokit.issues.get({ owner, repo, issue_number: issueNumber });
}
async function setIssueBody(issueNumber, body) {
  return octokit.issues.update({ owner, repo, issue_number: issueNumber, body });
}
async function listComments(issueNumber) {
  const { data } = await octokit.issues.listComments({ owner, repo, issue_number: issueNumber, per_page: 100 });
  return data;
}
async function updateOrCreateBotComment(issueNumber, newBody, marker) {
  const comments = await listComments(issueNumber);
  const existing = comments.find(c => c.body && c.body.includes(marker));
  if (existing) {
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: newBody });
    return "updated";
  } else {
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: newBody });
    return "created";
  }
}

async function postFinalReleaseComment(issueNumber) {
  const finalComment = `### 📝 Amend Paper/Purpur Build Status (AUTO)

# ✅ Amend has been released you can download @ [amend.mrtron.dev](https://amend.mrtron.dev/download)!`;
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: finalComment });
}

async function fetchPaperHas(version) {
  const res = await fetch("https://api.papermc.io/v2/projects/paper");
  const data = await res.json();
  const cands = normalizeCandidates(version);
  return cands.some(v => data.versions.includes(v));
}

async function fetchPurpurHas(version) {
  const res = await fetch("https://api.purpurmc.org/v2/purpur");
  const data = await res.json();
  const cands = normalizeCandidates(version);
  return cands.some(v => data.versions.includes(v));
}

// Toggle only the Paper & Purpur lines; preserve everything else
function togglePaperPurpur(body, version, paperReady, purpurReady) {
  // standardize target lines by their leading text so we only affect those
  const paperPattern = /- \[[ x]\]\s*Waiting on Paper.*\n/;
  const purpurPattern = /- \[[ x]\]\s*Waiting on Purpur.*\n/;

  const paperLine = `- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)\n`;
  const purpurLine = `- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)\n`;

  let updated = body;

  // If the lines exist, replace them; if not, append them under the title.
  if (paperPattern.test(updated)) updated = updated.replace(paperPattern, paperLine);
  else updated = updated.replace(/(#.*\n[^\S\n]*\n?)/, `$1${paperLine}`);

  if (purpurPattern.test(updated)) updated = updated.replace(purpurPattern, purpurLine);
  else updated = updated.replace(/(#.*\n[^\S\n]*\n?)/, `$1${purpurLine}`);

  return updated;
}

async function resolveIssueNumber() {
  if (issueNumberEnv) return parseInt(issueNumberEnv, 10);
  // If manually scheduled run and no input given, try last updated open issue with label "update-tracker"
  const { data: issues } = await octokit.issues.listForRepo({
    owner,
    repo,
    labels: "update-tracker",
    state: "open",
    per_page: 1,
    sort: "updated",
    direction: "desc",
  });
  if (issues.length) return issues[0].number;
  throw new Error("No ISSUE_NUMBER provided and no open 'update-tracker' issues found.");
}

(async () => {
  const issueNumber = await resolveIssueNumber();
  const issue = await getIssue(issueNumber);

  // Figure out the target version:
  // 1) from /track <ver> comment
  // 2) from issue title token like "1.21.10"
  // 3) fallback: a heading "# 1.21.10" or "## 1.21.10" in body
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    (issue.data.body.match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1]) ||
    null;

  if (!version) {
    console.log("No version found. Use an issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // Check Paper/Purpur availability
  const [paperReady, purpurReady] = await Promise.all([
    fetchPaperHas(version),
    fetchPurpurHas(version),
  ]);

  // Update the issue body ONLY for Paper & Purpur lines
  const updatedBody = togglePaperPurpur(issue.data.body, version, paperReady, purpurReady);
  if (updatedBody !== issue.data.body) {
    await setIssueBody(issueNumber, updatedBody);
  }

  // Maintain a single status comment
  const marker = "<!-- amend-bot-status -->";
  const statusBody = `${marker}
### 📝 Amend Paper/Purpur Build Status (AUTO)

- ${paperReady ? "✅" : "❌"} Paper: ${version}
- ${purpurReady ? "✅" : "❌"} Purpur: ${version}

_Last checked: ${new Date().toISOString()}_
`;
  await updateOrCreateBotComment(issueNumber, statusBody, marker);

  // If ALL tasks in the issue are checked, post the final release comment once
  const finalDone = getChecklistCompletion(updatedBody);
  if (finalDone) {
    // avoid duplicating the final release comment—only post if we haven't already
    const comments = await listComments(issueNumber);
    const alreadyPosted = comments.some(c => /Amend has been released/i.test(c.body || ""));
    if (!alreadyPosted) await postFinalReleaseComment(issueNumber);
  }

  console.log("Done.");
})().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
