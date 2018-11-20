'use strict';

const fetch = require('node-fetch');
const Git = require('nodegit');

/*
// Oids are 160 bit (20 byte) SHA-1 hashes. The hex strings would take
// >=80 bytes of memory. Convert them to strings of length 10 with 16
// bits used per code points, which can be used as Object/Map keys.
function shaToKey(sha) {
  return sha.replace(/.{4}/g, chars => {
    return String.fromCharCode(parseInt(chars, 16));
  });
}

function oidToKey(oid) {
  return shaToKey(oid.tostrS());
}
*/

function oidToKey(oid) {
  return oid.tostrS();
}

const resultsCache = new Map;

async function queryGit(repo, tree) {
  let resolve, reject;
  const walkDone = new Promise((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });

  const walker = tree.walk(true);

  const ops = [];

  let counter = 0;
  walker.on('entry', entry => {
    if (!entry.isBlob()) {
      reject(new TypeError('y not blob?'));
    }

    const path = entry.path();
    if (!path.endsWith('.json')) {
      reject(new Error('y not json?'));
    }

    function callback(results) {
      if (results.status === 'FAIL') {
        counter++;
      }
    }

    const resultsKey = entry.id().tostrS();
    const results = resultsCache.get(resultsKey);
    if (results) {
      callback(results);
      return;
    }

    // need to do async read of results from blob
    ops.push(entry.getBlob().then(blob => {
      const buffer = blob.content();
      const results = JSON.parse(buffer);
      resultsCache.set(resultsKey, results);
      callback(results);
    }));
  });

  walker.on('end', resolve);
  walker.on('error', reject);

  walker.start();

  await walkDone;
  await Promise.all(ops);
  return counter;
}

// Map from oid to { "trees": { ... }, "tests": { ... } } objects.
const treeCache = {};
// Map from oid to { "status": "OK", ... } objects.
const testCache = {};

// Read a Git.Tree fully into memory.
async function readTree(treeOrEntry) {
  let tree, entry, oid;
  if (treeOrEntry instanceof Git.Tree) {
    tree = treeOrEntry;
    oid = tree.id();
  } else {
    if (!(treeOrEntry instanceof Git.TreeEntry) || !treeOrEntry.isTree()) {
      throw new TypeError('y no Tree or TreeEntry?');
    }
    entry = treeOrEntry;
    oid = entry.id();
  }

  const key = oidToKey(oid);

  const cachedTree = treeCache[key];
  if (cachedTree) {
    return cachedTree;
  }

  const newTree = {
    trees: {},
    tests: {},
  };

  if (!tree) {
    tree = await entry.getTree();
  }

  for (const entry of tree.entries()) {
    if (entry.isTree()) {
      newTree.trees[entry.name()] = await readTree(entry);
    } else if (entry.isBlob()) {
      let name = entry.name();
      if (!name.endsWith('.json')) {
        throw new Error('y not .json?');
      }
      name = name.substr(0, name.length - 5);
      newTree.tests[name] = await readResults(entry);
    } else {
      throw new TypeError('y not tree or blob?')
    }
  }

  treeCache[key] = newTree;
  return newTree;
}

async function readResults(entry) {
  if (!entry.isBlob()) {
    throw new TypeError('y no Blob?');
  }

  const key = oidToKey(entry.id());

  const cachedTest = testCache[key];
  if (cachedTest) {
    return cachedTest;
  }

  const blob = await entry.getBlob();
  const buffer = blob.content();
  const results = JSON.parse(buffer);

  testCache[key] = results;
  return results;
}

function queryTree(tree) {
  function walk(tree, visitor, path = '') {
    const subtrees = tree.trees;
    for (const name in subtrees) {
      const subtree = subtrees[name];
      walk(subtree, visitor, `${path}/${name}`);
    }

    const tests = tree.tests;
    for (const name in tests) {
      const results = tests[name];
      visitor(path, name, results);
    }
  }

  let counter = 0;
  walk(tree, (path, test, results) => {
    // count non-OK/PASS tests
    if (results.status !== 'OK' && results.status !== 'PASS') {
      counter++;
    }
    /*
    // look for non-unique subtests names
    if (results.subtests.length) {
      const names = new Set;
      for (const subtest of results.subtests) {
        names.add(subtest.name);
      }
      if (names.size !== results.subtests.length) {
        //console.log(`${path}/${test}`);
        counter++;
      }
    }
    */
  });
  return counter;
}

async function getAllRuns() {
  // TODO: make it all of them with pagination
  return (await fetch('https://wpt.fyi/api/runs?max-count=500')).json();
}

async function getAllLocalRuns(repo) {
  const refs = await repo.getReferences(Git.Reference.TYPE.OID);
  const tags = refs.filter(ref => ref.isTag());
  tags.sort();

  return tags.map(tag => {
    // format is refs/tags/run-6286849043595264
    const id = Number(tag.toString().split('-')[1]);
    // run info beyond id isn't available
    return { id };
  });
}

async function getExampleRuns() {
  return (await fetch('https://wpt.fyi/api/runs?label=experimental&sha=c1faeb4eb5')).json();
}

async function getGitTree(repo, run) {
  const commit = await repo.getReferenceCommit(`refs/tags/run-${run.id}`);
  const tree = await commit.getTree();
  return tree;
}

async function main() {
  // Checkout of https://github.com/foolip/wpt-results
  const repo = await Git.Repository.open('wpt-results');

  //const runs = await getExampleRuns();
  const RUN_LIMIT = Number(process.argv[2]);
  const runs = (await getAllLocalRuns(repo)).slice(0, RUN_LIMIT);

  console.log(`Found ${runs.length} runs`);

  // Fully parallel loading is slower than loading one run after the other
  // probably because it's I/O bound. Also uses more memory. But loading a few
  // in parallel might be faster than this:
  let t0 = Date.now();
  const trees = new Array(runs.length);
  for (const i in runs) {
    const run = runs[i];
    console.log(`Loading run ${run.id}`);
    const gitTree = await getGitTree(repo, run);
    trees[i] = await readTree(gitTree);
  }
  const loadTime = Date.now() - t0;
  console.log(`Loading ${runs.length} runs took ${loadTime} ms`);

  t0 = Date.now();
  for (const i in runs) {
    const run = runs[i];
    const tree = trees[i];
    console.log(`Querying run ${run.id}`);
    const result = queryTree(tree);
    console.log(result);
  }
  const queryTime = Date.now() - t0;
  console.log(`Querying ${runs.length} runs took ${queryTime} ms`);

  const treeCount = Object.keys(treeCache).length;
  const testCount = Object.keys(testCache).length;
  console.log(`${treeCount} trees in memory`);
  console.log(`${testCount} tests in memory`);

  if (global.gc) {
    global.gc();
  }
  const memory = process.memoryUsage();
  console.log(memory);

  // For copying into spreadsheet
  console.log(`${RUN_LIMIT}\t${loadTime}\t${queryTime}\t${treeCount}\t${testCount}\t${memory.rss}\t${memory.heapTotal}\t${memory.heapUsed}\t${memory.external}`);
}

main();
