const https = require('https');

const PENDO_DATA_HOST = 'data.pendo-dev.pendo-dev.com';
const PENDO_INTEGRATION_KEY = 'fd3197ff-85f4-444f-98b2-27e444001df9';

function track(eventName, visitorId, properties) {
  const payload = JSON.stringify({
    type: 'track',
    event: eventName,
    visitorId: String(visitorId || 'system'),
    accountId: 'system',
    timestamp: Date.now(),
    properties: properties || {},
  });

  const options = {
    hostname: PENDO_DATA_HOST,
    path: '/data/track',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pendo-integration-key': PENDO_INTEGRATION_KEY,
    },
  };

  try {
    const req = https.request(options, () => {});
    req.on('error', (err) => {
      console.error('Pendo track error:', err.message);
    });
    req.write(payload);
    req.end();
  } catch (err) {
    console.error('Pendo track error:', err.message);
  }
}

module.exports = { track };
