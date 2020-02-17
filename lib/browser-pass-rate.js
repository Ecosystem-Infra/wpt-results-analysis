'use strict';

/**
 * Implements functionality to report on how many WPT tests pass.
 */

// Across runs of WPT, there is a lot of duplication of results. Since we store
// the results in a Git repository, lib/results.js is able to automatically
// de-duplicate identical sub-trees (directories) and blobs (test files), and
// assign them unique identitifers. We can then use those unique identifiers to
// cache score results for sub-trees and tests that we see when scoring browser
// runs.
const treeScoreCache = new Map;
const testScoreCache = new Map;

// Scores a WPT test that contains subtests.
//
// Each subtest is scored either 0 or 1 based on whether it passes or not.  We
// then normalize the subtest scores such that the worst possible score for a
// given test would be '1', to avoid tests with thousands of subtests from
// overwhelming the results.
function scoreSubtests(test) {
  // To avoid errors from summing small floats, we do a full count of subtest
  // passes first, then divide by the number of subtests later to get the score
  // (see the note on normalization above).
  let count = 0;
  let denominator = 0;

  for (const subtest of test.subtests) {
    count += subtest.status == 'PASS' ? 1 : 0;
    denominator += 1;
  }

  if (denominator == 0) {
    return 0;
  }
  return count / denominator;
}

// Scores a particular WPT test.
function scoreTest(test) {
  if (testScoreCache.has(test.id)) {
    return testScoreCache.get(test.id);
  }


  // Some WPT tests contain multiple 'subtests' (e.g. most testharness.js
  // tests), whilst others are just a single conceptual test (e.g. reftests).
  let score = (test.subtests && test.subtests.length > 0) ?
    scoreSubtests(test) :
    test.status == 'PASS' ? 1 : 0;

  testScoreCache.set(test.id, score);

  return score;
}

// Walks a tree and scores it.
function walkTree(tree) {
  if (treeScoreCache.has(tree.id)) {
    return treeScoreCache.get(tree.id);
  }

  let score = 0;
  for (const testName in tree.tests) {
    score += scoreTest(tree.tests[testName]);
  }

  for (const subtreeName in tree.trees) {
    score += walkTree(tree.trees[subtreeName]);
  }

  treeScoreCache.set(tree.id, score);

  return score;
}

// TODO: Describe
//
// runs: an array of run objects, where each run has the form:
//       {browser_name: "foo", tree: <an in-memory git tree>}
//
// expectedBrowsers: the set of browsers that should be (exactly) represented in
//                   runs. If a browser is missing, an exception will be thrown.
//
// Returns a map from product name to score.
function scoreBrowserPassRates(runs, expectedBrowsers) {
  // First, verify that the expected browsers are seen in |runs|.
  const seenBrowsers = new Set();
  for (const run of runs) {
    const browserName = run.browser_name;
    if (!expectedBrowsers.has(browserName)) {
      throw new Error(`Unexpected browser found in runs: ${browserName}`);
    }
    if (seenBrowsers.has(browserName)) {
      throw new Error(`${browserName} has multiple entries in runs`);
    }
    seenBrowsers.add(browserName);
  }
  // Browsers can only be added to seenBrowsers if they were already in
  // expectedBrowsers (see above), so the only remaining possible error is a
  // missing browser in the runs.
  if (seenBrowsers.size != expectedBrowsers.size) {
    const difference = [...expectedBrowsers].filter(x => !seenBrowsers.has(x));
    throw new Error(`Missing runs for browsers: ${difference.join(',')}`);
  }


  // Now do the actual walks to score the runs.
  const scores = runs.map(run => walkTree(run.tree));
  return new Map(scores.map((score, i) => [runs[i].browser_name, score]));
}

module.exports = {scoreBrowserPassRates};
