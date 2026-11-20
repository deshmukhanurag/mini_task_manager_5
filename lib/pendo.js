// Server-side Pendo Track Events.
// Configure with environment variables:
//   PENDO_TRACK_EVENT_SECRET  integration key used for the x-pendo-integration-key header (required)
//   PENDO_DATA_HOST           Pendo data host (defaults to data.pendo-dev.pendo-dev.com)
// When the integration key is not set, events are skipped.

const DEFAULT_DATA_HOST = 'data.pendo-dev.pendo-dev.com';

function trackEvent(event, { visitorId, accountId, properties = {}, req } = {}) {
  const integrationKey = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!integrationKey) return;

  const dataHost = process.env.PENDO_DATA_HOST || DEFAULT_DATA_HOST;
  const body = {
    type: 'track',
    event,
    visitorId: visitorId != null ? String(visitorId) : 'system',
    timestamp: Date.now(),
    properties,
  };
  if (accountId != null) body.accountId = String(accountId);
  if (req) {
    body.context = {
      userAgent: req.get('User-Agent') || '',
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    };
  }

  // Fire and forget so tracking never blocks or breaks the request.
  try {
    fetch(`https://${dataHost}/data/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pendo-integration-key': integrationKey,
      },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) console.error(`Pendo track "${event}" failed with status ${res.status}`);
      })
      .catch((err) => console.error(`Pendo track "${event}" failed:`, err.message));
  } catch (err) {
    console.error(`Pendo track "${event}" failed:`, err.message);
  }
}

module.exports = { trackEvent };
