const form = document.querySelector("#analyzer-form");
const input = document.querySelector("#username");
const compareInput = document.querySelector("#compare-username");
const submitButton = form.querySelector('button[type="submit"]');
const sampleChips = document.querySelectorAll(".sample-chip");
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

for (const chip of sampleChips) {
  chip.addEventListener("click", async () => {
    const primary = chip.dataset.primary || "";
    const compare = chip.dataset.compare || "";
    input.value = primary;
    compareInput.value = compare;
    await analyzeProfiles(primary, compare);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = input.value.trim();
  const compareUsername = compareInput.value.trim();
  if (!username) {
    setStatus("Enter a GitHub username first.", "error");
    return;
  }

  await analyzeProfiles(username, compareUsername);
});

const params = new URLSearchParams(window.location.search);
const initialUsername = params.get("user") || "octocat";
const initialCompareUsername = params.get("compare") || "";
input.value = initialUsername;
compareInput.value = initialCompareUsername;
analyzeProfiles(initialUsername, initialCompareUsername);

async function analyzeProfiles(username, compareUsername = "") {
  try {
    setLoadingState(true);
    setStatus(compareUsername ? `Comparing ${username} and ${compareUsername}...` : `Loading ${username}...`, "loading");
    results.classList.add("hidden");

    const [primaryAnalysis, secondaryAnalysis] = await Promise.all([
      fetchProfileAnalysis(username),
      compareUsername ? fetchProfileAnalysis(compareUsername) : Promise.resolve(null),
    ]);

    if (secondaryAnalysis) {
      renderComparison(primaryAnalysis, secondaryAnalysis);
      updateAddressBar(primaryAnalysis.profile.login, secondaryAnalysis.profile.login);
      setStatus(`Comparison ready for ${primaryAnalysis.profile.login} and ${secondaryAnalysis.profile.login}.`, "success");
    } else {
      renderAnalysis(primaryAnalysis);
      updateAddressBar(primaryAnalysis.profile.login);
      setStatus(`Analysis ready for ${primaryAnalysis.profile.login}.`, "success");
    }

    results.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to analyze this profile.", "error");
  } finally {
    setLoadingState(false);
  }
}

async function fetchProfileAnalysis(username) {
  const [profile, repositories, events] = await Promise.all([
    fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`),
    fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`),
    fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`),
  ]);

  return buildAnalysis(profile, repositories, events);
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
  const topRepo = topRepos[0] || null;
  const pushedRecently = repositories.filter((repo) => daysSince(repo.pushed_at) <= 30).length;
  const recentEventCount = events.filter((event) => daysSince(event.created_at) <= 30).length;
  const avgStarsPerOriginalRepo = originalRepos.length ? totalStars / originalRepos.length : 0;
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
      recentEventCount,
      avgStarsPerOriginalRepo,
    },
    topRepos,
    topRepo,
    languages,
    score,
    scoreBreakdown,
    events: summarizeEvents(events),
    activitySeries: buildActivitySeries(events),
  };
}

function buildComparison(primary, secondary) {
  const primaryLanguageMap = new Map(primary.languages.map((entry) => [entry.language, entry.count]));
  const secondaryLanguageMap = new Map(secondary.languages.map((entry) => [entry.language, entry.count]));
  const sharedLanguages = [...primaryLanguageMap.keys()]
    .filter((language) => secondaryLanguageMap.has(language))
    .map((language) => ({
      language,
      primaryCount: primaryLanguageMap.get(language),
      secondaryCount: secondaryLanguageMap.get(language),
    }))
    .sort((a, b) => (b.primaryCount + b.secondaryCount) - (a.primaryCount + a.secondaryCount));

  return {
    primary,
    secondary,
    sharedLanguages,
    metrics: [
      compareMetric("Followers", primary.profile.followers, secondary.profile.followers),
      compareMetric("Public repos", primary.profile.public_repos, secondary.profile.public_repos),
      compareMetric("Total stars", primary.totals.totalStars, secondary.totals.totalStars),
      compareMetric("Recent repo updates (30d)", primary.totals.pushedRecently, secondary.totals.pushedRecently),
      compareMetric("Recent public events (30d)", primary.totals.recentEventCount, secondary.totals.recentEventCount),
      compareMetric("Average stars per original repo", primary.totals.avgStarsPerOriginalRepo, secondary.totals.avgStarsPerOriginalRepo, 1),
      compareMetric("Account age (years)", accountAgeInYears(primary.profile.created_at), accountAgeInYears(secondary.profile.created_at), 1),
    ],
  };
}

function compareMetric(label, primaryValue, secondaryValue, digits = 0) {
  return {
    label,
    primaryValue,
    secondaryValue,
    primaryText: formatMetricValue(primaryValue, digits),
    secondaryText: formatMetricValue(secondaryValue, digits),
    winner: primaryValue === secondaryValue ? "tie" : primaryValue > secondaryValue ? "primary" : "secondary",
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

function renderComparison(primary, secondary) {
  const comparison = buildComparison(primary, secondary);
  renderCompareHeader(primary, secondary);
  renderCompareMetrics(comparison);
  renderCompareTopRepos(primary, secondary);
  renderCompareLanguages(comparison);
  renderCompareActivity(primary, secondary);
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

function renderCompareHeader(primary, secondary) {
  profileSummary.innerHTML = `
    <div class="compare-header">
      ${createCompareProfile(primary)}
      <div class="compare-vs">vs</div>
      ${createCompareProfile(secondary)}
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

function renderCompareMetrics(comparison) {
  scoreCard.innerHTML = `
    <h2>Comparison View</h2>
    <p class="score-note">Side-by-side comparison across public GitHub signals and the opinionated profile score.</p>
    <div class="metric-list"></div>
    <div class="compare-table"></div>
  `;

  const metricList = scoreCard.querySelector(".metric-list");
  appendMetric(metricList, `${comparison.primary.profile.login} score`, `${comparison.primary.score}/100`);
  appendMetric(metricList, `${comparison.secondary.profile.login} score`, `${comparison.secondary.score}/100`);
  appendMetric(metricList, "Shared top languages", formatNumber(comparison.sharedLanguages.length));
  appendMetric(metricList, "Combined public repos", formatNumber(comparison.primary.profile.public_repos + comparison.secondary.profile.public_repos));

  const table = scoreCard.querySelector(".compare-table");
  table.innerHTML = comparison.metrics.map((metric) => `
    <div class="compare-row">
      <span class="compare-value ${metric.winner === "primary" ? "winner" : ""}">${escapeHtml(metric.primaryText)}</span>
      <span class="compare-label">${escapeHtml(metric.label)}</span>
      <span class="compare-value ${metric.winner === "secondary" ? "winner" : ""}">${escapeHtml(metric.secondaryText)}</span>
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

function renderCompareTopRepos(primary, secondary) {
  repoStats.innerHTML = `
    <h2>Top Repositories</h2>
    <p class="muted">Highest-traction public repository for each profile, side by side.</p>
    <div class="compare-panels">
      ${createTopRepoPanel(primary)}
      ${createTopRepoPanel(secondary)}
    </div>
  `;
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

function renderCompareLanguages(comparison) {
  languageBreakdown.innerHTML = `
    <h2>Language Overlap</h2>
    <p class="muted">Shared top languages between both public profiles.</p>
    <div class="bar-list"></div>
  `;

  const list = languageBreakdown.querySelector(".bar-list");
  if (!comparison.sharedLanguages.length) {
    list.innerHTML = `<p class="muted">No overlap across the top visible repository languages.</p>`;
    return;
  }

  list.innerHTML = comparison.sharedLanguages.slice(0, 6).map((entry) => `
    <div class="bar-item">
      <div class="bar-top">
        <strong>${escapeHtml(entry.language)}</strong>
        <span class="list-label">${comparison.primary.profile.login}: ${entry.primaryCount} | ${comparison.secondary.profile.login}: ${entry.secondaryCount}</span>
      </div>
      <div class="compare-track">
        <div class="compare-fill compare-fill-primary" style="width: ${calculateCompareWidth(entry.primaryCount, entry.secondaryCount)}%"></div>
        <div class="compare-fill compare-fill-secondary" style="width: ${calculateCompareWidth(entry.secondaryCount, entry.primaryCount)}%"></div>
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

function renderCompareActivity(primary, secondary) {
  activityFeed.innerHTML = `
    <h2>Recent Activity</h2>
    <p class="muted">Public event volume and momentum across both profiles.</p>
    <div class="compare-panels">
      ${createActivityPanel(primary)}
      ${createActivityPanel(secondary)}
    </div>
  `;
}

function appendMetric(container, label, value) {
  const metric = metricTemplate.content.firstElementChild.cloneNode(true);
  metric.querySelector(".metric-label").textContent = label;
  metric.querySelector(".metric-value").textContent = value;
  container.append(metric);
}

function createCompareProfile(analysis) {
  return `
    <article class="compare-profile">
      <img class="avatar" src="${analysis.profile.avatar_url}" alt="${analysis.profile.login} avatar">
      <div>
        <h2>${escapeHtml(analysis.profile.name || analysis.profile.login)}</h2>
        <p><a href="${analysis.profile.html_url}" target="_blank" rel="noreferrer">@${escapeHtml(analysis.profile.login)}</a></p>
        <p>${escapeHtml(analysis.profile.bio || "No public bio available.")}</p>
        <div class="pill-row">
          ${createPill(`${formatNumber(analysis.profile.followers)} followers`)}
          ${createPill(`${formatNumber(analysis.profile.public_repos)} repos`)}
          ${createPill(`${formatNumber(analysis.totals.totalStars)} stars`)}
        </div>
      </div>
    </article>
  `;
}

function createTopRepoPanel(analysis) {
  if (!analysis.topRepo) {
    return `
      <div class="compare-panel">
        <div class="item-top">
          <strong>${escapeHtml(analysis.profile.login)}</strong>
          <span class="list-label">No public repos</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="compare-panel">
      <div class="item-top">
        <strong>${escapeHtml(analysis.profile.login)}</strong>
        <span class="list-label">${formatNumber(analysis.score)} score</span>
      </div>
      <div class="repo-item repo-item-compare">
        <div class="item-top">
          <strong><a href="${analysis.topRepo.html_url}" target="_blank" rel="noreferrer">${escapeHtml(analysis.topRepo.name)}</a></strong>
          <span class="list-label">${formatNumber(analysis.topRepo.stargazers_count)} stars</span>
        </div>
        <p>${escapeHtml(analysis.topRepo.description || "No description provided.")}</p>
        <p class="muted">Forks: ${formatNumber(analysis.topRepo.forks_count)} | Language: ${escapeHtml(analysis.topRepo.language || "n/a")}</p>
      </div>
    </div>
  `;
}

function createActivityPanel(analysis) {
  const weeklyTotal = analysis.activitySeries.weekly.reduce((sum, entry) => sum + entry.count, 0);
  return `
    <div class="compare-panel">
      <div class="item-top">
        <strong>${escapeHtml(analysis.profile.login)}</strong>
        <span class="list-label">${formatNumber(analysis.totals.recentEventCount)} events in 30d</span>
      </div>
      <div class="spark-bars compact-spark">
        ${analysis.activitySeries.daily.map((entry) => `
          <div class="spark-item" title="${escapeHtml(`${entry.label}: ${entry.count} events`)}">
            <div class="spark-bar" style="height: ${entry.height}%"></div>
            <span class="spark-label">${escapeHtml(entry.label)}</span>
          </div>
        `).join("")}
      </div>
      <p class="muted">Last 8 weeks: ${formatNumber(weeklyTotal)} public events</p>
    </div>
  `;
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
  submitButton.textContent = isLoading ? "Loading..." : "Analyze";
}

function updateAddressBar(username, compareUsername = "") {
  const url = new URL(window.location.href);
  url.searchParams.set("user", username);
  if (compareUsername) {
    url.searchParams.set("compare", compareUsername);
  } else {
    url.searchParams.delete("compare");
  }
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

function formatMetricValue(value, digits = 0) {
  return digits > 0 ? Number(value || 0).toFixed(digits) : formatNumber(value || 0);
}

function accountAgeInYears(dateString) {
  const years = (Date.now() - new Date(dateString).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, years);
}

function calculateCompareWidth(value, otherValue) {
  const total = value + otherValue;
  if (!total) {
    return 50;
  }

  return Math.max(14, Math.round((value / total) * 100));
}
