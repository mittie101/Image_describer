'use strict';

// Style-specific guidance injected into the prompt for key styles.
// For unlisted styles, a generic visual-analysis instruction is used.
const STYLE_GUIDANCE = {
  photorealistic: 'Describe as if photographed: include apparent lens focal length, depth of field, focus point, any camera angle (eye-level, low-angle, aerial), and lighting quality (hard/soft, direction, colour temperature).',
  'oil painting':  'Note visible brushwork texture, impasto areas, glazing layers, colour mixing technique, and any identifiable painting style period (impressionist, baroque, etc.).',
  watercolour:     'Describe the wash transparency, wet-on-wet vs dry-brush areas, colour bleeding, paper texture showing through, and the soft/loose quality of edges.',
  anime:           'Note the line art weight and cleanness, cell-shading style, eye style (large/stylised vs realistic), speed lines or motion effects, and any genre conventions (shonen, shojo, etc.).',
  'cartoon / comic': 'Describe the line style (thick outlines, cross-hatching, dot shading), panel composition if relevant, and the cartoon exaggeration of proportions.',
  'digital art':   'Note the rendering style (painterly vs vector-clean), any visible layer effects, neon/glow use, and whether the piece has a concept-art or finished-illustration feel.',
  '3d render':     'Describe the render quality (stylised vs photorealistic), subsurface scattering on skin, material reflectance (metallic, matte, glass), and environmental lighting type (HDRI, studio, etc.).',
  'flat design':   'Note the colour palette count, geometric shape use, absence of shadows/gradients, and icon-like simplicity vs illustrated complexity.',
  'pixel art':     'State the apparent canvas resolution, colour palette count, dithering use, and whether it follows a retro (8-bit/16-bit) aesthetic or modern high-res pixel style.',
  sketch:          'Describe the line quality (gestural vs precise), shading technique (hatching, smudge), whether it appears as a quick study or a finished drawing.',
  'vintage / retro': 'Note colour palette ageing (muted, sepia, faded), halftone dot patterns, typeface style if present, and the apparent decade or era being evoked.',
  surrealist:      'Describe the juxtaposition of incongruous elements, dreamlike scale distortions, and any symbolic or subconscious imagery.',
  'concept art':   'Describe the design intent — character, environment or vehicle — and note silhouette clarity, callout annotations if present, and rendering completeness.',
  minimalist:      'Note the negative-space ratio, limited element count, restrained colour palette, and the visual focus point created by the composition.',
};

function buildPrompt(style, detail, midjourneyParams) {
  if (style === 'ocr') {
    return (
      'Extract ALL text visible in this image exactly as it appears.\n' +
      'Preserve original formatting, line breaks, columns, and spacing as closely as possible using plain text.\n' +
      'Distinguish printed from handwritten text where relevant.\n' +
      'If the image contains a table, reproduce it with aligned columns.\n' +
      'Output the extracted text ONLY — no preamble, labels, or commentary.\n' +
      'If no text is visible, respond with: "No text detected."'
    );
  }

  const detailConfig = {
    1: {
      word:     'concise',
      maxWords:  30,
      scope:    'Focus on the single most visually dominant subject and its most striking characteristic only. Omit background, secondary elements, and mood.',
    },
    2: {
      word:     'standard',
      maxWords:  75,
      scope:    'Cover the main subject, immediate environment or background, dominant lighting quality, primary colour palette, and overall mood. One sentence per element.',
    },
    3: {
      word:     'comprehensive',
      maxWords: 150,
      scope:    'Cover: main subject (form, pose, expression, detail), environment/background, lighting (quality, direction, colour temperature), colour palette, mood/atmosphere, composition (framing, perspective, rule-of-thirds or symmetry), and any technical or stylistic details unique to this image.',
    },
  }[detail] || {
    word: 'standard', maxWords: 75,
    scope: 'Cover subject, environment, lighting, colour palette, and mood.',
  };

  const styleGuidance = STYLE_GUIDANCE[style.toLowerCase()]
    || `Interpret and describe the visual qualities characteristic of the "${style}" style.`;

  if (midjourneyParams && midjourneyParams.enabled) {
    let prompt =
      `Generate a Midjourney image prompt based on this image. Target ~${detailConfig.maxWords} words for the descriptive text portion.\n\n` +
      `Style: ${style}. ${styleGuidance}\n\n` +
      `Output format — a single line of comma-separated descriptors in this order:\n` +
      `[primary subject + action or state], [environment/setting], [lighting descriptor], [colour palette keywords], [mood/atmosphere], [style: ${style}], [technical/compositional modifiers]\n\n` +
      `Rules:\n` +
      `- Output ONLY the prompt text — no preamble, no "Here is:", no quotation marks\n` +
      `- Use concrete, specific adjectives (not "beautiful", "amazing", "stunning")\n` +
      `- Front-load the most visually important element\n` +
      `- Separate every descriptor with a comma and a space\n` +
      `- ${detailConfig.scope}\n` +
      `- Append these Midjourney parameters at the end of the same line (do not put them on a new line):`;

    if (midjourneyParams.ar)      prompt += ` --ar ${midjourneyParams.ar}`;
    if (midjourneyParams.stylize) prompt += ` --s ${midjourneyParams.stylize}`;
    if (midjourneyParams.chaos)   prompt += ` --c ${midjourneyParams.chaos}`;
    if (midjourneyParams.seed)    prompt += ` --seed ${midjourneyParams.seed}`;
    if (midjourneyParams.quality) prompt += ` --q ${midjourneyParams.quality}`;
    return prompt;
  }

  return (
    `Analyze this image and write a ${detailConfig.word} description in a ${style} style (target ~${detailConfig.maxWords} words).\n\n` +
    `Style guidance: ${styleGuidance}\n\n` +
    `Scope: ${detailConfig.scope}\n\n` +
    `Rules:\n` +
    `- Output the description ONLY — no preamble, no "This image shows...", no meta-commentary\n` +
    `- Use specific, concrete language — name colours, name materials, describe shapes\n` +
    `- Avoid vague superlatives ("beautiful", "stunning", "amazing")\n` +
    `- Write in present tense\n` +
    `- Do not mention the image format or that you are analyzing an image`
  );
}

module.exports = { buildPrompt };
