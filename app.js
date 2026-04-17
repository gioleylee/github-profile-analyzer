const form = document.querySelector("#analyzer-form");
const input = document.querySelector("#username");
const submitButton = form.querySelector('button[type="submit"]');
const themeToggle = document.querySelector("#theme-toggle");
const results = document.querySelector("#results");
const statusCard = document.querySelector("#status-card");
const statusMessage = document.querySelector("#status-message");
const metricTemplate = document.querySelector("#metric-template");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

const profileSummary = document.querySelector("#profile-summary");
const scoreCard = document.querySelector("#score-card");
const repoStats = document.querySelector("#repo-stats");
const languageBreakdown = document.querySelector("#language-breakdown");
const activityFeed = document.querySelector("#activity-feed");
const storedTheme = window.localStorage.getItem("theme");
const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

applyTheme(storedTheme || (systemPrefersDark.matches ? "dark" : "light"));

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme || "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  window.localStorage.setItem("theme", nextTheme);
  applyTheme(nextTheme);
});

systemPrefersDark.addEventListener("change", (event) => {
  if (window.localStorage.getItem("theme")) {
    return;
  }

  applyTheme(event.matches ? "dark" : "light");
});

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
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`),
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
  const scoreBreakdown = buildScoreBreakdown({
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
    scoreBreakdown,
    events: summarizeEvents(events),
    activitySeries: buildActivitySeries(events),
  };
}

function calculateScore(inputs) {
  const total = buildScoreBreakdown(inputs).reduce((sum, item) => sum + item.points, 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

function buildScoreBreakdown(inputs) {
  return [
    {
      label: "Followers",
      metric: formatNumber(inputs.followers),
      points: Math.min(inputs.followers * 1.2, 25),
      cap: 25,
    },
    {
      label: "Public repos",
      metric: formatNumber(inputs.publicRepos),
      points: Math.min(inputs.publicRepos * 0.6, 18),
      cap: 18,
    },
    {
      label: "Stars across repos",
      metric: formatNumber(inputs.totalStars),
      points: Math.min(inputs.totalStars * 0.35, 25),
      cap: 25,
    },
    {
      label: "Recent repo activity",
      metric: `${formatNumber(inputs.pushedRecently)} updated in 30d`,
      points: Math.min(inputs.pushedRecently * 1.5, 15),
      cap: 15,
    },
    {
      label: "Original repositories",
      metric: formatNumber(inputs.originalRepoCount),
      points: Math.min(inputs.originalRepoCount * 0.5, 8),
      cap: 8,
    },
    {
      label: "Profile completeness",
      metric: `${inputs.bio ? 1 : 0}/${inputs.blog ? 1 : 0}/${inputs.company ? 1 : 0} bio-blog-company`,
      points: (inputs.bio ? 3 : 0) + (inputs.blog ? 3 : 0) + (inputs.company ? 3 : 0),
      cap: 9,
    },
  ];
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

function buildActivitySeries(events) {
  return {
    daily: aggregateEventsByDay(events, 7),
    weekly: aggregateEventsByWeek(events, 8),
  };
}

function aggregateEventsByDay(events, days) {
  const counts = new Map();

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    counts.set(date.toISOString().slice(0, 10), 0);
  }

  for (const event of events) {
    const key = new Date(event.created_at).toISOString().slice(0, 10);
    if (counts.has(key)) {
      counts.set(key, counts.get(key) + 1);
    }
  }

  const max = Math.max(...counts.values(), 1);

  return [...counts.entries()].map(([key, count]) => ({
    label: formatShortDay(key),
    count,
    height: Math.max(10, Math.round((count / max) * 100)),
  }));
}

function aggregateEventsByWeek(events, weeks) {
  const counts = new Map();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = startOfWeek(new Date(), index);
    counts.set(weekStart.toISOString().slice(0, 10), 0);
  }

  for (const event of events) {
    const eventWeek = startOfWeek(new Date(event.created_at), 0).toISOString().slice(0, 10);
    if (counts.has(eventWeek)) {
      counts.set(eventWeek, counts.get(eventWeek) + 1);
    }
  }

  const max = Math.max(...counts.values(), 1);

  return [...counts.entries()].map(([key, count], index) => ({
    label: `W${index + 1}`,
    count,
    height: Math.max(10, Math.round((count / max) * 100)),
    detail: formatWeekLabel(key),
  }));
}

function renderAnalysis(analysis) {
  renderProfile(analysis.profile, analysis.totals);
  renderScore(analysis.score, analysis.profile, analysis.scoreBreakdown);
  renderRepoStats(analysis.totals, analysis.topRepos);
  renderLanguages(analysis.languages);
  renderActivity(analysis.events, analysis.activitySeries);
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

function renderScore(score, profile, scoreBreakdown) {
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
    <details class="explain-card">
      <summary>How score is calculated</summary>
      <p class="muted">
        This score is an opinionated heuristic based on public GitHub signals. It is not an official GitHub metric.
      </p>
      <div class="explain-list"></div>
    </details>
  `;

  const metricList = scoreCard.querySelector(".metric-list");
  appendMetric(metricList, "Followers", formatNumber(profile.followers));
  appendMetric(metricList, "Public Repos", formatNumber(profile.public_repos));
  appendMetric(metricList, "Public Gists", formatNumber(profile.public_gists));
  appendMetric(metricList, "Joined", formatDate(profile.created_at));

  const explainList = scoreCard.querySelector(".explain-list");
  explainList.innerHTML = scoreBreakdown.map((item) => `
    <div class="explain-item">
      <strong>${escapeHtml(item.label)}</strong>
      <span class="list-label">${escapeHtml(item.metric)}</span>
      <span class="list-label">${Math.round(item.points)}/${item.cap} points</span>
    </div>
  `).join("");
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

function renderActivity(events, activitySeries) {
  activityFeed.innerHTML = `
    <h2>Recent Activity</h2>
    <p class="muted">Latest public events from the GitHub activity feed.</p>
    <div class="activity-visuals">
      <div class="mini-chart">
        <div class="item-top">
          <strong>By day</strong>
          <span class="list-label">Last 7 days</span>
        </div>
        <div class="spark-bars daily-bars"></div>
      </div>
      <div class="mini-chart">
        <div class="item-top">
          <strong>By week</strong>
          <span class="list-label">Last 8 weeks</span>
        </div>
        <div class="spark-bars weekly-bars"></div>
      </div>
    </div>
    <div class="activity-list"></div>
  `;

  const dailyBars = activityFeed.querySelector(".daily-bars");
  const weeklyBars = activityFeed.querySelector(".weekly-bars");

  dailyBars.innerHTML = activitySeries.daily.map((entry) => `
    <div class="spark-item" title="${escapeHtml(`${entry.label}: ${entry.count} events`)}">
      <div class="spark-bar" style="height: ${entry.height}%"></div>
      <span class="spark-label">${escapeHtml(entry.label)}</span>
    </div>
  `).join("");

  weeklyBars.innerHTML = activitySeries.weekly.map((entry) => `
    <div class="spark-item" title="${escapeHtml(`${entry.detail}: ${entry.count} events`)}">
      <div class="spark-bar" style="height: ${entry.height}%"></div>
      <span class="spark-label">${escapeHtml(entry.label)}</span>
    </div>
  `).join("");

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

function formatShortDay(dateString) {
  return new Date(dateString).toLocaleDateString(undefined, {
    weekday: "short",
  });
}

function formatWeekLabel(dateString) {
  return `Week of ${new Date(dateString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

function startOfWeek(date, weeksAgo) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - (copy.getDay() + 6) % 7);
  copy.setDate(copy.getDate() - weeksAgo * 7);
  return copy;
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));

  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", theme === "dark" ? "#101923" : "#f7f3ea");
  }
}
