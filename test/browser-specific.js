'use strict';

var assert = require('chai').assert,
    browserSpecific = require('../lib/browser-specific');

function createEmptyTree() {
  return {
    trees: {},
    tests: {},
  };
}

let uniqueId = 0;

class TreeBuilder {
  constructor() {
    this.root = createEmptyTree();
  }

  build() {
    // Time to add all the unique ids.
    function addUniqueIds(node) {
      node.id = uniqueId++;

      for (let name in node.tests) {
        node.tests[name].id = uniqueId++;
      }
      for (let dir in node.trees) {
        addUniqueIds(node.trees[dir]);
      }
    }

    addUniqueIds(this.root);
    return this.root;
  }

  // Add a test with a given status to the tree. The path parameter is
  // interpreted as a directory path and subtrees are created as necessary.
  addTest(path, status) {
    let currentNode = this.root;
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

    return this;
  }

  // Add a subtest with a given status to the tree. The test object must already
  // have been created; a subtest array will be created if necessary.
  addSubtest(testPath, subtest, status) {
    let currentNode = this.root;
    let testParts = testPath.split('/');
    for (let i = 0; i < testParts.length - 1; i++) {
      currentNode = currentNode.trees[testParts[i]];
    }

    const testName = testParts[testParts.length - 1];
    let test = currentNode.tests[testName];
    if (test.subtests === undefined)
      test.subtests = [];
    test.subtests.push({ name: subtest, status });

    return this;
  }
}

describe('browser-specific.js', () => {
  describe('Browser Validation', () => {
    it('should not throw if the browser list is correct', () => {
      let runs = [
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
          { browser_name: 'firefox', tree: new TreeBuilder().build() },
      ];
      let expectedBrowsers = new Set(['chrome', 'firefox']);
      assert.doesNotThrow(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });
    });

    it('should throw if an expected browser is missing', () => {
      let runs = [];
      let expectedBrowsers = new Set(['chrome', 'firefox']);
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });

      runs = [
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
          { browser_name: 'firefox', tree: new TreeBuilder().build() },
      ];
      expectedBrowsers = new Set(['chrome', 'firefox', 'safari']);
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });
    });

    it('should throw if an unexpected browser is present', () => {
      let runs = [
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
          { browser_name: 'firefox', tree: new TreeBuilder().build() },
      ];
      let expectedBrowsers = new Set;
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });

      runs = [
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
          { browser_name: 'firefox', tree: new TreeBuilder().build() },
          { browser_name: 'safari', tree: new TreeBuilder().build() },
      ];
      expectedBrowsers = new Set(['chrome', 'firefox']);
      assert.throws(() => {
        browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      });
    });

    it('should throw if there are duplicate browsers', () => {
      let runs = [
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
          { browser_name: 'firefox', tree: new TreeBuilder().build() },
          { browser_name: 'chrome', tree: new TreeBuilder().build() },
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

      // A basic case; test passes in Chrome but fails in Firefox.
      let chromeTree = new TreeBuilder().addTest('TestA', 'PASS').build();
      let firefoxTree = new TreeBuilder().addTest('TestA', 'FAIL').build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 1]]));

      // At the test level, we check for !pass, so count timeouts as failures.
      // TODO: Determine exact criteria for a BSF at a test level.
      chromeTree = new TreeBuilder().addTest('TestB', 'TIMEOUT').build();
      firefoxTree = new TreeBuilder().addTest('TestB', 'PASS').build();
      runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 1], ['firefox', 0]]));
    });

    it('should traverse subtrees correctly', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = new TreeBuilder().addTest('a/b/TestA', 'FAIL').build();
      let firefoxTree = new TreeBuilder().addTest('a/b/TestA', 'PASS').build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 1], ['firefox', 0]]));
    });

    it('should normalize subtests correctly', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      let chromeTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'PASS')
          .addSubtest('TestA', 'test 2', 'PASS')
          .addSubtest('TestA', 'test 3', 'FAIL')
          .addSubtest('TestA', 'test 4', 'PASS')
          .build();
      let firefoxTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'FAIL')
          .addSubtest('TestA', 'test 2', 'FAIL')
          .addSubtest('TestA', 'test 3', 'PASS')
          .addSubtest('TestA', 'test 4', 'PASS')
          .build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      // 1/4 subtests are Chrome-only failures, and 2/4 subtests are
      // Firefox-only failures.
      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0.25], ['firefox', 0.5]]));

      // At the subtest level we check for exactly 'fail', so timeouts are
      // considered passes.
      // TODO: Determine exact criteria for a BSF at a subtest level.
      chromeTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'TIMEOUT')
          .addSubtest('TestA', 'test 2', 'TIMEOUT')
          .build();
      firefoxTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'PASS')
          .addSubtest('TestA', 'test 2', 'FAIL')
          .build();
      runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];
      scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0.5]]));
    });

    it('should ignore tests that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      // If a test doesn't exist in all browsers, it never counts for
      // browser-specific failures.
      let chromeTree = new TreeBuilder()
          .addTest('TestA', 'FAIL')
          .addTest('TestB', 'PASS')
          .build();
      let firefoxTree = new TreeBuilder()
          .addTest('TestB', 'PASS')
          .addTest('TestC', 'PASS')
          .build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });

    it('should ignore subtrees that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      // If a subtree doesn't exist in all browsers, it is just ignored.
      let chromeTree = new TreeBuilder()
          .addTest('a/b/c/TestA', 'FAIL')
          .addTest('d/e/f/TestB', 'PASS')
          .build();
      let firefoxTree = new TreeBuilder()
          .addTest('d/e/f/TestB', 'PASS')
          .addTest('g/h/i/TestA', 'PASS')
          .build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });

    it('should ignore subtests that arent in all browsers', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      // Subtests that aren't in some browser do not count for browser-specific
      // failures; this includes not be counted for the denominator.
      let chromeTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'FAIL')
          .addSubtest('TestA', 'test 2', 'FAIL')
          .addSubtest('TestA', 'test 3', 'PASS')
          .build();
      let firefoxTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 2', 'PASS')
          .addSubtest('TestA', 'test 3', 'PASS')
          .addSubtest('TestA', 'test 4', 'PASS')
          .addSubtest('TestA', 'test 5', 'PASS')
          .build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0.5], ['firefox', 0]]));
    });

    it('should handle the case where one browser has no subtests for a test', () => {
      const expectedBrowsers = new Set(['chrome', 'firefox']);

      // In this case, Chrome ran the test and had a harness error, so has no
      // subtests. Firefox did find subtests. When one or more browsers have
      // subtests for a given test, but some browsers don't, we ignore the test
      // entirely.
      let chromeTree = new TreeBuilder().addTest('TestA', 'ERROR').build();
      let firefoxTree = new TreeBuilder()
          .addTest('TestA', 'OK')
          .addSubtest('TestA', 'test 1', 'PASS')
          .addSubtest('TestA', 'test 2', 'FAIL')
          .addSubtest('TestA', 'test 3', 'PASS')
          .build();
      let runs = [
          { browser_name: 'chrome', tree: chromeTree },
          { browser_name: 'firefox', tree: firefoxTree },
      ];

      let scores = browserSpecific.scoreBrowserSpecificFailures(runs, expectedBrowsers);
      assert.deepEqual(scores, new Map([['chrome', 0], ['firefox', 0]]));
    });
  });
});
