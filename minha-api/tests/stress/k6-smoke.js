// k6 smoke test — verifica saúde básica e contratos sob carga mínima
// Uso: k6 run tests/stress/k6-smoke.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const errorRate = new Rate('app_error_rate');
const tribunaisLatency = new Trend('lat_tribunais', true);
const healthLatency = new Trend('lat_health', true);
const processosLatency = new Trend('lat_processos', true);
const totalRequests = new Counter('total_requests');

export const options = {
  vus: 5,
  duration: '60s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'lat_health{tag:health}': ['p(95)<100'],
    'lat_tribunais{tag:tribunais}': ['p(95)<300'],
    'lat_processos{tag:processos}': ['p(95)<600'],
  },
};

export default function () {
  group('health', () => {
    const res = http.get(`${BASE_URL}/health`, { tags: { tag: 'health' } });
    healthLatency.add(res.timings.duration);
    totalRequests.add(1);
    const ok = check(res, {
      'status 200': (r) => r.status === 200,
      'has timestamp': (r) => !!r.json('timestamp'),
    });
    errorRate.add(!ok);
  });

  group('tribunais', () => {
    const res = http.get(`${BASE_URL}/api/v1/tribunais`, { tags: { tag: 'tribunais' } });
    tribunaisLatency.add(res.timings.duration);
    totalRequests.add(1);
    const ok = check(res, {
      'status 200': (r) => r.status === 200,
      'array tribunais': (r) => Array.isArray(r.json('tribunais')),
    });
    errorRate.add(!ok);
  });

  group('processos paginated', () => {
    const res = http.get(`${BASE_URL}/api/v1/processos?pagina=1&limite=20`, { tags: { tag: 'processos' } });
    processosLatency.add(res.timings.duration);
    totalRequests.add(1);
    const ok = check(res, {
      'status 200': (r) => r.status === 200,
      'has pagination': (r) => !!r.json('pagination'),
    });
    errorRate.add(!ok);
  });

  sleep(1);
}
