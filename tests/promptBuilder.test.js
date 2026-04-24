'use strict';

// buildPrompt is not exported from main.js, so we extract and test the pure logic directly.
// This mirrors the implementation in main.js:buildPrompt and must stay in sync.

function buildPrompt(style, detail, midjourneyParams) {
  const detailWord = { 1: 'brief', 2: 'moderate', 3: 'comprehensive' }[detail] || 'moderate';
  let prompt = `Analyze this image and provide a ${detailWord} description`;
  if (style) prompt += ` in a ${style} style`;
  prompt += '.';
  if (midjourneyParams && midjourneyParams.enabled) {
    prompt += ' Format the output as a Midjourney prompt with parameters.';
    if (midjourneyParams.ar) prompt += ` --ar ${midjourneyParams.ar}`;
    if (midjourneyParams.stylize) prompt += ` --s ${midjourneyParams.stylize}`;
    if (midjourneyParams.chaos) prompt += ` --c ${midjourneyParams.chaos}`;
    if (midjourneyParams.seed) prompt += ` --seed ${midjourneyParams.seed}`;
    if (midjourneyParams.quality) prompt += ` --q ${midjourneyParams.quality}`;
  }
  return prompt;
}

describe('buildPrompt — detail level words', () => {
  test('detail=1 yields "brief"', () => {
    expect(buildPrompt('', 1, {})).toContain('brief');
  });

  test('detail=2 yields "moderate"', () => {
    expect(buildPrompt('', 2, {})).toContain('moderate');
  });

  test('detail=3 yields "comprehensive"', () => {
    expect(buildPrompt('', 3, {})).toContain('comprehensive');
  });

  test('unknown detail falls back to "moderate"', () => {
    expect(buildPrompt('', 99, {})).toContain('moderate');
  });
});

describe('buildPrompt — style injection', () => {
  test('appends style when provided', () => {
    const p = buildPrompt('professional', 2, {});
    expect(p).toContain('in a professional style');
  });

  test('omits style clause when style is empty string', () => {
    const p = buildPrompt('', 2, {});
    expect(p).not.toContain('in a');
  });

  test('omits style clause when style is falsy null', () => {
    const p = buildPrompt(null, 2, {});
    expect(p).not.toContain('in a');
  });
});

describe('buildPrompt — Midjourney params', () => {
  test('no midjourney section when enabled=false', () => {
    const p = buildPrompt('simple', 1, { enabled: false, ar: '16:9' });
    expect(p).not.toContain('Midjourney');
    expect(p).not.toContain('--ar');
  });

  test('no midjourney section when params object is null', () => {
    const p = buildPrompt('simple', 1, null);
    expect(p).not.toContain('Midjourney');
  });

  test('includes Midjourney instruction when enabled=true', () => {
    const p = buildPrompt('creative', 2, { enabled: true });
    expect(p).toContain('Midjourney prompt');
  });

  test('appends --ar when provided', () => {
    const p = buildPrompt('', 2, { enabled: true, ar: '16:9' });
    expect(p).toContain('--ar 16:9');
  });

  test('appends --s for stylize', () => {
    const p = buildPrompt('', 2, { enabled: true, stylize: 750 });
    expect(p).toContain('--s 750');
  });

  test('appends --c for chaos', () => {
    const p = buildPrompt('', 2, { enabled: true, chaos: 50 });
    expect(p).toContain('--c 50');
  });

  test('appends --seed when provided', () => {
    const p = buildPrompt('', 2, { enabled: true, seed: 12345 });
    expect(p).toContain('--seed 12345');
  });

  test('appends --q for quality', () => {
    const p = buildPrompt('', 2, { enabled: true, quality: 2 });
    expect(p).toContain('--q 2');
  });

  test('omits absent midjourney params', () => {
    const p = buildPrompt('', 2, { enabled: true });
    expect(p).not.toContain('--ar');
    expect(p).not.toContain('--s');
    expect(p).not.toContain('--seed');
  });

  test('all midjourney params combined', () => {
    const p = buildPrompt('cinematic', 3, { enabled: true, ar: '21:9', stylize: 500, chaos: 20, seed: 999, quality: 1 });
    expect(p).toContain('--ar 21:9');
    expect(p).toContain('--s 500');
    expect(p).toContain('--c 20');
    expect(p).toContain('--seed 999');
    expect(p).toContain('--q 1');
  });
});

describe('buildPrompt — return type and shape', () => {
  test('always returns a non-empty string', () => {
    const p = buildPrompt('', 1, {});
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });

  test('always ends with a period or period-containing suffix', () => {
    const p = buildPrompt('', 2, {});
    expect(p).toMatch(/\.$/);
  });
});
