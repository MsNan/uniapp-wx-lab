'use strict';

const { start, DEFAULT_PORT } = require('./mock-server');

start()
  .then(({ port }) => {
    console.log(`[uniapp-wx-lab] mock server http://127.0.0.1:${port}`);
    console.log('  GET  /health');
    console.log('  GET  /mock/templates');
    console.log('  GET  /mock/subscribe/recent');
    console.log('  POST /mock/subscribe/send');
    console.log('  POST /mock/pay/notify   (MOCK_SKIP_SIGN=1 or HMAC-SHA256 with MOCK_API_KEY=lab-test-key)');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
