'use strict';

const { ipcRateLimits } = require('./state');

function checkIpcRateLimit(channel, maxPerSecond = 20) {
  const now   = Date.now();
  const entry = ipcRateLimits.get(channel) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 1000) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }
  ipcRateLimits.set(channel, entry);
  return entry.count <= maxPerSecond;
}

module.exports = { checkIpcRateLimit };
