// k6 soak test — carga constante por 1h para detectar memory leaks / fd leaks

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const errorRate = new Rate('app_error_rate');
const lat = new Trend('app_latency', true);

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 30,
      duration: '1h',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'app_latency': ['p(95)<500'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/processos?pagina=1&limite=50`);
  lat.add(res.timings.duration);
  errorRate.add(!check(res, { 'status 200': (r) => r.status === 200 }));
  sleep(1);
}
