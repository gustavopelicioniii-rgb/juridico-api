// k6 load test — carga sustentada para validar SLOs
// Cenário: rampa até ~50 RPS, mantém 8 min, rampa down.

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const errorRate = new Rate('app_error_rate');
const lat = new Trend('app_latency', true);

export const options = {
  scenarios: {
    constant_load: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '30s' },
        { target: 50, duration: '30s' },
        { target: 50, duration: '8m' },
        { target: 0,  duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:processos}': ['p(95)<400', 'p(99)<900'],
    'http_req_duration{endpoint:tribunais}': ['p(95)<150'],
    'http_req_duration{endpoint:processo_detail}': ['p(95)<600'],
    'app_error_rate': ['rate<0.02'],
  },
};

const PAGINAS = [1, 2, 3, 4, 5];

export default function () {
  group('list processos', () => {
    const pagina = PAGINAS[Math.floor(Math.random() * PAGINAS.length)];
    const res = http.get(`${BASE_URL}/api/v1/processos?pagina=${pagina}&limite=50`, {
      tags: { endpoint: 'processos' },
    });
    lat.add(res.timings.duration);
    errorRate.add(!check(res, { 'status 200': (r) => r.status === 200 }));
  });

  group('list tribunais', () => {
    const res = http.get(`${BASE_URL}/api/v1/tribunais`, { tags: { endpoint: 'tribunais' } });
    errorRate.add(!check(res, { 'status 200': (r) => r.status === 200 }));
  });

  group('detail (best-effort)', () => {
    const list = http.get(`${BASE_URL}/api/v1/processos?pagina=1&limite=10`, {
      tags: { endpoint: 'processos' },
    });
    const procs = list.json('processos') || [];
    if (procs.length > 0) {
      const id = procs[Math.floor(Math.random() * procs.length)].id;
      const res = http.get(`${BASE_URL}/api/v1/processos/${id}`, {
        tags: { endpoint: 'processo_detail' },
      });
      errorRate.add(!check(res, { 'status 200/404': (r) => [200, 404].includes(r.status) }));
    }
  });

  sleep(0.5);
}
