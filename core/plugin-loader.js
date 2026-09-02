const fs = require('fs');
const path = require('path');
const { BasePlugin } = require('./base-plugin');

class PluginLoader {
  constructor(pluginsDir) {
    this.pluginsDir = pluginsDir || path.join(__dirname, '..', 'plugins');
  }

  /**
   * Load and instantiate all available plugins from plugins/ directory.
   * @returns {Map<string, BasePlugin>}
   */
  loadAll() {
    const plugins = new Map();

    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return plugins;
    }

    const files = fs.readdirSync(this.pluginsDir);
    for (const file of files) {
      if (!file.endsWith('.js') || file.startsWith('_') || file.startsWith('.')) {
        continue;
      }

      const filePath = path.join(this.pluginsDir, file);
      try {
        const PluginClass = require(filePath);
        let pluginInstance = null;

        if (typeof PluginClass === 'function') {
          pluginInstance = new PluginClass();
        } else if (PluginClass && typeof PluginClass.default === 'function') {
          pluginInstance = new PluginClass.default();
        } else if (PluginClass instanceof BasePlugin) {
          pluginInstance = PluginClass;
        }

        if (pluginInstance && pluginInstance.id) {
          plugins.set(pluginInstance.id, pluginInstance);
        }
      } catch (err) {
        console.error(`[PluginLoader] 加载插件失败: ${file}`, err);
      }
    }

    return plugins;
  }

  /**
   * Get a specific plugin by ID.
   * @param {string} pluginId
   * @returns {BasePlugin|null}
   */
  loadPlugin(pluginId) {
    const all = this.loadAll();
    return all.get(pluginId) || null;
  }
}

module.exports = { PluginLoader };
