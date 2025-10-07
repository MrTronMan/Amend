// Uses Node 20's global fetch (no node-fetch). ESM is fine without "type": "module" if you run as plain node.
// If you prefer ESM syntax, add "type": "module" to package.json and keep using import.
import { Octokit } from "@octokit/rest";

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

// ---------- Helpers ----------
function normalizeCandidates(version) {
  return version.endsWith(".0") ? [version, version.replace(/\.0$/, "")] : [version];
}
function versionFromTitle(title) {
  const m = title?.match(/\b(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}
function versionFromComment(cmd) {
  const m = cmd?.match(/\/track\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}
function allTasksChecked(body) {
  return !/- \[ \]/.test(body); // true if no unchecked boxes
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
  if (!res.ok) throw new Error(`Paper API HTTP ${res.status}`);
  const data = await res.json();
  const cands = normalizeCandidates(version);
  return cands.some(v => data.versions.includes(v));
}

async function fetchPurpurHas(version) {
  const res = await fetch("https://api.purpurmc.org/v2/purpur");
  if (!res.ok) throw new Error(`Purpur API HTTP ${res.status}`);
  const data = await res.json();
  const cands = normalizeCandidates(version);
  return cands.some(v => data.versions.includes(v));
}

// Toggle only the Paper & Purpur lines; preserve everything else
function togglePaperPurpur(bodyRaw, paperReady, purpurReady) {
  const NL = "\n";
  const body = bodyRaw ?? ""; // safe
  const paperPattern = /- \[[ x]\]\s*Waiting on Paper.*(\r?\n)/i;
  const purpurPattern = /- \[[ x]\]\s*Waiting on Purpur.*(\r?\n)/i;

  const paperLine = `- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)${NL}`;
  const purpurLine = `- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)${NL}`;

  let updated = body;

  // Replace if present (case-insensitive)
  if (paperPattern.test(updated)) {
    updated = updated.replace(paperPattern, paperLine);
  } else {
    // Insert after first heading if any, else append
    const headingMatch = updated.match(/^\s*#{1,6} .*(\r?\n)/m);
    if (headingMatch) {
      const idx = headingMatch.index + headingMatch[0].length;
      updated = updated.slice(0, idx) + paperLine + updated.slice(idx);
    } else {
      updated = (updated ? updated + NL : "") + paperLine;
    }
  }

  if (purpurPattern.test(updated)) {
    updated = updated.replace(purpurPattern, purpurLine);
  } else {
    const headingMatch2 = updated.match(/^\s*#{1,6} .*(\r?\n)/m);
    if (headingMatch2) {
      const idx = headingMatch2.index + headingMatch2[0].length;
      updated = updated.slice(0, idx) + purpurLine + updated.slice(idx);
    } else {
      updated = (updated ? updated + NL : "") + purpurLine;
    }
  }

  return updated;
}

async function resolveIssueNumber() {
  if (issueNumberEnv) return parseInt(issueNumberEnv, 10);
  // Fallback: most recently updated open issue with label update-tracker
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

  // Resolve version: comment (/track x.y.z) -> title -> (optional) heading in body
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    (issue.data.body ?? "").match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1] ||
    null;

  if (!version) {
    console.log("No version found. Use an issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // Check availability
  const [paperReady, purpurReady] = await Promise.all([
    fetchPaperHas(version),
    fetchPurpurHas(version),
  ]);

  // Update issue body ONLY for Paper & Purpur
  const originalBody = issue.data.body ?? "";
  const newBody = togglePaperPurpur(originalBody, paperReady, purpurReady);

  if (newBody !== originalBody) {
    await setIssueBody(issueNumber, newBody);
  }

  // Build a full checklist excerpt (mirror all tasks) from the updated body
  const checklistLines =
    (newBody.match(/^-\s\[[ xX]\]\s.*$/gm) || []).join("\n") ||
    "_(No checklist found in issue body)_";

  // Status comment (single, auto-updating) with full checklist mirrored
  const marker = "<!-- amend-bot-status -->";
  const statusBody = `${marker}
### 📝 Amend Build Status (auto-updated)

- ${paperReady ? "✅" : "❌"} Paper: ${version}
- ${purpurReady ? "✅" : "❌"} Purpur: ${version}

**Checklist (mirrored from issue body):**
${checklistLines}

_Last checked: ${new Date().toISOString()}_
`;
  await updateOrCreateBotComment(issueNumber, statusBody, marker);

  // Final release comment when ALL tasks are checked
  if (allTasksChecked(newBody)) {
    const comments = await listComments(issueNumber);
    const alreadyPosted = comments.some(c => /Amend has been released/i.test(c.body || ""));
    if (!alreadyPosted) await postFinalReleaseComment(issueNumber);
  }

  console.log("Done.");
})().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
