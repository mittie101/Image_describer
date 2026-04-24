'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };

let logStream = null;
let minLevel = LEVELS.info;

function getLogPath() {
  try {
    return path.join(app.getPath('userData'), 'app.log');
  } catch (_) {
    return null;
  }
}

function openStream() {
  if (logStream) return;
  const logPath = getLogPath();
  if (!logPath) return;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  } catch (_) {
    // Non-fatal — fall back to console only
  }
}

function formatEntry(level, context, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level: LEVEL_LABELS[level],
    ctx: context,
    msg: message,
  };
  if (meta !== undefined) entry.meta = meta;
  return JSON.stringify(entry);
}

function write(level, context, message, meta) {
  if (level < minLevel) return;
  const line = formatEntry(level, context, message, meta);

  // Always write to stderr for errors, stdout for others
  if (level >= LEVELS.error) {
    console.error(line);
  } else if (level >= LEVELS.warn) {
    console.warn(line);
  } else {
    console.log(line);
  }

  if (!logStream) openStream();
  if (logStream) {
    logStream.write(line + '\n');
  }
}

/**
 * Create a context-scoped logger.
 * Usage: const log = require('./logger').createLogger('main');
 *        log.info('Window created', { width: 1400 });
 */
function createLogger(context) {
  return {
    debug: (msg, meta) => write(LEVELS.debug, context, msg, meta),
    info:  (msg, meta) => write(LEVELS.info,  context, msg, meta),
    warn:  (msg, meta) => write(LEVELS.warn,  context, msg, meta),
    error: (msg, meta) => write(LEVELS.error, context, msg, meta),
  };
}

function setLevel(level) {
  if (level in LEVELS) minLevel = LEVELS[level];
}

function close() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

module.exports = { createLogger, setLevel, close };
