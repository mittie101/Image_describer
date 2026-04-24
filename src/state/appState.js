/**
 * src/state/appState.js
 * Centralised mutable state for the renderer.
 * Import as a plain object — mutations update in place so all modules share the same reference.
 */

'use strict';

const appState = {
  // Current single-image mode
  currentMode: 'single',
  currentImage: null,
  currentImageData: null,       // base64 — used for IPC
  currentImageBlobUrl: null,    // blob URL — used for <img> display
  currentImageDimensions: { width: 0, height: 0 },

  // Compare mode
  compareImageData: null,
  compareImageBlobUrl: null,

  // Session counters
  sessionCost: 0,
  tokensUsed: 0,
  imagesProcessed: 0,

  // Collections
  historyItems: [],
  templates: [],
  batchQueue: [],

  // Settings + provider state
  settings: {},
  apiProvider: null,
  activeProviders: [],

  // Batch processing
  batchProcessing: false,

  /** Reset single-image state. */
  clearImage() {
    this.currentImage = null;
    this.currentImageData = null;
    this.currentImageDimensions = { width: 0, height: 0 };
    if (this.currentImageBlobUrl) {
      URL.revokeObjectURL(this.currentImageBlobUrl);
      this.currentImageBlobUrl = null;
    }
  },

  /** Revoke compare blob URL and reset. */
  clearCompare() {
    this.compareImageData = null;
    if (this.compareImageBlobUrl) {
      URL.revokeObjectURL(this.compareImageBlobUrl);
      this.compareImageBlobUrl = null;
    }
  },
};
