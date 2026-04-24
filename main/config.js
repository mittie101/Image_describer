'use strict';

const PROVIDERS = ['openai', 'anthropic', 'google'];

const PROVIDER_CONFIG = {
  openai:    { timeoutMs: 60000, maxImageBytes: 20 * 1024 * 1024, retryBase429Ms: 3000, retryBase5xxMs: 1000 },
  anthropic: { timeoutMs: 60000, maxImageBytes:  5 * 1024 * 1024, retryBase429Ms: 5000, retryBase5xxMs: 1000 },
  google:    { timeoutMs: 90000, maxImageBytes: 20 * 1024 * 1024, retryBase429Ms: 2000, retryBase5xxMs: 1000 },
};

const PROVIDER_ENDPOINTS = {
  openai:    'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google:    'https://generativelanguage.googleapis.com',
};

const DEFAULT_STATS = {
  totalImages: 0, totalCost: 0, totalTokens: 0,
  byProvider: {
    openai:    { images: 0, cost: 0, tokens: 0 },
    anthropic: { images: 0, cost: 0, tokens: 0 },
    google:    { images: 0, cost: 0, tokens: 0 },
  },
};

module.exports = { PROVIDERS, PROVIDER_CONFIG, PROVIDER_ENDPOINTS, DEFAULT_STATS };
