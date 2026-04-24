'use strict';

const { store }            = require('../main/storage');
const { validateTemplate } = require('../src/validators');

function register(ipcMain) {

  ipcMain.handle('get-templates', async () => {
    const defaults = [
      { id: 'simple',       name: 'Simple',       style: 'simple',       detail: 1, custom: false },
      { id: 'detailed',     name: 'Detailed',     style: 'detailed',     detail: 3, custom: false },
      { id: 'professional', name: 'Professional', style: 'professional', detail: 2, custom: false },
      { id: 'creative',     name: 'Creative',     style: 'creative',     detail: 2, custom: false },
      { id: 'technical',    name: 'Technical',    style: 'technical',    detail: 3, custom: false },
    ];
    return [...defaults, ...store.get('templates', [])];
  });

  ipcMain.handle('save-template', async (event, template) => {
    if (!validateTemplate(template)) return { success: false, error: 'Invalid template' };
    const templates = store.get('templates', []);
    if (templates.length >= 50) return { success: false, error: 'Maximum 50 custom templates' };
    templates.push({
      id:     `custom-${Date.now()}`,
      name:   template.name,
      style:  template.style,
      detail: template.detail,
      custom: true,
    });
    store.set('templates', templates);
    return { success: true };
  });

  ipcMain.handle('delete-template', async (event, id) => {
    if (typeof id !== 'string' || id.length > 100 || !id.startsWith('custom-'))
      return { success: false, error: 'Invalid template id' };
    const templates = store.get('templates', []);
    store.set('templates', templates.filter(t => t.id !== id));
    return { success: true };
  });
}

module.exports = { register };
