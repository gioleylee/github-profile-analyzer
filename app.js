const form = document.querySelector("#analyzer-form");
const input = document.querySelector("#username");
const submitButton = form.querySelector('button[type="submit"]');
const results = document.querySelector("#results");
const statusCard = document.querySelector("#status-card");
const statusMessage = document.querySelector("#status-message");
const metricTemplate = document.querySelector("#metric-template");

const profileSummary = document.querySelector("#profile-summary");
const scoreCard = document.querySelector("#score-card");
const repoStats = document.querySelector("#repo-stats");
const languageBreakdown = document.querySelector("#language-breakdown");
const activityFeed = document.querySelector("#activity-feed");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = input.value.trim();
  if (!username) {
    setStatus("Enter a GitHub username first.", "error");
    return;
  }

  await analyzeProfile(username);
});

const initialUsername = new URLSearchParams(window.location.search).get("user") || "octocat";
input.value = initialUsername;
analyzeProfile(initialUsername);

async function analyzeProfile(username) {
  try {
    setLoadingState(true);
    setStatus(`Loading ${username}...`, "loading");
    results.classList.add("hidden");

    const [profile, repositories, events] = await Promise.all([
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`),
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`),
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=10`),
    ]);

    const analysis = buildAnalysis(profile, repositories, events);
    renderAnalysis(analysis);
    updateAddressBar(analysis.profile.login);

    results.classList.remove("hidden");
    setStatus(`Analysis ready for ${analysis.profile.login}.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to analyze this profile.", "error");
  } finally {
    setLoadingState(false);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("GitHub user not found.");
    }

    if (response.status === 403) {
      throw new Error("GitHub API rate limit reached. Please try again later.");
    }

    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }

  return response.json();
}

function buildAnalysis(profile, repositories, events) {
  const repoCount = repositories.length;
  const originalRepos = repositories.filter((repo) => !repo.fork);
  const forks = repositories.filter((repo) => repo.fork).length;
  const totalStars = repositories.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const totalForks = repositories.reduce((sum, repo) => sum + repo.forks_count, 0);
  const watchers = repositories.reduce((sum, repo) => sum + repo.watchers_count, 0);
  const languages = aggregateLanguages(repositories);
  const topRepos = [...repositories]
    .sort((a, b) => b.stargazers_count - a.stargazers_count || b.forks_count - a.forks_count)
    .slice(0, 5);
  const pushedRecently = repositories.filter((repo) => daysSince(repo.pushed_at) <= 30).length;
  const score = calculateScore({
    followers: profile.followers,
    publicRepos: profile.public_repos,
    totalStars,
    pushedRecently,
    originalRepoCount: originalRepos.length,
    bio: Boolean(profile.bio),
    blog: Boolean(profile.blog),
    company: Boolean(profile.company),
  });

  return {
    profile,
    totals: {
      repoCount,
      originalRepoCount: originalRepos.length,
      forks,
      totalStars,
      totalForks,
      watchers,
      pushedRecently,
    },
    topRepos,
    languages,
    score,
    events: summarizeEvents(events),
  };
}

function calculateScore(inputs) {
  let score = 0;

  score += Math.min(inputs.followers * 1.2, 25);
  score += Math.min(inputs.publicRepos * 0.6, 18);
  score += Math.min(inputs.totalStars * 0.35, 25);
  score += Math.min(inputs.pushedRecently * 1.5, 15);
  score += Math.min(inputs.originalRepoCount * 0.5, 8);
  score += inputs.bio ? 3 : 0;
  score += inputs.blog ? 3 : 0;
  score += inputs.company ? 3 : 0;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function aggregateLanguages(repositories) {
  const counts = new Map();

  for (const repo of repositories) {
    if (!repo.language) {
      continue;
    }

    counts.set(repo.language, (counts.get(repo.language) || 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([language, count]) => ({
      language,
      count,
      percentage: total ? Math.round((count / total) * 100) : 0,
    }));
}

function summarizeEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  return events.slice(0, 6).map((event) => ({
    type: humanizeEventType(event.type),
    repo: event.repo?.name || "Unknown repository",
    when: formatRelative(event.created_at),
  }));
}

function renderAnalysis(analysis) {
  renderProfile(analysis.profile, analysis.totals);
  renderScore(analysis.score, analysis.profile);
  renderRepoStats(analysis.totals, analysis.topRepos);
  renderLanguages(analysis.languages);
  renderActivity(analysis.events);
}

function renderProfile(profile, totals) {
  profileSummary.innerHTML = `
    <div class="profile-header">
      <img class="avatar" src="${profile.avatar_url}" alt="${profile.login} avatar">
      <div class="profile-meta">
        <h2>${escapeHtml(profile.name || profile.login)}</h2>
        <p><a href="${profile.html_url}" target="_blank" rel="noreferrer">@${escapeHtml(profile.login)}</a></p>
        <p>${escapeHtml(profile.bio || "No public bio available.")}</p>
        <div class="pill-row">
          ${createPill(profile.location || "Location not listed")}
          ${createPill(profile.company || "No company listed")}
          ${createPill(`${formatNumber(profile.followers)} followers`)}
          ${createPill(`${formatNumber(profile.following)} following`)}
          ${createPill(`${formatNumber(totals.repoCount)} public repos`)}
        </div>
      </div>
    </div>
  `;
}

function renderScore(score, profile) {
  const message = score >= 80
    ? "Strong public footprint with consistent signals of activity and reach."
    : score >= 55
      ? "Healthy profile with visible momentum and enough public work to review."
      : "Early or quieter public footprint. There may still be strong private or offline work.";

  scoreCard.innerHTML = `
    <h2>Profile Score</h2>
    <div class="score">${score}<span class="muted">/100</span></div>
    <p class="score-note">${message}</p>
    <div class="metric-list"></div>
  `;

  const metricList = scoreCard.querySelector(".metric-list");
  appendMetric(metricList, "Followers", formatNumber(profile.followers));
  appendMetric(metricList, "Public Repos", formatNumber(profile.public_repos));
  appendMetric(metricList, "Public Gists", formatNumber(profile.public_gists));
  appendMetric(metricList, "Joined", formatDate(profile.created_at));
}

function renderRepoStats(totals, topRepos) {
  repoStats.innerHTML = `
    <h2>Repository Signals</h2>
    <div class="metric-list"></div>
    <div class="repo-list"></div>
  `;

  const metricList = repoStats.querySelector(".metric-list");
  appendMetric(metricList, "Original Repos", formatNumber(totals.originalRepoCount));
  appendMetric(metricList, "Forked Repos", formatNumber(totals.forks));
  appendMetric(metricList, "Stars Earned", formatNumber(totals.totalStars));
  appendMetric(metricList, "Forks Received", formatNumber(totals.totalForks));
  appendMetric(metricList, "Watchers", formatNumber(totals.watchers));
  appendMetric(metricList, "Repos Updated in 30d", formatNumber(totals.pushedRecently));

  const repoList = repoStats.querySelector(".repo-list");
  if (topRepos.length === 0) {
    repoList.innerHTML = `<p class="muted">No public repositories found.</p>`;
    return;
  }

  repoList.innerHTML = topRepos.map((repo) => `
    <div class="repo-item">
      <div class="item-top">
        <strong><a href="${repo.html_url}" target="_blank" rel="noreferrer">${escapeHtml(repo.name)}</a></strong>
        <span class="list-label">${formatNumber(repo.stargazers_count)} stars</span>
      </div>
      <p>${escapeHtml(repo.description || "No description provided.")}</p>
    </div>
  `).join("");
}

function renderLanguages(languages) {
  languageBreakdown.innerHTML = `
    <h2>Language Mix</h2>
    <p class="muted">Top languages across public repositories.</p>
    <div class="bar-list"></div>
  `;

  const list = languageBreakdown.querySelector(".bar-list");
  if (languages.length === 0) {
    list.innerHTML = `<p class="muted">No primary language data available.</p>`;
    return;
  }

  list.innerHTML = languages.map((entry) => `
    <div class="bar-item">
      <div class="bar-top">
        <strong>${escapeHtml(entry.language)}</strong>
        <span class="list-label">${entry.count} repos | ${entry.percentage}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${entry.percentage}%"></div>
      </div>
    </div>
  `).join("");
}

function renderActivity(events) {
  activityFeed.innerHTML = `
    <h2>Recent Activity</h2>
    <p class="muted">Latest public events from the GitHub activity feed.</p>
    <div class="activity-list"></div>
  `;

  const list = activityFeed.querySelector(".activity-list");
  if (!events.length) {
    list.innerHTML = `<p class="muted">No recent public activity was returned by GitHub.</p>`;
    return;
  }

  list.innerHTML = events.map((event) => `
    <div class="activity-item">
      <div class="item-top">
        <strong>${escapeHtml(event.type)}</strong>
        <span class="list-label">${escapeHtml(event.when)}</span>
      </div>
      <p>${escapeHtml(event.repo)}</p>
    </div>
  `).join("");
}

function appendMetric(container, label, value) {
  const metric = metricTemplate.content.firstElementChild.cloneNode(true);
  metric.querySelector(".metric-label").textContent = label;
  metric.querySelector(".metric-value").textContent = value;
  container.append(metric);
}

function createPill(text) {
  return `<span class="pill">${escapeHtml(text)}</span>`;
}

function formatRelative(dateString) {
  const diffInDays = daysSince(dateString);
  if (diffInDays < 1) {
    return "today";
  }

  if (diffInDays === 1) {
    return "1 day ago";
  }

  return `${diffInDays} days ago`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysSince(dateString) {
  const time = new Date(dateString).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - time);
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function humanizeEventType(type) {
  return type
    .replace(/Event$/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, tone = "success") {
  statusMessage.textContent = message;
  if (tone === "success") {
    statusCard.removeAttribute("data-tone");
    return;
  }

  statusCard.setAttribute("data-tone", tone);
}

function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Analyzing..." : "Analyze";
}

function updateAddressBar(username) {
  const url = new URL(window.location.href);
  url.searchParams.set("user", username);
  window.history.replaceState({}, "", url);
}
