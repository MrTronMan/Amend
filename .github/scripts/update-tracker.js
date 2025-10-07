import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";

const token = process.env.GITHUB_TOKEN;
const repoName = process.env.REPO;
const issueNumber = process.env.ISSUE_NUMBER;

const octokit = new Octokit({ auth: token });

function normalizeVersions(version) {
  if (version.endsWith(".0")) {
    return [version, version.replace(/\.0$/, "")];
  }
  return [version];
}

async function checkPaper(version) {
  const res = await fetch("https://api.papermc.io/v2/projects/paper");
  const data = await res.json();
  return normalizeVersions(version).some(v => data.versions.includes(v));
}

async function checkPurpur(version) {
  const res = await fetch("https://api.purpurmc.org/v2/purpur");
  const data = await res.json();
  return normalizeVersions(version).some(v => data.versions.includes(v));
}

async function updateBotComment(version, results) {
  const [owner, repo] = repoName.split("/");

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const marker = "<!-- amend-bot-status -->";
  const body = `${marker}
### 📝 Amend Build Status (auto-updated)

- ${results.paper ? "✅" : "❌"} Paper: ${version}
- ${results.purpur ? "✅" : "❌"} Purpur: ${version}

_Last checked: ${new Date().toISOString()}_
`;

  const existing = comments.find(c => c.body.includes(marker));

  if (existing) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    console.log("✅ Updated bot comment");
  } else {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    console.log("✅ Created new bot comment");
  }
}

(async () => {
  try {
    const [owner, repo] = repoName.split("/");
    const issue = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
    const match = issue.data.body.match(/##\s*([\d.]+)/);
    if (!match) throw new Error("No version heading found (## x.y.z)");

    const version = match[1];
    const results = {
      paper: await checkPaper(version),
      purpur: await checkPurpur(version),
    };

    await updateBotComment(version, results);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
})();
