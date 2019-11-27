'use strict';

/**
 * Attempts to identify untagged master runs (from a list supplied by audit.js),
 * by examining how many files the run touched.
 */

const fs = require('fs');
const Git = require('nodegit');
const moment = require('moment');

async function main() {
  // bare clone of https://github.com/foolip/wpt-results
  const repo = await Git.Repository.init('wpt-results.git', 1);

  let data = await fs.promises.readFile('tagless-runs.txt', 'utf-8');
  let lines = data.split('\n');

  let runs = [];
  let before = moment();
  for (const line of lines) {
    if (!line) continue;

    // Entries look like:
    // edge,79.0.309.7,2019-10-31T22:26:51.99Z,2019-11-01T00:34:26.568Z,f35d1c48af,run/321670007/results
    const parts = line.split(',');
    if (parts.length != 6) {
      throw new Error(`Unable to parse line: ${line}`);
    }

    let run = {
      browserName: parts[0],
      browserVersion: parts[1],
      startTime: parts[2],
      endTime: parts[3],
      sha: parts[4],
      tag: parts[5],
    };

    // Filter for only 2017.
    if (!run.startTime.startsWith('2017')) {
      continue;
    }

    let commit = await repo.getReferenceCommit(run.tag);
    let diffList = await commit.getDiff();
    if (diffList.length != 1) {
      throw new Error(`${run} has diffList of length ${diffList.length} (expected 1)`);
    }

    // This is the slow bit. Takes about a second per run.
    let stats = await diffList[0].getStats();
    run.insertions = stats.insertions();

    runs.push(run);
  }

  // Now sort them by insertions (descending).
  runs.sort((runA, runB) => {
    // If runB has more insertions, this is positive and so will sort runB to
    // come before runA.
    return runB.insertions - runA.insertions;
  });

  let run_ids = [];
  for (const run of runs) {
    console.log(`${run.tag} (${run.browserName} ${run.browserVersion}, ${run.startTime.substring(0, 10)}, ${run.sha}) has ${run.insertions} insertions`);
    // 2017 runs have a little over 24k subtests.
    if (run.insertions >= 24000) {
      run_ids.push(run.tag.split('/')[1]);
    }
  }

  let after = moment();
  console.log(`Processed ${lines.length} runs in ${after - before}ms`);

  let output = 'should_be_master_run_ids_2017.txt';
  console.log(`Writing to ${output}`);
  await fs.promises.writeFile(output, run_ids.join('\n'), 'utf-8');
}

main().catch(reason => {
  console.error(reason);
  process.exit(1);
});
