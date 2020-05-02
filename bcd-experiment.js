'use strict';

const assert = require('assert');
const bcd = require('mdn-browser-compat-data');
const fetch = require('node-fetch');
const fs = require('fs');
const flags = require('flags');
const Git = require('nodegit');
const lib = require('./lib');

// Ideas for improvements:
//   - properly strip the browser_version to one supported by BCD.
//       - For Chrome and Firefox this is trivial, but Safari is a little tricky.
//       - Need to determine - is this actually desirable?
//   - pay attention to the actual browser version reported in WPT and BCD
//       - the idea here is to answer questions of: if BCD claims support but
//         WPT doesn't, is the BCD data just from a newer version?
//   - do a smarter approach where we get both the stable and experimental runs
//     at once, and cross-compare.
//       - the idea here is to answer questions of: if BCD claims support but
//         stable doesn't, is it just an experimental feature?
//   - save which test/subtest contributed a particular piece of information,
//     and provide that as optional extra logging.
//       - the idea here is to answer the question of 'WPT and BCD disagree,
//         what test should I be looking at?'

flags.defineString('browser', 'chrome',
    'Browser to lookup. Must match the products used on wpt.fyi');
// TODO: We could do a smarter approach where we get both the stable and
// the experimental data, and cross-compare.
flags.defineBoolean('experimental', false,
    'Calculate BCD data for experimental version.');
flags.parse();

const RUNS_URI = 'https://wpt.fyi/api/runs?max-count=1';

// Fetches a run from the wpt.fyi server. If |experimental| is true fetch
// experimental runs, else stable runs.
async function fetchRunFromServer(product, experimental) {
  const label = experimental ? 'experimental' : 'stable';
  const params = `&label=master&label=${label}&product=${product}`;
  const runsUri = `${RUNS_URI}${params}`;

  const response = await fetch(runsUri);
  const runs = await response.json();
  assert(runs.length == 1);

  return runs[0];
}

const INTERFACE_REGEX = /^([A-Za-z]+) interface: existence and properties of interface object$/;
const ATTRIBUTE_REGEX = /^([A-Za-z]+) interface: attribute ([A-Za-z]+)$/;
const OPERATION_REGEX = /^([A-Za-z]+) interface: operation ([A-Za-z]+)\(.*$/;

async function main() {
  const repo = await Git.Repository.open('wpt-results.git');

  const browser = flags.get('browser');
  const experimental = flags.get('experimental');
  const run = await fetchRunFromServer(browser, experimental);
  const browser_version = run.browser_version;

  console.log(`Comparing WPT and BCD data for ${browser}, version: ` +
      `${browser_version} (experimental flags ? ${experimental})\n`);

  // Verify that we have data for the fetched run in the wpt-results repo.
  const localRunIds = await lib.results.getLocalRunIds(repo);
  if (!localRunIds.has(run.id)) {
    throw new Error(`Missing data for run ${run.id}. ` +
        'Try running "git fetch --all --tags" in wpt-results/');
  }

  // Just in case someone ever adds a 'tree' field to the JSON.
  if (run.tree) {
    throw new Error('Run JSON contains "tree" field; code needs changed.');
  }
  run.tree = await lib.results.getGitTree(repo, run);

  // Walk the results, computing the interface map.
  console.log(`Checking WPT results data.`);
  console.log('----------------------\n');
  const interfaces = new Map();
  lib.results.walkTests(run.tree, (path, test, results) => {
    // We are only examining idlharness tests.
    if (!test.startsWith('idlharness')) {
      return;
    }

    // Bad data; skip.
    if (!results || !results.subtests || results.subtests.length == 0) {
      return;
    }

    // Otherwise, look at each subtest and try to match it to a known state.
    for (const subtest of results.subtests) {
      // Ignore errors + timeouts.
      if (subtest.status != 'PASS' && subtest.status != 'FAIL') {
        continue;
      }

      // bcd records data as either supported-at-a-version, false, or null (for
      // unknown).
      const supported = subtest.status == 'PASS' ? browser_version : false;

      // Check for interface support.
      const interface_match = subtest.name.match(INTERFACE_REGEX);
      if (interface_match) {
        const interface_name = interface_match[1];
        if (!interfaces.has(interface_name)) {
          interfaces.set(interface_name, { features: new Map() });
        }

        // If 'supported' is already set, this is likely a multi-global test.
        // Warn if the supported status is inconsistent.
        if (interfaces.get(interface_name).supported != undefined &&
            interfaces.get(interface_name).supported != supported) {
          console.log(`${interface_name}: inconsistent support information.`);
          continue;
        }
        interfaces.get(interface_name).supported = supported;

        // Finished with this subtest.
        continue;
      }

      // Check for attribute and operation support.
      let feature_match = subtest.name.match(ATTRIBUTE_REGEX);
      if (!feature_match) {
        feature_match = subtest.name.match(OPERATION_REGEX);
      }

      if (feature_match) {
        const interface_name = feature_match[1];
        if (!interfaces.has(interface_name)) {
          interfaces.set(interface_name, { features: new Map() });
        }
        const interface_object = interfaces.get(interface_name);

        const feature_name = feature_match[2];
        if (!interface_object.features.has(feature_name)) {
          interface_object.features.set(feature_name, supported);
        }

        // Check for inconsistent results from multi-global tests.
        if (interface_object.features.get(feature_name) != supported) {
          console.log(`${interface_name}.${feature_name}: inconsistent support information.`);
          continue;
        }
      }
    }
  });

  // And now finally go check the BCD data.
  console.log('\n');
  console.log('Cross-comparing WPT to BCD.');
  console.log('----------------------\n');
  interfaces.forEach((value, key) => {
    if (!bcd.api[key]) {
      console.log(`MISSING-INTERFACE: ${key}`);
      return;
    }
    const interface_api = bcd.api[key];

    // Check the top-level interface.
    if (value.supported != undefined) {
      const bcd_data = interface_api.__compat.support[browser].version_added;
      if (bcd_data == null) {
        console.log(`ADD: api.${key}.__compat.support.${browser}.version_added ` +
            `would be set to ${value.supported}`);
      } else if (Boolean(bcd_data) != Boolean(value.supported)) {
        console.log(`MISMATCH: api.${key}.__compat.support.${browser}.version_added ` +
            `(${bcd_data}) does not match WPT (${value.supported})`);
      }
    }

    // Now check any features.
    value.features.forEach((feature_supported, feature_name) => {
      if (!interface_api[feature_name]) {
        console.log(`MISSING-FEATURE: ${key}.${feature_name}`);
        return;
      }

      const bcd_data = interface_api[feature_name].__compat.support[browser].version_added;
      if (bcd_data == null) {
        console.log(`ADD-DATA: api.${key}.${feature_name}.__compat.support.` +
            `${browser}.version_added would be set to ${feature_supported}`);
      } else if (Boolean(bcd_data) != Boolean(feature_supported)) {
        console.log(`MISMATCH: api.${key}.${feature_name}.__compat.support.` +
            `${browser}.version_added (${bcd_data}) does not match WPT (${feature_supported})`);
      }
    });
  });
}

main().catch(reason => {
  console.error(reason);
  process.exit(1);
});
