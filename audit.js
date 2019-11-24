'use strict';

/**
 * Lists runs which do not have any of the three 'base' labels - master,
 * pr_base, or pr_head. Such runs should be categorized into one of those three
 * accordingly.
 */

const lib = require('./lib');

async function main() {
  const runs = await lib.runs.getAll();

  for (const run of runs) {
    const labels = new Set(run.labels);
    if (!labels.has('master') && !labels.has('pr_base') && !labels.has('pr_head')) {
      console.log(`${run.browser_name},${run.browser_version},${run.time_start},${run.time_end},${run.revision},run/${run.id}/results`);
    }
  }
}

main().catch(reason => {
  console.error(reason);
  process.exit(1);
});
