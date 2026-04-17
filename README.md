# GitHub Profile Analyzer

GitHub Profile Analyzer is a lightweight front-end project that turns a public GitHub username into a quick technical snapshot. It pulls live public data from the GitHub REST API and presents it as a clean, browser-based dashboard designed to make profile quality, repository traction, and activity patterns easy to scan.

## Overview

This project focuses on a simple idea: take raw public GitHub profile data and reshape it into signals that are easier to scan, compare, and discuss. It keeps the surface area small, runs without framework or build tooling, and emphasizes clarity over complexity.

## Features

- Profile overview with follower, following, location, and bio details
- Computed profile score based on public activity and repository signals
- Repository metrics including stars, forks, watchers, and recent updates
- Top repositories ranked by public traction
- Language distribution across public repositories
- Recent public GitHub activity feed
- Shareable profile links with `?user=<username>`

## What This Demonstrates

- API integration against a real public data source
- Client-side data transformation and scoring logic
- Responsive UI design without a framework
- Thoughtful information hierarchy for scan-heavy use cases
- Lightweight product thinking with zero setup required

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- GitHub REST API

## Run Locally

1. Clone or download the project.
2. Open `index.html` in a browser.
3. Search for any public GitHub username.

## Design Decisions

- No build step: the project opens directly in the browser, which keeps the setup friction close to zero.
- Live data: the analyzer uses GitHub's public REST API rather than mocked data, so the experience stays grounded in real profiles.
- Clear synthesis over raw output: the interface emphasizes summaries, top signals, and public traction rather than dumping API responses.
- Shareable state: the selected username is stored in the URL for easy linking and repeatable demos.

## Repo Structure

```text
.
|-- index.html
|-- styles.css
|-- app.js
|-- README.md
`-- .gitignore
```

## Next Improvements

- Add a saved comparison view for two GitHub profiles
- Add a small chart for repo activity over time
- Add GitHub Pages deployment for a public live demo

## Notes

- The app only analyzes public GitHub data.
- Anonymous GitHub API requests may be rate-limited.
- Results depend on the profile data GitHub exposes publicly.
