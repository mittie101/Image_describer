'use strict';

const { PROVIDERS, PROVIDER_CONFIG }      = require('../main/config');
const { getPricing }                      = require('../main/models');
const { getApiKeyForProvider }            = require('../main/api-keys');
const { getProviderCooldown, setProviderCooldown } = require('../main/providers');
const { handleApiRetry }                  = require('../main/retry');
const { buildPrompt }                     = require('../main/prompt');
const { activeRequests }                  = require('../main/state');
const { checkIpcRateLimit }               = require('../main/rate-limit');

// Hard cap on concurrent AI requests regardless of batch concurrency setting.
// Prevents runaway memory usage and API abuse if the renderer is compromised.
const MAX_CONCURRENT_AI_CALLS = 3;
const MAX_SEMAPHORE_QUEUE = 20;
let _concurrentAiCalls = 0;
const _semaphoreQueue = [];

function acquireSemaphore() {
  return new Promise((resolve, reject) => {
    if (_concurrentAiCalls < MAX_CONCURRENT_AI_CALLS) {
      _concurrentAiCalls++;
      resolve();
    } else if (_semaphoreQueue.length >= MAX_SEMAPHORE_QUEUE) {
      reject(new Error('Too many queued requests — please wait for current requests to complete.'));
    } else {
      _semaphoreQueue.push(resolve);
    }
  });
}

function releaseSemaphore() {
  if (_semaphoreQueue.length > 0) {
    const next = _semaphoreQueue.shift();
    next(); // keep _concurrentAiCalls the same — one leaves, one enters
  } else {
    _concurrentAiCalls = Math.max(0, _concurrentAiCalls - 1);
  }
}

function register(ipcMain) {

  // Helper: run generation with streaming for a single provider
  async function runGeneration(event, reqId, prov, apiKey, imageDataUrl, base64Data, style, detail, mdl, maxTokens, midjourneyParams, controller, providerCfg) {
    const pricing = getPricing(mdl);
    const prompt  = buildPrompt(style, detail, midjourneyParams);
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let timeout;
      try {
        if (controller.signal.aborted)
          return { success: false, error: 'Request cancelled', cancelled: true };

        timeout = setTimeout(() => controller.abort(), providerCfg.timeoutMs);
        let response;

        const sendChunk = (chunk) => {
          if (chunk && event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('stream-chunk', { requestId: reqId, chunk });
          }
        };

        if (prov === 'openai') {
          response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: mdl, stream: true,
              stream_options: { include_usage: true },
              messages: [{ role: 'user', content: [
                { type: 'text',      text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ]}],
              max_tokens: maxTokens,
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const r = await handleApiRetry(response, attempt, maxRetries, prov, providerCfg);
            if (r.shouldContinue) { lastError = r.lastError; continue; }
            return r.response;
          }
          let fullText = '';
          let streamUsage = null;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              if (raw === '[DONE]') break;
              try {
                const parsed = JSON.parse(raw);
                if (parsed.usage) streamUsage = parsed.usage;
                const chunk = parsed.choices?.[0]?.delta?.content || '';
                if (chunk) { fullText += chunk; sendChunk(chunk); }
              } catch {}
            }
          }
          if (!fullText) return { success: false, error: 'Empty response from OpenAI' };
          {
            const inputTokens  = streamUsage?.prompt_tokens     || 0;
            const outputTokens = streamUsage?.completion_tokens || 0;
            const totalTokens  = streamUsage?.total_tokens      || (inputTokens + outputTokens);
            return {
              success: true, description: fullText.trim(), model: mdl, provider: prov,
              usage: {
                inputTokens, outputTokens, totalTokens,
                cost: pricing ? ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000 : 0,
              },
            };
          }

        } else if (prov === 'anthropic') {
          const mediaType = imageDataUrl.match(/^data:image\/(\w+);/)[1].replace('jpg', 'jpeg');
          response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: mdl, max_tokens: maxTokens, stream: true,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: `image/${mediaType}`, data: base64Data } },
                { type: 'text', text: prompt },
              ]}],
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const r = await handleApiRetry(response, attempt, maxRetries, prov, providerCfg);
            if (r.shouldContinue) { lastError = r.lastError; continue; }
            return r.response;
          }
          let fullText = '';
          let inputTokens = 0, outputTokens = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              try {
                const parsed = JSON.parse(raw);
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  const chunk = parsed.delta.text || '';
                  if (chunk) { fullText += chunk; sendChunk(chunk); }
                }
                if (parsed.type === 'message_start') inputTokens = parsed.message?.usage?.input_tokens || 0;
                if (parsed.type === 'message_delta') outputTokens = parsed.usage?.output_tokens || 0;
              } catch {}
            }
          }
          if (!fullText) return { success: false, error: 'Empty response from Anthropic' };
          const totalTokens = inputTokens + outputTokens;
          return {
            success: true, description: fullText.trim(), model: mdl, provider: prov,
            usage: {
              inputTokens, outputTokens, totalTokens,
              cost: pricing ? ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000 : 0,
            },
          };

        } else if (prov === 'google') {
          const mimeType = imageDataUrl.match(/^data:(image\/\w+);/)[1];
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:streamGenerateContent?alt=sse&key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
                generationConfig: { maxOutputTokens: maxTokens },
              }),
              signal: controller.signal,
            }
          );
          if (!response.ok) {
            const r = await handleApiRetry(response, attempt, maxRetries, prov, providerCfg);
            if (r.shouldContinue) { lastError = r.lastError; continue; }
            return r.response;
          }
          let fullText = '';
          let promptTokens = 0, candidateTokens = 0, totalTokens = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              try {
                const parsed = JSON.parse(raw);
                const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (chunk) { fullText += chunk; sendChunk(chunk); }
                if (parsed.usageMetadata) {
                  promptTokens    = parsed.usageMetadata.promptTokenCount    || promptTokens;
                  candidateTokens = parsed.usageMetadata.candidatesTokenCount || candidateTokens;
                  totalTokens     = parsed.usageMetadata.totalTokenCount      || totalTokens;
                }
              } catch {}
            }
          }
          if (!fullText) return { success: false, error: 'Empty response from Google' };
          return {
            success: true, description: fullText.trim(), model: mdl, provider: prov,
            usage: {
              inputTokens: promptTokens, outputTokens: candidateTokens, totalTokens,
              cost: pricing ? ((promptTokens * pricing.input) + (candidateTokens * pricing.output)) / 1_000_000 : 0,
            },
          };
        }

      } catch (error) {
        if (error.name === 'AbortError') return { success: false, error: 'Request cancelled', cancelled: true };
        if (attempt === maxRetries - 1) return { success: false, error: error.message };
        lastError = { error: error.message };
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      } finally {
        clearTimeout(timeout);
      }
    }

    const is429 = lastError?.errorCode === 429;
    if (is429) setProviderCooldown(prov, (PROVIDER_CONFIG[prov]?.retryBase429Ms || 2000) * 4);
    return { success: false, error: lastError?.error || 'Maximum retries exceeded', ...(is429 && { errorCode: 429 }) };
  }

  ipcMain.handle('generate-description', async (event, {
    requestId, imageDataUrl, style, detail,
    model = 'gpt-4o-mini', midjourneyParams = {},
  }) => {
    if (!checkIpcRateLimit('generate-description', 5))
      return { success: false, error: 'Too many requests. Please wait a moment.' };

    if (!imageDataUrl || typeof imageDataUrl !== 'string')
      return { success: false, error: 'Invalid image data' };
    if (!imageDataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,/))
      return { success: false, error: 'Invalid image format. Only JPEG, PNG, and WebP supported.' };
    if (typeof style !== 'string' || style.length > 100)
      return { success: false, error: 'Invalid style' };
    if (!Number.isInteger(detail) || detail < 1 || detail > 3)
      return { success: false, error: 'Invalid detail level' };
    if (typeof model !== 'string' || model.length > 100)
      return { success: false, error: 'Invalid model' };

    const base64Data     = imageDataUrl.split(',')[1];
    const imageSizeBytes = (base64Data.length * 3) / 4;
    const pricing        = getPricing(model);
    const provider       = pricing?.provider || (() => {
      for (const p of PROVIDERS) { if (getApiKeyForProvider(p)) return p; }
      return null;
    })();

    if (!provider)
      return { success: false, error: 'No API key configured. Add one in Settings.' };

    const cooldownMs = getProviderCooldown(provider);
    if (cooldownMs > 0)
      return { success: false, error: `${provider} is rate-limited. Try again in ${Math.ceil(cooldownMs / 1000)}s.`, errorCode: 429 };

    const providerCfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.openai;
    if (imageSizeBytes > providerCfg.maxImageBytes)
      return { success: false, error: `Image too large for ${provider} (max ${Math.round(providerCfg.maxImageBytes / 1024 / 1024)}MB).` };

    const apiKey = getApiKeyForProvider(provider);
    if (!apiKey)
      return { success: false, error: `No API key configured for ${provider}. Add one in Settings.` };

    const maxTokens = detail === 1 ? 150 : detail === 2 ? 300 : 500;

    try { await acquireSemaphore(); } catch (e) { return { success: false, error: e.message }; }

    const controller = new AbortController();
    if (requestId && typeof requestId === 'string') activeRequests.set(requestId, controller);

    try {
      // Try primary provider
      let result = await runGeneration(event, requestId, provider, apiKey, imageDataUrl, base64Data, style, detail, model, maxTokens, midjourneyParams, controller, providerCfg);

      // Auto-fallback: if primary failed (non-cancel, non-429), try other providers
      if (!result.success && !result.cancelled && result.errorCode !== 429) {
        for (const fallbackProvider of PROVIDERS) {
          if (fallbackProvider === provider) continue;
          const fallbackKey = getApiKeyForProvider(fallbackProvider);
          if (!fallbackKey) continue;
          if (getProviderCooldown(fallbackProvider) > 0) continue;
          const fallbackCfg   = PROVIDER_CONFIG[fallbackProvider] || PROVIDER_CONFIG.openai;
          const fallbackModel = fallbackProvider === 'openai'    ? 'gpt-4o-mini'
                              : fallbackProvider === 'anthropic' ? 'claude-3-5-haiku-20241022'
                              : 'gemini-1.5-flash';
          result = await runGeneration(event, requestId, fallbackProvider, fallbackKey, imageDataUrl, base64Data, style, detail, fallbackModel, maxTokens, midjourneyParams, controller, fallbackCfg);
          if (result.success) break;
        }
      }

      return result;
    } finally {
      releaseSemaphore();
      if (requestId) activeRequests.delete(requestId);
    }
  });

  ipcMain.handle('generate-redbubble-pitch', async (event, {
    requestId, description, model = 'gpt-4o-mini',
  }) => {
    if (!checkIpcRateLimit('generate-redbubble-pitch', 5))
      return { success: false, error: 'Too many requests. Please wait a moment.' };

    if (!description || typeof description !== 'string' || description.length > 5000)
      return { success: false, error: 'Invalid description' };
    if (typeof model !== 'string' || model.length > 100)
      return { success: false, error: 'Invalid model' };

    const pricing  = getPricing(model);
    const provider = pricing?.provider || (() => {
      for (const p of PROVIDERS) { if (getApiKeyForProvider(p)) return p; }
      return null;
    })();

    if (!provider)
      return { success: false, error: 'No API key configured. Add one in Settings.' };

    const cooldownMs = getProviderCooldown(provider);
    if (cooldownMs > 0)
      return { success: false, error: `${provider} is rate-limited. Try again in ${Math.ceil(cooldownMs / 1000)}s.`, errorCode: 429 };

    const apiKey = getApiKeyForProvider(provider);
    if (!apiKey)
      return { success: false, error: `No API key configured for ${provider}.` };

    const providerCfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.openai;
    const maxTokens   = 1500;

    try { await acquireSemaphore(); } catch (e) { return { success: false, error: e.message }; }

    const controller = new AbortController();
    if (requestId && typeof requestId === 'string') activeRequests.set(requestId, controller);

    const SYSTEM_PROMPT =
      'You are a Redbubble SEO listing expert with 20 years of experience. Your expertise includes ' +
      'crafting high-performing, keyword-rich titles, selecting effective tags, and writing engaging, ' +
      'SEO-optimised descriptions. Use **UK English** and a professional, concise, customer-friendly tone.\n\n' +
      'Format with Markdown. **Bold all section headers.** Use bullet points or lists where appropriate. ' +
      'Do not add extra commentary.\n\n' +
      'If no design description is provided, reply exactly:\n"Please provide your design description."';

    const buildPitchPrompt = (desc) => [
      `Input:\n[DESIGN_DESCRIPTION] = ${desc}`,
      'TASKS (return sections in this exact order):',
      '**Titles**\n- Generate 5 short, SEO-optimised titles (each < 60 characters).\n- Avoid generic words: art, design, drawing, illustration.\n- Include at least 2 clickbait/curiosity titles if suitable.\n- Do not repeat phrases across titles.\n- **Bold exactly one single top recommended title** (leave the other 4 unbolded).',
      '**Tags**\n- Create 15 SEO-optimised tags, comma-separated, each < 20 characters.\n- Mix full phrases and single keywords drawn from the titles.\n- Avoid generic tags: art, drawing, illustration, digital.\n- No duplicates.\n- Display as one single line (no bullets).',
      '**Description**\n- Write ~100 words, SEO-optimised, targeting the identified niche.\n- Naturally weave in high-volume, niche-specific keywords.\n- Default audience: young, style-conscious adults (adjust if the design clearly targets a different audience).\n- Highlight unique selling points without listing keywords separately.',
      '**Possible Best Background Colour**\n- Suggest one colour that best complements the design.\n- Format: Colour Name (#hexcode). Use UK colour names where sensible.',
      '**Predicted Best Performing Products**\n- List up to 3 Redbubble products (bulleted list).',
      '**Media**\n- Choose the 2 most relevant types from ONLY:\n  - Photography\n  - Design & Illustration\n  - Painting & Mixed Media\n  - Drawing\n  - Digital Art',
      '**Recommended Default Product**\n- Recommend the single best default product for this design.',
      '**Copyright Risk Level**\n- Output ONLY as:\nCopyright Risk Level = (rl)\n(where rl ∈ extremely high | high | medium | low | very low)',
      'QUALITY & GUARDRAILS\n- Use UK spelling throughout.\n- Keep titles within 60 characters and tags within 20 characters.\n- Ensure each title is distinct; avoid repeated bigrams across titles where possible.\n- No emojis, hashtags, or extra sections.\n- Double-check spelling, grammar, and relevance.\n- End the output with:\n"All instructions followed."',
    ].join('\n\n');

    const maxRetries = 3;
    let lastError    = null;

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let timeout;
        try {
          if (controller.signal.aborted)
            return { success: false, error: 'Request cancelled', cancelled: true };

          const userPrompt = buildPitchPrompt(description);
          timeout = setTimeout(() => controller.abort(), providerCfg.timeoutMs);
          let response, data;

          if (provider === 'openai') {
            response = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user',   content: userPrompt },
                ],
                max_tokens: maxTokens,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const pitch = data.choices?.[0]?.message?.content;
            if (!pitch) return { success: false, error: 'Empty response from OpenAI' };
            return {
              success: true, pitch: pitch.trim(), model, provider,
              usage: {
                inputTokens:  data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                totalTokens:  data.usage.total_tokens,
                cost: pricing ? ((data.usage.prompt_tokens * pricing.input) + (data.usage.completion_tokens * pricing.output)) / 1_000_000 : null,
              },
            };

          } else if (provider === 'anthropic') {
            response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: JSON.stringify({
                model, max_tokens: maxTokens,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userPrompt }],
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const pitch = data.content?.[0]?.text;
            if (!pitch) return { success: false, error: 'Empty response from Anthropic' };
            return {
              success: true, pitch: pitch.trim(), model, provider,
              usage: {
                inputTokens:  data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
                totalTokens:  data.usage.input_tokens + data.usage.output_tokens,
                cost: pricing ? ((data.usage.input_tokens * pricing.input) + (data.usage.output_tokens * pricing.output)) / 1_000_000 : null,
              },
            };

          } else if (provider === 'google') {
            response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
                  generationConfig: { maxOutputTokens: maxTokens },
                }),
                signal: controller.signal,
              }
            );
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const pitch = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!pitch) return { success: false, error: 'Empty response from Google' };
            return {
              success: true, pitch: pitch.trim(), model, provider,
              usage: {
                inputTokens:  data.usageMetadata.promptTokenCount,
                outputTokens: data.usageMetadata.candidatesTokenCount,
                totalTokens:  data.usageMetadata.totalTokenCount,
                cost: pricing ? ((data.usageMetadata.promptTokenCount * pricing.input) + (data.usageMetadata.candidatesTokenCount * pricing.output)) / 1_000_000 : null,
              },
            };
          }

        } catch (error) {
          clearTimeout(timeout);
          if (error.name === 'AbortError') return { success: false, error: 'Request cancelled', cancelled: true };
          if (attempt === maxRetries - 1) return { success: false, error: error.message };
          lastError = { error: error.message };
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }

      const is429 = lastError?.errorCode === 429;
      if (is429) setProviderCooldown(provider, (PROVIDER_CONFIG[provider]?.retryBase429Ms || 2000) * 4);
      return { success: false, error: lastError?.error || 'Maximum retries exceeded', ...(is429 && { errorCode: 429 }) };

    } finally {
      releaseSemaphore();
      if (requestId) activeRequests.delete(requestId);
    }
  });

  ipcMain.handle('generate-etsy-listing', async (event, {
    requestId, description, model = 'gpt-4o-mini',
  }) => {
    if (!checkIpcRateLimit('generate-etsy-listing', 5))
      return { success: false, error: 'Too many requests. Please wait a moment.' };

    if (!description || typeof description !== 'string' || description.length > 5000)
      return { success: false, error: 'Invalid description' };
    if (typeof model !== 'string' || model.length > 100)
      return { success: false, error: 'Invalid model' };

    const pricing  = getPricing(model);
    const provider = pricing?.provider || (() => {
      for (const p of PROVIDERS) { if (getApiKeyForProvider(p)) return p; }
      return null;
    })();

    if (!provider)
      return { success: false, error: 'No API key configured. Add one in Settings.' };

    const cooldownMs = getProviderCooldown(provider);
    if (cooldownMs > 0)
      return { success: false, error: `${provider} is rate-limited. Try again in ${Math.ceil(cooldownMs / 1000)}s.`, errorCode: 429 };

    const apiKey = getApiKeyForProvider(provider);
    if (!apiKey)
      return { success: false, error: `No API key configured for ${provider}.` };

    const providerCfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.openai;
    const maxTokens   = 1500;

    try { await acquireSemaphore(); } catch (e) { return { success: false, error: e.message }; }

    const controller = new AbortController();
    if (requestId && typeof requestId === 'string') activeRequests.set(requestId, controller);

    const ETSY_SYSTEM_PROMPT =
      'You are an Etsy SEO listing expert with 20 years of experience. Your expertise includes crafting high-performing, ' +
      'keyword-rich titles, selecting effective tags, and writing engaging, SEO-optimised descriptions for Etsy\'s marketplace. ' +
      'Use **UK English** and a warm, creative, artisan-friendly tone.\n\n' +
      'Format with Markdown. **Bold all section headers.** Use bullet points or lists where appropriate. ' +
      'Do not add extra commentary.\n\n' +
      'If no design description is provided, reply exactly:\n"Please provide your design description."';

    const buildEtsyPrompt = (desc) => [
      `Input:\n[DESIGN_DESCRIPTION] = ${desc}`,
      'TASKS (return sections in this exact order):',
      '**Title**\n- Generate 1 optimised Etsy listing title (max 140 characters).\n- Front-load the most important keywords.\n- Include material, style, and use-case naturally.\n- Do NOT use ALL CAPS or excessive punctuation.',
      '**Tags**\n- Create 13 SEO-optimised tags (Etsy allows 13 max), comma-separated, each \u2264 20 characters.\n- Mix multi-word phrases and single keywords.\n- Avoid duplicate words across tags.\n- Display as one single line.',
      '**Description**\n- Write ~150 words, SEO-optimised, warm and inviting.\n- First sentence should hook the buyer.\n- Include keywords naturally; describe materials, dimensions (placeholder if unknown), and uses.\n- End with a call to action (e.g., "Perfect for gifting or keeping for yourself!").',
      '**Who It\'s For**\n- One sentence naming the ideal buyer (e.g., "Perfect for cat lovers, home decor enthusiasts, or anyone who appreciates minimalist design.").',
    ].join('\n\n');

    const maxRetries = 3;
    let lastError    = null;

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let timeout;
        try {
          if (controller.signal.aborted)
            return { success: false, error: 'Request cancelled', cancelled: true };

          const userPrompt = buildEtsyPrompt(description);
          timeout = setTimeout(() => controller.abort(), providerCfg.timeoutMs);
          let response, data;

          if (provider === 'openai') {
            response = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: ETSY_SYSTEM_PROMPT },
                  { role: 'user',   content: userPrompt },
                ],
                max_tokens: maxTokens,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const listing = data.choices?.[0]?.message?.content;
            if (!listing) return { success: false, error: 'Empty response from OpenAI' };
            return {
              success: true, listing: listing.trim(), model, provider,
              usage: {
                inputTokens:  data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                totalTokens:  data.usage.total_tokens,
                cost: pricing ? ((data.usage.prompt_tokens * pricing.input) + (data.usage.completion_tokens * pricing.output)) / 1_000_000 : null,
              },
            };

          } else if (provider === 'anthropic') {
            response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: JSON.stringify({
                model, max_tokens: maxTokens,
                system: ETSY_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userPrompt }],
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const listing = data.content?.[0]?.text;
            if (!listing) return { success: false, error: 'Empty response from Anthropic' };
            return {
              success: true, listing: listing.trim(), model, provider,
              usage: {
                inputTokens:  data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
                totalTokens:  data.usage.input_tokens + data.usage.output_tokens,
                cost: pricing ? ((data.usage.input_tokens * pricing.input) + (data.usage.output_tokens * pricing.output)) / 1_000_000 : null,
              },
            };

          } else if (provider === 'google') {
            response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: ETSY_SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
                  generationConfig: { maxOutputTokens: maxTokens },
                }),
                signal: controller.signal,
              }
            );
            clearTimeout(timeout);
            if (!response.ok) {
              const r = await handleApiRetry(response, attempt, maxRetries, provider, providerCfg);
              if (r.shouldContinue) { lastError = r.lastError; continue; }
              return r.response;
            }
            data = await response.json();
            const listing = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!listing) return { success: false, error: 'Empty response from Google' };
            return {
              success: true, listing: listing.trim(), model, provider,
              usage: {
                inputTokens:  data.usageMetadata.promptTokenCount,
                outputTokens: data.usageMetadata.candidatesTokenCount,
                totalTokens:  data.usageMetadata.totalTokenCount,
                cost: pricing ? ((data.usageMetadata.promptTokenCount * pricing.input) + (data.usageMetadata.candidatesTokenCount * pricing.output)) / 1_000_000 : null,
              },
            };
          }

        } catch (error) {
          clearTimeout(timeout);
          if (error.name === 'AbortError') return { success: false, error: 'Request cancelled', cancelled: true };
          if (attempt === maxRetries - 1) return { success: false, error: error.message };
          lastError = { error: error.message };
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }

      const is429 = lastError?.errorCode === 429;
      if (is429) setProviderCooldown(provider, (PROVIDER_CONFIG[provider]?.retryBase429Ms || 2000) * 4);
      return { success: false, error: lastError?.error || 'Maximum retries exceeded', ...(is429 && { errorCode: 429 }) };

    } finally {
      releaseSemaphore();
      if (requestId) activeRequests.delete(requestId);
    }
  });

  ipcMain.handle('cancel-request', async (event, requestId) => {
    if (typeof requestId !== 'string') return { success: false };
    const controller = activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestId);
      return { success: true };
    }
    return { success: false, error: 'Request not found' };
  });
}

module.exports = { register };
