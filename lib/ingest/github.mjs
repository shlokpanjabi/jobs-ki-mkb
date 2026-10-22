// Community-maintained internship lists on GitHub. Fetched from
// raw.githubusercontent.com, which serves the files as-is.

/** @param {string} repo "owner/name" @param {string} branch @param {string} path */
export function rawGitHub(repo, branch, path) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
}

// The big lists keep listings "active" for months; only take recent ones so
// the board isn't flooded with stale roles. Raise to backfill more.
export const MAX_AGE_DAYS = 30;
