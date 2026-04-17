# GitHub Profile Analyzer

GitHub Profile Analyzer is a lightweight front-end project that turns a public GitHub username into a quick technical snapshot. It pulls live public data from the GitHub REST API and presents it as a clean, browser-based dashboard.

## Features

- Profile overview with follower, following, location, and bio details
- Computed profile score based on public activity and repository signals
- Repository metrics including stars, forks, watchers, and recent updates
- Top repositories ranked by public traction
- Language distribution across public repositories
- Recent public GitHub activity feed
- Shareable profile links with `?user=<username>`

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- GitHub REST API

## Run Locally

1. Clone or download the project.
2. Open `index.html` in a browser.
3. Search for any public GitHub username.

## Why This Project

This project was built as a concise front-end portfolio piece: no build step, no framework dependency, and a clear API-driven user flow. It focuses on transforming raw GitHub data into signals that are easier to scan and discuss.

## Notes

- The app only analyzes public GitHub data.
- Anonymous GitHub API requests may be rate-limited.
- Results depend on the profile data GitHub exposes publicly.
