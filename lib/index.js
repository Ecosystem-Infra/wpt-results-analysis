'use strict';

const browserPassRate = require('./browser-pass-rate');
const browserSpecific = require('./browser-specific');
const metrics = require('./metrics');
const report = require('./report');
const results = require('./results');
const runs = require('./runs');

module.exports = { browserPassRate, browserSpecific, metrics, report, results, runs };
