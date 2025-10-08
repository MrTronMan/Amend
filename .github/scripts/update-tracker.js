// Node 20: global fetch. CommonJS to avoid ESM warnings.
const { Octokit } = require("@octokit/rest");

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

// ---------- markers for the two bot comments ----------
const CHECKLIST_MARKER = "<!-- amend-bot-checklist -->";
const STATUS_MARKER    = "<!-- amend-bot-status -->";

// ---------- helpers ----------
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
  const { data } = await octokit.issues.listComments({
    owner, repo, issue_number: issueNumber, per_page: 100,
  });
  return data;
}
async function upsertComment(issueNumber, marker, bodyBuilder) {
  const comments = await listComments(issueNumber);
  const existing = comments.find(c => c.body && c.body.includes(marker));
  const newBody = bodyBuilder();

  if (existing) {
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: newBody });
    return { action: "updated", body: newBody };
  } else {
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: newBody });
    return { action: "created", body: newBody };
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

// ---------- checklist content (bot-owned) ----------
function derivePrevPatch(version) {
  const parts = version.split(".");
  if (parts.length === 3) {
    const n = parseInt(parts[2], 10);
    return `${parts[0]}.${parts[1]}.${Math.max(0, n - 1)}`;
  }
  return version;
}
function buildChecklist(version, { paperReady, purpurReady }) {
  const lastUpdated = new Date().toISOString();
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

_Last updated: ${lastUpdated}_
`;
}

// ---------- status comment (separate from checklist) ----------
function buildStatus(version, { paperReady, purpurReady }) {
  const ts = new Date().toISOString();
  return `${STATUS_MARKER}
### 📝 Amend Paper/Purpur Status (auto-updated)

- ${paperReady ? "✅" : "❌"} Paper: ${version}
- ${purpurReady ? "✅" : "❌"} Purpur: ${version}

_Last checked: ${ts}_
`;
}

async function resolveIssueNumber() {
  if (issueNumberEnv) return parseInt(issueNumberEnv, 10);
  // fallback: last updated open issue with label update-tracker
  const { data: issues } = await octokit.issues.listForRepo({
    owner, repo, labels: "update-tracker", state: "open", per_page: 1,
    sort: "updated", direction: "desc",
  });
  if (issues.length) return issues[0].number;
  throw new Error("No ISSUE_NUMBER provided and no open 'update-tracker' issues found.");
}

(async () => {
  const issueNumber = await resolveIssueNumber();
  const issue = await getIssue(issueNumber);

  // resolve version: /track <ver> -> title token -> heading in original body (if any)
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    ((issue.data.body || "").match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1]) ||
    null;

  if (!version) {
    console.log("No version found. Use issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // check Paper/Purpur
  const [paperReady, purpurReady] = await Promise.all([
    fetchPaperHas(version),
    fetchPurpurHas(version),
  ]);

  // clear issue body to a single space (your request)
  const currentBody = issue.data.body ?? "";
  if (currentBody.trim() !== "") {
    await setIssueBody(issueNumber, " ");
  }

  // upsert the CHECKLIST comment (bot-owned)
  await upsertComment(
    issueNumber,
    CHECKLIST_MARKER,
    () => buildChecklist(version, { paperReady, purpurReady })
  );

  // upsert the STATUS comment (separate)
  await upsertComment(
    issueNumber,
    STATUS_MARKER,
    () => buildStatus(version, { paperReady, purpurReady })
  );

  // (optional) final release comment if everything is checked in the checklist.
  // NOTE: right now only Paper/Purpur are auto-ticked. If you later add commands
  // to mark the remaining items done, this will fire then.
  const comments = await listComments(issueNumber);
  const checklist = comments.find(c => c.body && c.body.includes(CHECKLIST_MARKER));
  if (checklist && allTasksChecked(checklist.body)) {
    const already = comments.some(c => /Amend has been released/i.test(c.body || ""));
    if (!already) await postFinalReleaseComment(issueNumber);
  }

  console.log("Done.");
})().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
