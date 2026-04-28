// k6 stress test — sobe carga até quebrar.
// Identifica capacidade máxima e ponto de saturação.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const errorRate = new Rate('app_error_rate');
const lat = new Trend('app_latency', true);

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '2m', target: 500 },
        { duration: '2m', target: 800 },
        { duration: '2m', target: 1200 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Mais permissivos: o ponto é descobrir o limite
    http_req_failed: ['rate<0.20'],
    'app_latency': ['p(95)<3000'],
  },
};

export default function () {
  const pagina = 1 + Math.floor(Math.random() * 5);
  const res = http.get(`${BASE_URL}/api/v1/processos?pagina=${pagina}&limite=50`);
  lat.add(res.timings.duration);
  errorRate.add(!check(res, { 'status<500': (r) => r.status < 500 }));

  if (Math.random() < 0.1) {
    http.get(`${BASE_URL}/api/v1/tribunais`);
  }
  sleep(0.2);
}

export function handleSummary(data) {
  return {
    'reports/stress-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const get = (k) => (m[k] && m[k].values) || {};
  const dur = get('http_req_duration');
  const fail = get('http_req_failed');
  return `
=== Stress Summary ===
Total reqs   : ${(get('http_reqs').count || 0).toFixed(0)}
Fail rate    : ${((fail.rate || 0) * 100).toFixed(2)}%
Latency p50  : ${(dur['p(50)'] || 0).toFixed(1)} ms
Latency p95  : ${(dur['p(95)'] || 0).toFixed(1)} ms
Latency p99  : ${(dur['p(99)'] || 0).toFixed(1)} ms
Latency max  : ${(dur.max || 0).toFixed(1)} ms
======================
`;
}
