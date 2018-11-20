'use strict';

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

function keyToSha(key) {
  return key.replace(/./g, char => {
    let chars = char.charCodeAt(0).toString(16);
    while (chars.length < 4) {
      chars = '0' + chars;
    }
    return chars;
  });
}

function oidToKey(oid) {
  return shaToKey(oid.tostrS());
}

function keyToOid(key) {
  return Oid.fromString(keyToSha(key));
}
*/

const resultsCache = new Map;

async function query(repo, tree) {
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
      reject(new Error('y not blob?'));
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

async function main() {
  // Checkout of https://github.com/foolip/wpt-results
  const repo = await Git.Repository.open('wpt-results');

  const tags = (await repo.getReferences(Git.Reference.TYPE.OID))
  .filter(ref => ref.isTag());
  const runs = new Map(await Promise.all(tags.map(async tag => {
    // format is refs/tags/run-6286849043595264
    const runId = Number(tag.toString().split('-')[1]);
    const commitId = tag.target();
    const commit = await Git.Commit.lookup(repo, commitId);
    const tree = await commit.getTree();
    return [runId, tree];
  })));

  console.log(`Found ${runs.size} runs`);

  const RUNS_TO_QUERY = 10;
  let counter = 0;
  let t0, t1;
  t0 = Date.now();
  for (const [runId, tree] of runs.entries()) {
    if (counter++ === RUNS_TO_QUERY) {
      break;
    }
    console.log(`Querying run ${runId}`);
    const result = await query(repo, tree);
    console.log(result);
  }
  t1 = Date.now();
  console.log(`Querying ${RUNS_TO_QUERY} runs took ${t1 - t0} ms`);
  console.log(`${resultsCache.size} objects in cache`);
}

main();
