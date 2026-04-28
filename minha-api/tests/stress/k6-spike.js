// k6 spike test — pico súbito 10 → 500 VUs em 30s para validar resiliência

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const errorRate = new Rate('app_error_rate');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 10 },
        { duration: '30s', target: 500 }, // SPIKE
        { duration: '2m', target: 500 },
        { duration: '30s', target: 10 }, // recover
        { duration: '1m', target: 10 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.30'],
    http_req_duration: ['p(95)<5000'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/tribunais`);
  errorRate.add(!check(res, { 'status<500': (r) => r.status < 500 }));
  sleep(0.1);
}
