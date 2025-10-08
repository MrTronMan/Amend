// Node 20: global fetch is available. CommonJS style to avoid ESM warnings.
const { Octokit } = require("@octokit/rest");

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

// ------------- Helpers -------------
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
function allTasksChecked(markdown) {
  return !/- \[ \]/.test(markdown || "");
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
  const existing = comments.find((c) => c.body && c.body.includes(marker));
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
  return cands.some((v) => data.versions.includes(v));
}
async function fetchPurpurHas(version) {
  const res = await fetch("https://api.purpurmc.org/v2/purpur");
  if (!res.ok) throw new Error(`Purpur API HTTP ${res.status}`);
  const data = await res.json();
  const cands = normalizeCandidates(version);
  return cands.some((v) => data.versions.includes(v));
}

// Canonical checklist content (bot-owned comment only)
function buildChecklistComment(version, opts) {
  const { paperReady, purpurReady } = opts;
  const lastUpdated = new Date().toISOString();

  // Only Paper & Purpur are auto-toggled. Others remain as initially unchecked (bot-owned).
  return `<!-- amend-bot-status -->
# ${version}
This will help keep track for you of Amend's ${version} release.

- [ ] Waiting on Spigot to release buid
- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)
- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)
- [ ] Build Amend
- [ ] Build into API ${derivePrevPatch(version)}
- [ ] Test Amend and Verify
- [ ] Add Version to Website and other third party plugin distributors

_Last updated: ${lastUpdated}_
`;
}

// derive “previous patch” for the “Build into API …” line (you can replace with static if you prefer)
function derivePrevPatch(version) {
  // e.g., 1.21.10 -> 1.21.9 ; 1.21 -> 1.21 (no change). Adjust if your intent differs.
  const parts = version.split(".");
  if (parts.length === 3) {
    const n = parseInt(parts[2], 10);
    return `${parts[0]}.${parts[1]}.${Math.max(0, n - 1)}`;
  }
  return version;
}

async function resolveIssueNumber() {
  if (issueNumberEnv) return parseInt(issueNumberEnv, 10);
  // Fallback: last updated open issue with label update-tracker
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

  // Resolve version: /track <ver> comment -> title token -> heading in body (optional fallback)
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    ((issue.data.body || "").match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1]) ||
    null;

  if (!version) {
    console.log("No version found. Use issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // Check Paper/Purpur availability
  const [paperReady, purpurReady] = await Promise.all([fetchPaperHas(version), fetchPurpurHas(version)]);

  // Ensure original issue body is essentially blank (single space) as requested
  const bodyCurrent = issue.data.body ?? "";
  if (bodyCurrent.trim() !== "") {
    // replace with a single space to keep Markdown body visually blank
    await setIssueBody(issueNumber, " ");
  }

  // Create or update ONE bot-owned checklist comment
  const marker = "<!-- amend-bot-status -->";
  const desired = buildChecklistComment(version, { paperReady, purpurReady });

  const comments = await listComments(issueNumber);
  const existing = comments.find((c) => c.body && c.body.includes(marker));

  if (existing) {
    // We rebuild fully each run (keeps logic simple; bot is sole editor)
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: desired });
    console.log("✅ Updated bot checklist comment.");
  } else {
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: desired });
    console.log("✅ Created bot checklist comment.");
  }

  // If ALL tasks are checked in the bot comment (only possible if bot later decides to mark them),
  // then post final release comment. Right now only Paper/Purpur are auto-ticked, so this will
  // only fire when you adapt logic to tick the remaining tasks.
  if (allTasksChecked(desired)) {
    const alreadyPosted = comments.some((c) => /Amend has been released/i.test(c.body || ""));
    if (!alreadyPosted) await postFinalReleaseComment(issueNumber);
  }

  console.log("Done.");
})().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
