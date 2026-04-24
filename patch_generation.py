#!/usr/bin/env python3
"""Patch ipc/generation.js: replace generate-description handler with streaming + fallback version."""

import re

file = r'C:\Users\hamil\Desktop\image_description\ipc\generation.js'
with open(file, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of the generate-description handler
start_marker = "  ipcMain.handle('generate-description',"
end_marker = "  ipcMain.handle('generate-redbubble-pitch',"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("ERROR: Could not find generate-description handler start")
    exit(1)
if end_idx == -1:
    print("ERROR: Could not find generate-redbubble-pitch handler")
    exit(1)

print(f"Found generate-description at {start_idx}, ends at {end_idx}")

old_handler_section = content[start_idx:end_idx]
print(f"Old handler section length: {len(old_handler_section)}")

new_handler = r"""  // Helper: run generation with streaming for a single provider
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
              messages: [{ role: 'user', content: [
                { type: 'text',      text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ]}],
              max_tokens: maxTokens,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!response.ok) {
            const r = await handleApiRetry(response, attempt, maxRetries, prov, providerCfg);
            if (r.shouldContinue) { lastError = r.lastError; continue; }
            return r.response;
          }
          let fullText = '';
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
                const chunk = parsed.choices?.[0]?.delta?.content || '';
                if (chunk) { fullText += chunk; sendChunk(chunk); }
              } catch {}
            }
          }
          if (!fullText) return { success: false, error: 'Empty response from OpenAI' };
          // Cost estimation (tokens not available from streaming, use 0)
          return {
            success: true, description: fullText.trim(), model: mdl, provider: prov,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
          };

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
          clearTimeout(timeout);
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
          clearTimeout(timeout);
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
        clearTimeout(timeout);
        if (error.name === 'AbortError') return { success: false, error: 'Request cancelled', cancelled: true };
        if (attempt === maxRetries - 1) return { success: false, error: error.message };
        lastError = { error: error.message };
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
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

    await acquireSemaphore();

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

  ipcMain.handle('generate-redbubble-pitch',
"""

new_content = content[:start_idx] + new_handler + content[end_idx + len("  ipcMain.handle('generate-redbubble-pitch',"):]
# Re-add the redbubble handler start
new_content = content[:start_idx] + new_handler.replace(
    "  ipcMain.handle('generate-redbubble-pitch',", ""
) 
# Wait, I need to be more careful. Let me just replace from start_idx to end_idx
new_content = content[:start_idx] + new_handler + content[end_idx:]

print(f"New content length: {len(new_content)}")
print(f"Contains generate-description: {'generate-description' in new_content}")
print(f"Contains generate-redbubble-pitch: {'generate-redbubble-pitch' in new_content}")

with open(file, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Done!")
