'use strict';

var assert = require('chai').assert,
    browserSpecific = require('../lib/browser-specific');

function createEmptyTree() {
  return {
    trees: {},
    tests: {},
  };
}

// Helper function to add a test with a given status to a tree. The path is
// interpreted as a directory path and subtrees are created as necessary to
// reach the correct level.
function addTest(tree, path, status) {
  let currentNode = tree;
  let testParts = path.split('/');
  for (let i = 0; i < testParts.length - 1; i++) {
    const directoryName = testParts[i];
    if (!(directoryName in currentNode.trees))
      currentNode.trees[directoryName] = createEmptyTree();
    currentNode = currentNode.trees[directoryName];
  }

  const testName = testParts[testParts.length - 1];
  assert.doesNotHaveAnyKeys(
      currentNode.tests, testName, `tree already has a test at ${path}`);
  currentNode.tests[testName] = { status };
}

// Helper function to add a subtest with a given status to a tree. The test
// object must already have been created; a subtest array will be created if
// necessary.
function addSubtest(tree, testPath, subtest, status) {
  let currentNode = tree;
  let testParts = testPath.split('/');
  for (let i = 0; i < testParts.length - 1; i++) {
    currentNode = currentNode.trees[testParts[i]];
  }

  const testName = testParts[testParts.length - 1];
  let test = currentNode.tests[testName];
  if (test.subtests === undefined)
    test.subtests = [];
  test.subtests.push({ name: subtest, status });
}

describe('browser-specific.js', () => { describe('Browser Validation', () => {
  it('should not throw if the browser list is correct', () => { let runs = [ {
    browser_name: 'chrome', tree: createEmptyTree() }, { browser_name:
      'firefox', tree: createEmptyTree() }, ]; let expectedBrowsers = new
      Set(['chrome', 'firefox']); assert.doesNotThrow(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      }); });

    it('should throw if an expected browser is missing', () => { let runs = [];
      let expectedBrowsers = new Set(['chrome', 'firefox']); assert.throws(() =>
          { browserSpecific.scoreBrowserSpecificFailures(runs,
              expectedBrowsers); });

      runs = [ { browser_name: 'chrome', tree: createEmptyTree() }, {
        browser_name: 'firefox', tree: createEmptyTree() }, ]; expectedBrowsers
        = new Set(['chrome', 'firefox', 'safari']); assert.throws(() => {
          browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
        }); });

    it('should throw if an unexpected browser is present', () => { let runs = [
      { browser_name: 'chrome', tree: createEmptyTree() }, { browser_name:
                                                             'firefox', tree:
                                                                 createEmptyTree()
                                                           }, ]; let
      expectedBrowsers = new Set; assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });

      runs = [
          { browser_name: 'chrome', tree: createEmptyTree() },
          { browser_name: 'firefox', tree: createEmptyTree() },
          { browser_name: 'safari', tree: createEmptyTree() },
      ];
      expectedBrowsers = new Set(['chrome', 'firefox']);
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });
    });

    it('should throw if there are duplicate browsers', () => {
      let runs = [
          { browser_name: 'chrome', tree: createEmptyTree() },
          { browser_name: 'firefox', tree: createEmptyTree() },
          { browser_name: 'chrome', tree: createEmptyTree() },
      ];
      let expectedBrowsers = new Set(['chrome', 'firefox']);
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });
    });
  });

  describe('Scoring Runs', () => {
    it('should score top-level tests correctly', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      // A basic case; test passes in Chrome but fails in Firefox.
      addTest(chromeTree, 'TestA', 'PASS');
      addTest(firefoxTree, 'TestA', 'FAIL');
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 1]]));

      // At the test level, we check for !pass, so count timeouts as failures.
      // TODO: Determine exact criteria for a BSF at a test level.
      addTest(chromeTree, 'TestB', 'TIMEOUT');
      addTest(firefoxTree, 'TestB', 'PASS');
      scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 1], ['firefox', 1]]));
    });

    it('should traverse subtrees correctly', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      addTest(chromeTree, 'a/b/c/TestA', 'FAIL');
      addTest(firefoxTree, 'a/b/c/TestA', 'PASS');
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 1], ['firefox', 0]]));
    });

    it('should normalize subtests correctly', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      addTest(chromeTree, 'TestA', 'OK');
      addTest(firefoxTree, 'TestA', 'OK');

      addSubtest(chromeTree, 'TestA', 'test 1', 'PASS');
      addSubtest(chromeTree, 'TestA', 'test 2', 'PASS');
      addSubtest(chromeTree, 'TestA', 'test 3', 'FAIL');
      addSubtest(chromeTree, 'TestA', 'test 4', 'PASS');

      addSubtest(firefoxTree, 'TestA', 'test 1', 'FAIL');
      addSubtest(firefoxTree, 'TestA', 'test 2', 'FAIL');
      addSubtest(firefoxTree, 'TestA', 'test 3', 'PASS');
      addSubtest(firefoxTree, 'TestA', 'test 4', 'PASS');

      // 1/4 subtests are Chrome-only failures, and 2/4 subtests are
      // Firefox-only failures.
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0.25], ['firefox', 0.5]]));

      // At the subtest level we check for exactly 'fail', so timeouts are
      // considered passes.
      // TODO: Determine exact criteria for a BSF at a subtest level.
      addSubtest(chromeTree, 'TestA', 'test 5', 'TIMEOUT');
      addSubtest(firefoxTree, 'TestA', 'test 5', 'PASS');
      scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0.2], ['firefox', 0.4]]));
    });

    it('should ignore tests that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      // If a test doesn't exist in all browsers, it never counts for
      // browser-specific failures.
      addTest(chromeTree, 'TestA', 'FAIL');
      addTest(chromeTree, 'TestB', 'PASS');
      addTest(firefoxTree, 'TestB', 'PASS');
      addTest(firefoxTree, 'TestC', 'PASS');
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });

    it('should ignore subtrees that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      // If a subtree doesn't exist in all browsers, it is just ignored.
      addTest(chromeTree, 'a/b/c/TestA', 'FAIL');
      addTest(chromeTree, 'd/e/f/TestB', 'PASS');
      addTest(firefoxTree, 'd/e/f/TestB', 'PASS');
      addTest(firefoxTree, 'g/h/i/TestA', 'PASS');
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });

    it('should ignore subtests that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      addTest(chromeTree, 'TestA', 'OK');
      addTest(firefoxTree, 'TestA', 'OK');

      // Subtests that aren't in some browser do not count for browser-specific
      // failures; this includes not be counted for the denominator.
      addSubtest(chromeTree, 'TestA', 'test 1', 'FAIL');
      addSubtest(chromeTree, 'TestA', 'test 2', 'FAIL');
      addSubtest(chromeTree, 'TestA', 'test 3', 'PASS');

      addSubtest(firefoxTree, 'TestA', 'test 2', 'PASS');
      addSubtest(firefoxTree, 'TestA', 'test 3', 'PASS');
      addSubtest(firefoxTree, 'TestA', 'test 4', 'PASS');
      addSubtest(firefoxTree, 'TestA', 'test 5', 'PASS');

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0.5], ['firefox', 0]]));
    });

    it('should handle the case where one browser has no subtests for a test', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = createEmptyTree();
      let firefoxTree = createEmptyTree();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      // In this case, Chrome ran the test and had a harness error, so has no
      // subtests. Firefox did find subtests. When one or more browsers have
      // subtests for a given test, but some browsers don't, we ignore the test
      // entirely.
      addTest(chromeTree, 'TestA', 'ERROR');
      addTest(firefoxTree, 'TestA', 'OK');

      addSubtest(firefoxTree, 'TestA', 'test 1', 'PASS');
      addSubtest(firefoxTree, 'TestA', 'test 2', 'FAIL');
      addSubtest(firefoxTree, 'TestA', 'test 3', 'PASS');

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });
  });
});
