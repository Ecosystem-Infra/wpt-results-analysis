'use strict';

/**
 * Implements functionality to report on how many WPT tests fail only on one
 * browser (aka browser-specific failures).
 */

// Across runs of WPT, there is a lot of duplication of results. Since we store
// the results in a Git repository, lib/results.js is able to automatically
// de-duplicate identical sub-trees (directories) and blobs (test files), and
// assign them unique identitifers. We can then use those unique identifiers to
// cache score results for sets of sub-trees and tests that we see when scoring
// many browser runs.
//
// These caches map from collections of input sub-trees or input tests, to the
// score array created for them. Note that order is important; if we see the
// sub-trees '1-2-3' and cache a score array [a, b, c] for them, we *cannot*
// re-use [a, b, c] if we later see '3-2-1' (the array would be [c, b, a]
// then!). In theory one could do some clever work to re-order the score array
// in that case, but it's overkill; the naive caches here reduce the processing
// time from ~minute/year to ~3s/year on my desktop.
const treesScoreCache = new Map;
const testsScoreCache = new Map;

// A helper class providing an iterator-like interface to either an Object with
// enumerable properties, or an Array. Iterates in a sorted order determined by
// |comparatorFunc|.
//
// Note that this class mutates the input |arrOrObject|.
class IteratorHelper {
  constructor(arrOrObject, comparatorFunc) {
    this.currentIndex = 0;
    this.values = arrOrObject;

    if (Array.isArray(this.values)) {
      this.keys = null;
      this.maxIndex = this.values.length;
      this.values.sort(comparatorFunc);
    } else {
      this.keys = Object.keys(this.values);
      this.maxIndex = this.keys.length;
      this.keys.sort(comparatorFunc);
    }
  }

  hasNext() {
    return this.currentIndex < this.maxIndex;
  }

  next() {
    if (!this.hasNext()) {
      throw new Error('Cannot move next; out of values');
    }
    this.currentIndex++;
  }

  key() {
    if (this.keys === null) {
      throw new Error('Cannot get key of an Array iteration');
    }
    return this.keys[this.currentIndex];
  }

  value() {
    if (this.keys === null) {
      return this.values[this.currentIndex];
    }
    return this.values[this.key()];
  }
}

// Scores a particular WPT test for a set of browsers, returning an array of
// scores for each browser in the same order as |browserTests|.
function scoreTest(browserTests) {
  const cacheKey = browserTests.map(test => test.id).join('-');
  if (testsScoreCache.has(cacheKey)) {
    return testsScoreCache.get(cacheKey);
  }

  const scores = new Array(browserTests.length).fill(0);

  // Some WPT tests contain multiple 'subtests' (e.g. most testharness.js
  // tests), whilst others are just a single conceptual test (e.g. reftests).
  //
  // Tests without subtests are scored as a simple 0-or-1 for each failing
  // browser (0 if any other browser also fails, 1 if no other browser fails).
  // When there are subtests, we do a similar calculation per-subtest, but
  // normalize the results by the number of subtests in the test. This stops
  // tests with thousands of subtests from dominating the results.
  if (browserTests.every(t => !t.subtests || t.subtests.length == 0)) {
    const failed = [];
    for (let i = 0; i < browserTests.length; i++) {
      // TODO: Determine exact criteria for a BSF at a test level.
      if (browserTests[i].status !== 'PASS') {
        failed.push(i);
      }
    }

    if (failed.length == 1) {
      scores[failed[0]] += 1;
    }
  } else if (browserTests.every(t => t.subtests && t.subtests.length > 0)) {
    const comparator = (s1, s2) => s1.name.localeCompare(s2.name);
    const browserSubtests = browserTests.map(
        tests => new IteratorHelper(tests.subtests, comparator));

    // To avoid errors from summing small floats, we do a full count of
    // browser-specific subtest failures first, then divide by the number of
    // subtests later to get the score (see the note on normalization above).
    let denominator = 0;
    const counts = new Array(browserSubtests.length).fill(0);

    while (browserSubtests.every(subtests => subtests.hasNext())) {
      // We only consider subtests that have reports for all browsers. A browser
      // may be missing a result for a given subtest due to e.g. a timeout in an
      // earlier subtest, and it would be wrong to penalize it for that.
      const name = browserSubtests[0].value().name;
      if (browserSubtests.some(s => s.value().name != name)) {
        let smallestKey = name;
        let smallestIdx = 0;
        for (let i = 1; i < browserSubtests.length; i++) {
          if (browserSubtests[i].value().name < smallestKey) {
            smallestKey = browserSubtests[i].value().name;
            smallestIdx = i;
          }
        }
        browserSubtests[smallestIdx].next();
        continue;
      }

      // The iterators are all aligned at the same subtest, so score it!
      //
      // NOTE: There actually (rarely) exist distinct subtests with the same
      // name in the data, usually because of unprintable characters. This can
      // influence the result, as we will squash such subtests and may even
      // mismatch results (i.e. if some browser has results for one
      // duplicate-named subtest but not another).
      //
      // Overall the impact is minor; it at most affects a fraction of a single
      // test, so less than 1 point of the final score per affected test.
      denominator += 1;

      const failed = [];
      for (let i = 0; i < browserSubtests.length; i++) {
        // TODO: Determine exact criteria for a BSF at a subtest level.
        if (browserSubtests[i].value().status == 'FAIL') {
          failed.push(i);
        }
      }
      if (failed.length == 1) {
        counts[failed[0]] += 1;
      }

      browserSubtests.forEach(s => s.next());
    }

    if (denominator > 0) {
      for (let i = 0; i < counts.length; i++) {
        scores[i] += counts[i] / denominator;
      }
    }
  }

  testsScoreCache.set(cacheKey, scores);
  return scores;
}

// Walks a set of trees, one per browser, scoring them for browser-specific
// failures of tests in the trees.
function walkTrees(browserTrees) {
  const cacheKey = browserTrees.map(tree => tree.id).join('-');
  if (treesScoreCache.has(cacheKey)) {
    return treesScoreCache.get(cacheKey);
  }

  let scores = new Array(browserTrees.length).fill(0);

  // Sorting comparator to sort Object keys alphabetically.
  const keyComparator = (k1, k2) => k1.localeCompare(k2);

  // First deal with any tests that are at this level of the tree.
  const browserTests = browserTrees.map(
      tree => new IteratorHelper(tree.tests, keyComparator));
  // As we are dealing with the intersection of tests between browsers, we are
  // done once we have exhausted all tests from some browser (leftover tests in
  // other browsers don't matter).
  while (browserTests.every(tests => tests.hasNext())) {
    // If the tests are all the same blob (which happens due to the caching in
    // lib/results.js), we can just skip them; it is impossible for there to be
    // browser-specific failures.
    if (browserTests.every(t => t.value() === browserTests[0].value())) {
      browserTests.forEach(t => t.next());
      continue;
    }

    // If we are looking at the same test across all browsers, but they aren't
    // the exact same objects, they need to be scored!
    if (browserTests.every(t => t.key() === browserTests[0].key())) {
      const testScores = scoreTest(browserTests.map(t => t.value()));
      scores = scores.map((v, i) => v + testScores[i]);
      browserTests.forEach(t => t.next());
      continue;
    }

    // Our iterators are not pointing at the same test; find the earliest
    // iterator and move it forward.
    let smallestKey = browserTests[0].key();
    let smallestIdx = 0;
    for (let i = 1; i < browserTests.length; i++) {
      if (browserTests[i].key() < smallestKey) {
        smallestKey = browserTests[i].key();
        smallestIdx = i;
      }
    }
    browserTests[smallestIdx].next();
  }

  // Now recurse into subtrees.
  const browserSubtrees = browserTrees.map(
      tree => new IteratorHelper(tree.trees, keyComparator));
  while (browserSubtrees.every(subtree => subtree.hasNext())) {
    // If the subtrees are all the same object (which happens due to the caching
    // in lib/results.js), we can just skip them; it is impossible for there to
    // be browser-specific failures in the subtree.
    if (browserSubtrees.every(s => s.value() === browserSubtrees[0].value())) {
      browserSubtrees.forEach(s => s.next());
      continue;
    }

    if (browserSubtrees.every(s => s.key() == browserSubtrees[0].key())) {
      const subtreeScores = walkTrees(
          browserSubtrees.map(s => s.value()));
      scores = scores.map((v, i) => v + subtreeScores[i]);
      browserSubtrees.forEach(s => s.next());
      continue;
    }

    // Our iterators are not pointing at the same subtree; find the earliest
    // iterator and move it forward.
    let smallestKey = browserSubtrees[0].key();
    let smallestIdx = 0;
    for (let i = 1; i < browserSubtrees.length; i++) {
      if (browserSubtrees[i].key() < smallestKey) {
        smallestKey = browserSubtrees[i].key();
        smallestIdx = i;
      }
    }
    browserSubtrees[smallestIdx].next();
  }

  treesScoreCache.set(cacheKey, scores);

  return scores;
}

// Produces a 'score' of browser-specific failures for a given set of runs from
// different products on the same WPT codebase. The word 'score' is used instead
// of count as we normalize the counts of subtests.
//
// runs: an array of run objects, where each run has the form:
//       {browser_name: "foo", tree: <an in-memory git tree>}
//
// expectedBrowsers: the set of browsers that should be (exactly) represented in
//                   runs. If a browser is missing, an exception will be thrown.
//
// Returns a map from product name to score.
function scoreBrowserSpecificFailures(runs, expectedBrowsers) {
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


  // Now do the actual walk to score the runs.
  const scores = walkTrees(runs.map(run => run.tree));
  return new Map(scores.map((score, i) => [runs[i].browser_name, score]));
}

module.exports = {scoreBrowserSpecificFailures};
