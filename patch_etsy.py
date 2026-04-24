#!/usr/bin/env python3
"""Add generate-etsy-listing handler to ipc/generation.js."""

file = r'C:\Users\hamil\Desktop\image_description\ipc\generation.js'
with open(file, 'r', encoding='utf-8') as f:
    content = f.read()

# Find insertion point - before cancel-request handler
insert_before = "  ipcMain.handle('cancel-request',"
insert_idx = content.find(insert_before)
if insert_idx == -1:
    print("ERROR: Cannot find cancel-request handler")
    exit(1)

print(f"Inserting Etsy handler before cancel-request at position {insert_idx}")

etsy_handler = r"""  ipcMain.handle('generate-etsy-listing', async (event, {
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

    await acquireSemaphore();

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

"""

new_content = content[:insert_idx] + etsy_handler + content[insert_idx:]

print(f"New content length: {len(new_content)}")
print(f"Contains generate-etsy-listing: {'generate-etsy-listing' in new_content}")

with open(file, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Done!")
