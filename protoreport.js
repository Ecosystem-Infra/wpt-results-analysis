'use strict';

const flags = require('flags');
const fs = require('fs');

const wpt = require('./lib/wpt_pb');

flags.defineString('report-file', [], 'path to report.json file');
flags.parse();

const reportFile = flags.get('report-file');
const reportObject = JSON.parse(fs.readFileSync(reportFile, 'UTF-8'));

function benchmark(description, callback) {
    const before = Date.now();
    callback();
    const after = Date.now();
    console.log(`${description} took ${after - before} ms`);
}

const smallFile = reportFile.replace('.json', '.small.json');
//fs.writeFileSync(smallFile, JSON.stringify(reportObject, ["message", "name", "results", "status", "subtests"]));
/*
benchmark('JSON load+parse', () => {
    const report = JSON.parse(fs.readFileSync(smallFile, 'UTF-8'));
    console.log(process.memoryUsage());
});
*/
benchmark('PB load+parse', () => {
    const bytes = fs.readFileSync('chrome.bin');
    //console.log(bytes.length);
    const report = wpt.Report.deserializeBinary(bytes);
    console.log(process.memoryUsage());
});

process.exit();

const rootTree = new wpt.Tree;

for (const testObject of reportObject.results) {
    const path = testObject.test;

    const test = new wpt.Test;

    const status = wpt.Test.Status[testObject.status];
    if (status === undefined) {
        throw new Error(`${path}: invalid test status: ${testObject.status}`);
    }
    test.setStatus(status);
    test.setMessage(testObject.message);
    const subtestsArray = testObject.subtests;
    if (subtestsArray) {
        const subtests = subtestsArray.map(subtestObject => {
            const subtest = new wpt.Subtest;
            const subtestStatus = wpt.Subtest.Status[subtestObject.status];
            if (subtestStatus === undefined) {
                throw new Error(`${path}: invalid subtest status: ${subtestObject.status}`);
            }
            subtest.setName(subtestObject.name);
            subtest.setStatus(subtestStatus);
            subtest.setMessage(subtestObject.message);
            return subtest;
        });
        test.setSubtestsList(subtests);
    }

    //console.log(path);
    const pathParts = path.split('/').filter(d => d);
    let tree = rootTree;
    for (let i = 0; i < pathParts.length - 1; i++) {
        const dir = pathParts[i];
        const subtrees = tree.getSubtreesMap();
        let subtree = subtrees.get(dir);
        if (!subtree) {
            subtree = new wpt.Tree;
            subtrees.set(dir, subtree);
        }
        tree = subtree;
    }

    const lastPathPart = pathParts[pathParts.length - 1];
    tree.getTestsMap().set(lastPathPart, test);
}

const report = new wpt.Report;
report.setResults(rootTree);
// TODO: run_info

const binFile = reportFile.replace('.json', '.bin');
let bytes = report.serializeBinary();
fs.writeFileSync(binFile, bytes);

function walkTree(tree, path, visitor) {
    for (const [name, subtree] of tree.getSubtreesMap().entries()) {
        walkTree(subtree, `${path}/${name}`, visitor);
    }
    for (const [name, test] of tree.getTestsMap().entries()) {
        visitor(`${path}/${name}`, test);
    }
}

function readBack(binFile) {
    const bytes = fs.readFileSync(binFile);
    //console.log(bytes.length);
    const report = wpt.Report.deserializeBinary(bytes);
    walkTree(report.getResults(), '', (name, test) => {
        console.log(`${name}: ${test.getStatus()}`);
        for (const subtest of test.getSubtestsList()) {
            console.log(`  ${subtest.getName()}: ${subtest.getStatus()}`);
        }
    });
}

readBack(binFile);
