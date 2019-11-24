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

  let before = moment();
  for (const line of lines) {
    if (!line) continue;

    // edge,79.0.309.7,2019-10-31T22:26:51.99Z,2019-11-01T00:34:26.568Z,f35d1c48af,run/321670007/results
    const parts = line.split(',');
    if (parts.length != 6) {
      throw new Error(`Unable to parse line: ${line}`);
    }

    let browserName = parts[0];
    let browserVersion = parts[1];
    let startTime = parts[2];
    let endTime = parts[3];
    let sha = parts[4];
    let run = parts[5];

    if (!startTime.startsWith('2017')) {
      continue;
    }

    let commit = await repo.getReferenceCommit(run);
    let diffList = await commit.getDiff();
    if (diffList.length != 1) {
      throw new Error(`${run} has diffList of length ${diffList.length} (expected 1)`);
    }

    // This is the slow bit. Takes about a second per run.
    let stats = await diffList[0].getStats();
    let insertions = stats.insertions();

    // 2017 runs have a little over 24k subtests.
    if (insertions >= 24000) {
      console.log(`${run.split('/')[1]}`);
    }

    //console.log(`${run} (${startTime.substring(0, 10)}) has ${insertions} insertions`);
  }
  let after = moment();
  console.log(`Processed ${lines.length} runs in ${after - before}ms`);
}

main().catch(reason => {
  console.error(reason);
  process.exit(1);
});
