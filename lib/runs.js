'use strict';

const fetch = require('node-fetch');

// TODO use wpt.fyi after https://github.com/web-platform-tests/wpt.fyi/pull/772 is deployed.
const RUNS_API = 'https://master-dot-wptdashboard.appspot.com/api/runs';

async function* iterateRuns(options = {}) {
  const queryParts = Object.entries(options).map(([name, value]) => {
    return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  });
  queryParts.push('max-count=500');
  const query = queryParts.join('&');
  let url = `${RUNS_API}?${query}`;
  while (true) {
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error(`non-OK fetch status ${r.status}`);
    }
    let runs = await r.json();
    for (const run of runs) {
      yield run;
    }
    const token = r.headers.get('wpt-next-page');
    if (!token) {
      break;
    }
    url = `${RUNS_API}?page=${token}`;
  }
}

async function getRuns(options) {
  const runs = [];
  for await (const run of iterateRuns(options)) {
    runs.push(run);
  }

  // Sort runs by start time, most recent first. This is the order that the API
  // uses as well, but due to pagination it will not be strictly sorted.
  runs.sort((a, b) => {
    return Date.parse(b.time_start) - Date.parse(a.time_start);
  });

  return runs;
}

module.exports = { iterateRuns, getRuns };
