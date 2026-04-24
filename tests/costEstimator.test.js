'use strict';

// NOTE: The pricing table and token constants below mirror MODEL_PRICING in main.js.
// The renderer no longer holds its own copy; it receives pricing via get-available-models.
// If pricing or token assumptions change in main.js, update these constants too.

const MODEL_PRICING_CLIENT = {
  'gpt-4o-mini':               { input: 0.15,  output: 0.60  },
  'gpt-4o':                    { input: 2.50,  output: 10.00 },
  'gpt-4-turbo':               { input: 10.00, output: 30.00 },
  'claude-3-5-sonnet-20241022':{ input: 3.00,  output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80,  output: 4.00  },
  'claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
  'gemini-1.5-flash':          { input: 0.075, output: 0.30  },
  'gemini-1.5-pro':            { input: 1.25,  output: 5.00  },
};

const INPUT_TOKENS = 800;
const OUTPUT_TOKENS_BY_DETAIL = { 1: 150, 2: 300, 3: 500 };

function estimateCost(model, detail) {
  const pricing = MODEL_PRICING_CLIENT[model];
  if (!pricing) return null;
  const outputTokens = OUTPUT_TOKENS_BY_DETAIL[detail] ?? 300;
  return (INPUT_TOKENS * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ===== Pricing table structure =====

describe('MODEL_PRICING_CLIENT', () => {
  const expectedModels = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4-turbo',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ];

  test('contains all expected models', () => {
    expect(Object.keys(MODEL_PRICING_CLIENT)).toEqual(expectedModels);
  });

  test('every model has a positive input price', () => {
    Object.entries(MODEL_PRICING_CLIENT).forEach(([, { input }]) => {
      expect(input).toBeGreaterThan(0);
    });
  });

  test('every model has a positive output price', () => {
    Object.entries(MODEL_PRICING_CLIENT).forEach(([, { output }]) => {
      expect(output).toBeGreaterThan(0);
    });
  });

  test('output price is always >= input price for every model', () => {
    Object.entries(MODEL_PRICING_CLIENT).forEach(([, { input, output }]) => {
      expect(output).toBeGreaterThanOrEqual(input);
    });
  });
});

// ===== Cost formula =====

describe('estimateCost', () => {
  test('returns null for an unknown model', () => {
    expect(estimateCost('unknown-model', 2)).toBeNull();
  });

  test('all model+detail combinations return a positive number', () => {
    Object.keys(MODEL_PRICING_CLIENT).forEach(model => {
      [1, 2, 3].forEach(detail => {
        const cost = estimateCost(model, detail);
        expect(typeof cost).toBe('number');
        expect(cost).toBeGreaterThan(0);
      });
    });
  });

  test('higher detail level produces higher cost', () => {
    Object.keys(MODEL_PRICING_CLIENT).forEach(model => {
      const low  = estimateCost(model, 1);
      const mid  = estimateCost(model, 2);
      const high = estimateCost(model, 3);
      expect(mid).toBeGreaterThan(low);
      expect(high).toBeGreaterThan(mid);
    });
  });

  // Spot-check exact calculations to catch accidental formula changes.
  // Formula: (INPUT_TOKENS * input + outputTokens * output) / 1_000_000

  test('gpt-4o-mini detail 2: (800*0.15 + 300*0.60) / 1e6 = 0.0003', () => {
    expect(estimateCost('gpt-4o-mini', 2)).toBeCloseTo(0.0003, 7);
  });

  test('gpt-4o-mini detail 1: (800*0.15 + 150*0.60) / 1e6 = 0.00021', () => {
    expect(estimateCost('gpt-4o-mini', 1)).toBeCloseTo(0.00021, 7);
  });

  test('gpt-4o-mini detail 3: (800*0.15 + 500*0.60) / 1e6 = 0.00042', () => {
    expect(estimateCost('gpt-4o-mini', 3)).toBeCloseTo(0.00042, 7);
  });

  test('claude-3-opus detail 3: (800*15 + 500*75) / 1e6 = 0.0495', () => {
    expect(estimateCost('claude-3-opus-20240229', 3)).toBeCloseTo(0.0495, 7);
  });

  test('gemini-1.5-flash detail 1: (800*0.075 + 150*0.30) / 1e6 = 0.000105', () => {
    expect(estimateCost('gemini-1.5-flash', 1)).toBeCloseTo(0.000105, 7);
  });

  // ===== Relative ordering =====

  test('gemini-1.5-flash is cheapest at every detail level', () => {
    [1, 2, 3].forEach(detail => {
      const flashCost = estimateCost('gemini-1.5-flash', detail);
      Object.keys(MODEL_PRICING_CLIENT).forEach(model => {
        expect(estimateCost(model, detail)).toBeGreaterThanOrEqual(flashCost);
      });
    });
  });

  test('claude-3-opus is most expensive at every detail level', () => {
    [1, 2, 3].forEach(detail => {
      const opusCost = estimateCost('claude-3-opus-20240229', detail);
      Object.keys(MODEL_PRICING_CLIENT).forEach(model => {
        expect(estimateCost(model, detail)).toBeLessThanOrEqual(opusCost);
      });
    });
  });
});
