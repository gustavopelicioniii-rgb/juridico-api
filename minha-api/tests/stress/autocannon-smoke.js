/**
 * Autocannon smoke test — verifica saúde rápida do health-check
 * Uso: node tests/stress/autocannon-smoke.js
 *
 * Requer: npm install -g autocannon
 */
'use strict';

const autocannon = require('autocannon');

const url = process.env.BASE_URL || 'http://localhost:3000';

const instance = autocannon(
  {
    url: `${url}/health`,
    connections: 50,
    duration: 30,
    pipelining: 1,
    workers: 2,
  },
  (err, result) => {
    if (err) {
      console.error('autocannon error:', err);
      process.exit(1);
    }
    console.log('=== Autocannon /health summary ===');
    console.log(`Reqs/sec   : ${result.requests.average.toFixed(0)}`);
    console.log(`Latency p50: ${result.latency.p50.toFixed(1)} ms`);
    console.log(`Latency p95: ${result.latency.p95.toFixed(1)} ms`);
    console.log(`Latency p99: ${result.latency.p99.toFixed(1)} ms`);
    console.log(`Errors     : ${result.errors}`);
    console.log(`Timeouts   : ${result.timeouts}`);
    console.log(`Non-2xx    : ${result.non2xx}`);
  }
);

autocannon.track(instance, { renderProgressBar: true });
