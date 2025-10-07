// CommonJS to avoid ESM warnings. Node 20 has global fetch.
const { Octokit } = require("@octokit/rest");

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumberEnv = process.env.ISSUE_NUMBER || "";
const eventName = process.env.EVENT_NAME || "";
const commentBody = process.env.COMMENT_BODY || "";
const issueTitleEnv = process.env.ISSUE_TITLE || "";

const octokit = new Octokit({ auth: token });
const [owner, repo] = repoName.split("/");

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
function hasChecklist(markdown) {
  return /^-\s\[[ xX]\]\s/m.test(markdown || "");
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

// build the canonical checklist template for a version
function buildChecklistTemplate(version) {
  return `# ${version}
This will help keep track for you of Amend's ${version} release.

- [ ] Waiting on Spigot to release buid
- [ ] Waiting on Paper to release first build (even experimental builds)
- [ ] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)
- [ ] Build Amend
- [ ] Build into API ${version.replace(/\d+$/, m => (parseInt(m, 10) - 1).toString())}  <!-- adjust if you want -->
- [ ] Test Amend and Verify
- [ ] Add Version to Website and other third party plugin distributors
`;
}

// toggle only the paper/purpur lines in any markdown text that contains the checklist
function togglePaperPurpur(markdownRaw, paperReady, purpurReady) {
  const NL = "\n";
  const md = markdownRaw ?? "";
  const paperPattern = /- \[[ x]\]\s*Waiting on Paper.*(\r?\n)/i;
  const purpurPattern = /- \[[ x]\]\s*Waiting on Purpur.*(\r?\n)/i;

  const paperLine = `- [${paperReady ? "x" : " "}] Waiting on Paper to release first build (even experimental builds)${NL}`;
  const purpurLine = `- [${purpurReady ? "x" : " "}] Waiting on Purpur to release first build after Paper's first builds (even experimental builds)${NL}`;

  let out = md;
  if (paperPattern.test(out)) out = out.replace(paperPattern, paperLine);
  if (purpurPattern.test(out)) out = out.replace(purpurPattern, purpurLine);
  return out;
}

// mirror a compact checklist view (all checklist lines) from markdown
function extractChecklistBlock(markdown) {
  const lines = (markdown || "").match(/^-\s\[[ xX]\]\s.*$/gm);
  return lines ? lines.join("\n") : "_(No checklist found)_";
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

  // resolve version: /track <ver> comment -> title token -> heading in body
  let version =
    (eventName === "issue_comment" && versionFromComment(commentBody)) ||
    versionFromTitle(issueTitleEnv) ||
    ((issue.data.body || "").match(/^\s*#{1,6}\s*([\d.]+)/m)?.[1]) ||
    null;

  if (!version) {
    console.log("No version found. Use issue title like '1.21.10 Tracking' or comment '/track 1.21.10'. Exiting.");
    process.exit(0);
  }

  // ensure the issue body contains a checklist (seed it if missing)
  let body = issue.data.body || "";
  if (!hasChecklist(body)) {
    const seeded = buildChecklistTemplate(version);
    // If the body is empty, set to template; else append after a blank line
    body = body.trim() ? body.trim() + "\n\n" + seeded : seeded;
    await setIssueBody(issueNumber, body);
  }

  // now check Paper/Purpur and update ONLY those in the issue body
  const [paperReady, purpurReady] = await Promise.all([
    fetchPaperHas(version),
    fetchPurpurHas(version),
  ]);

  const newBody = togglePaperPurpur(body, paperReady, purpurReady);
  if (newBody !== body) {
    await setIssueBody(issueNumber, newBody);
  }

  // create or update the bot's own checklist comment (it creates it for you)
  const marker = "<!-- amend-bot-status -->";
  const mirroredChecklist = extractChecklistBlock(newBody);
  const statusBody = `${marker}
### 📝 Amend Build Status (auto-updated)

- ${paperReady ? "✅" : "❌"} Paper: ${version}
- ${purpurReady ? "✅" : "❌"} Purpur: ${version}

**Checklist (bot-created & mirrored from issue body):**
${mirroredChecklist}

_Last checked: ${new Date().toISOString()}_
`;

  await updateOrCreateBotComment(issueNumber, statusBody, marker);

  // if all tasks in the issue body are checked, drop final release comment (once)
  if (allTasksChecked(newBody)) {
    const comments = await listComments(issueNumber);
    const already = comments.some(c => /Amend has been released/i.test(c.body || ""));
    if (!already) await postFinalReleaseComment(issueNumber);
  }

  console.log("Done.");
})().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
