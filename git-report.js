'use strict';

const fs = require('fs');
const Git = require('nodegit');

async function writeReportToGit(report, repo) {
  // Create a tree of Treebuilders. When all the files have been written, this
  // tree is traversed depth first to write all of the trees.
  async function emptyTree() {
    const builder = await Git.Treebuilder.create(repo, null);
    return { builder, subtrees: new Map };
  }

  const rootTree = await emptyTree();

  async function getTree(dirs) {
    let tree = rootTree;
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      let subtree = tree.subtrees.get(dir);
      if (!subtree) {
        subtree = await emptyTree();
        tree.subtrees.set(dir, subtree);
      }
      tree = subtree;
    }
    return tree;
  }

  async function writeTree(tree) {
    for (const [dir, subtree] of tree.subtrees.entries()) {
      const oid = await writeTree(subtree);
      tree.builder.insert(dir, oid, Git.TreeEntry.FILEMODE.TREE);
    }
    return tree.builder.write();
  }

  for (const test of report.results) {
    // The keys that can appear for this object or on subtest object are:
    // ["duration", "expected", "message", "name", "status", "subtests", "test"]
    // Filter out:
    //  - "duration" which is different for every run
    //  - "expected" which will always be "PASS" or "OK" for wpt.fyi runs
    //  - "test" which is the test name, and would be represented elsewhere
    const json = JSON.stringify(test, ['message', 'name', 'status', 'subtests']);
    const buffer = Buffer.from(json);

    const blobId = await Git.Blob.createFromBuffer(repo, buffer, buffer.length);

    const path = test.test;
    // Complexity to handle /foo/bar/test.html?a/b, which isn't a test name
    // pattern used by any test, but also not prohibited by anything.
    const queryStart = path.indexOf('?');
    const lastSlash = path.lastIndexOf('/', queryStart >= 0 ? queryStart : path.length);
    const dirname = path.substr(0, lastSlash);
    const filename = path.substr(lastSlash + 1);

    const dirs = dirname.split('/').filter(d => d);

    const tree = await getTree(dirs);
    tree.builder.insert(`${filename}.json`, blobId, Git.TreeEntry.FILEMODE.BLOB);
  }

  const oid = await writeTree(rootTree);

  const signature = Git.Signature.now('autofoolip', 'auto@foolip.org');

  const commit = await repo.createCommit(null, signature, signature, 'commit message', oid, []);

  const tag = `tree-${oid.tostrS()}`
  try {
    await repo.createLightweightTag(commit, tag);
  } catch (e) {
    console.error(e);
  }
  return tag;
}

async function main() {
  let t0, t1;
  const reportFile = process.argv[2];
  const gitDir = process.argv[3];
  t0 = Date.now();
  const report = JSON.parse(fs.readFileSync(reportFile, 'UTF-8'));
  t1 = Date.now();
  console.log(`Parsing JSON took ${t1 - t0} ms`);

  t0 = Date.now();
  const repo = await Git.Repository.init(gitDir, 1);
  const tag = await writeReportToGit(report, repo);
  t1 = Date.now();
  console.log(`Writing to Git repo ${t1 - t0} ms`);
  console.log(`Wrote ${tag}`);
}

main();
