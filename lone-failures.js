'use strict';

const lib = {
  report: require('./lib/report.js'),
  runs: require('./lib/runs.js'),
};

const PRODUCTS = ['chrome', 'firefox', 'safari'];

const INCLUDE_EXPERIMENTAL_TARGET = true;

function isPass(result) {
  return result && (result.status === 'OK' || result.status === 'PASS');
}

function isFailure(result) {
  return result && (result.status === 'ERROR' || result.status === 'FAIL');
}

function isLoneFailure(targetResults, otherResults) {
  // The best definition isn't obvious. This one is conservative:
  return targetResults.every(isFailure) && otherResults.every(isPass);
}

function checkProduct(p) {
  if (!PRODUCTS.includes(p)) {
    throw new Error(`Unknown product: ${p}`);
  }
  return p;
}

async function main() {
  if (process.argv.length < 3) {
    console.log(`Usage: node --max-old-space-size=2048 lone-failures.js [product]`);
    return;
  }
  const targetProduct = checkProduct(process.argv[2]);

  const products = [];
  for (const product of PRODUCTS) {
    products.push(`${product}[stable]`);

    if (INCLUDE_EXPERIMENTAL_TARGET && product === targetProduct) {
      // Also include an experimental run to avoid listing things that have
      // already been fixed. As a side effect, this will remove some flaky
      // failures.
      products.push(`${product}[experimental]`);
    }
  }

  const runs = await lib.runs.get({
    products,
    label: 'master',
    aligned: true,
  });

  // needs a lot of memory: use --max-old-space-size=2048
  const reports = await Promise.all(runs.map(run => {
    return lib.report.fetch(run, { convertToMap: true });
  }));

  let alignedSha;
  console.log('Using these runs:')
  for (const [i, report] of reports.entries()) {
    const product = report.run_info.product;
    const version = report.run_info.browser_version;
    const sha = report.run_info.revision.substr(0,10);
    if (alignedSha === undefined) {
      alignedSha = sha;
    } else if (alignedSha !== sha) {
      throw new Error(`Expected aligned runs but got ${alignedSha} != ${sha}`);
    }
    const results = report.results;
    console.log(`* [${product} ${version} @${sha}](https://wpt.fyi/results/?run_id=${runs[i].id}): ${results.size} tests`);
  }
  console.log();

  console.log(`${targetProduct}-only failures:`);
  const targets = reports.filter(r => r.run_info.product === targetProduct);
  const others = reports.filter(r => r.run_info.product !== targetProduct);
  for (const [test, result] of single.results.entries()) {
    const otherResults = others.map(report => {
      return report.results.get(test) || null;
    });

    let hasLoneFailure = false;

    // test-level lone failures
    if (isLoneFailure(result, otherResults)) {
      hasLoneFailure = true;
    }

    // subtest-level lone failures
    for (const [subtest, subresult] of result.subtests.entries()) {
      const otherSubresults = otherResults.map(result => {
        return result && result.subtests.get(subtest) || null;
      });

      if (isLoneFailure(subresult, otherSubresults)) {
        hasLoneFailure = true;
        break;
      }
    }

    if (hasLoneFailure) {
      console.log(`* [${test}](https://wpt.fyi/results${test.replace('?', '%3F')}?${runs.map(run => `run_id=${run.id}`).join('&')})`);
    }
  }
}

main();
