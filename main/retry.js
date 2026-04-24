'use strict';

const { createLogger }    = require('../src/logger');
const { PROVIDER_CONFIG } = require('./config');

const log = createLogger('retry');

function shouldRetry(statusCode, attempt, maxRetries) {
  if (attempt >= maxRetries) return false;
  if ([400, 401, 403].includes(statusCode)) return false;
  return statusCode === 429 || statusCode >= 500;
}

function getRetryDelay(response, attempt, providerCfg) {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  const base = response.status === 429
    ? (providerCfg?.retryBase429Ms || 2000)
    : (providerCfg?.retryBase5xxMs || 1000);
  return Math.pow(2, attempt) * base + Math.random() * 1000;
}

async function handleApiRetry(response, attempt, maxRetries, provider, providerCfg) {
  const error      = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
  const statusCode = response.status;

  if (shouldRetry(statusCode, attempt, maxRetries)) {
    const delay = getRetryDelay(response, attempt, providerCfg);
    log.info('API retry', { provider, attempt: attempt + 1, maxRetries, delayMs: Math.round(delay), statusCode });
    await new Promise(resolve => setTimeout(resolve, delay));
    return {
      shouldContinue: true,
      lastError: {
        error:     statusCode === 429 ? 'Rate limit - retrying...' : (error.error?.message || 'Server error'),
        errorCode: statusCode,
      },
    };
  }

  return {
    shouldContinue: false,
    response: {
      success:   false,
      error:     error.error?.message || error.error || 'API request failed',
      errorCode: statusCode,
    },
  };
}

module.exports = { shouldRetry, getRetryDelay, handleApiRetry };
