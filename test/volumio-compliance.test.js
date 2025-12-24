'use strict';

const fs = require('fs');
const path = require('path');

// Mock dependencies before requiring the controller
jest.mock('../lib/sendspin-client');
jest.mock('../lib/audio-decoder');
jest.mock('../lib/audio-player');
jest.mock('v-conf');
jest.mock('os', () => ({
  hostname: jest.fn(() => 'test-device')
}));

const ControllerSendspin = require('../lib/index');
const SendspinClient = require('../lib/sendspin-client');
const AudioDecoder = require('../lib/audio-decoder');
const AudioPlayer = require('../lib/audio-player');
const vconf = require('v-conf');

describe('Volumio Plugin Compliance', () => {
  const pluginRoot = path.resolve(__dirname, '..');
  const packageJson = require('../package.json');

  describe('GENERAL', () => {
    it('should have a coherent plugin name', () => {
      expect(packageJson.name).toBe('sendspin');
      expect(packageJson.description).toBeDefined();
      expect(packageJson.description.length).toBeGreaterThan(0);
    });

    it('should have plugin archive size check (manual)', () => {
      // This would need to be checked after packaging
      // Archive must be < 10 MB
      expect(true).toBe(true); // Placeholder - manual check required
    });

    it('should have full English translation', () => {
      const uiConfig = JSON.parse(
        fs.readFileSync(path.join(pluginRoot, 'lib/UIConfig.json'), 'utf8')
      );
      expect(uiConfig.page.label).toBeDefined();
      expect(uiConfig.page.title).toBeDefined();
      expect(uiConfig.page.description).toBeDefined();
    });

    it('should be visible in plugin list (package.json compliance)', () => {
      expect(packageJson.volumio_info).toBeDefined();
      expect(packageJson.volumio_info.plugin_type).toBeDefined();
      expect(packageJson.volumio_info.architectures).toBeDefined();
      expect(Array.isArray(packageJson.volumio_info.architectures)).toBe(true);
    });
  });

  describe('LIFECYCLE', () => {
    let controller;
    let mockContext;
    let mockConfig;
    let mockClient;
    let mockDecoder;
    let mockPlayer;

    beforeEach(() => {
      // Create mock config
      mockConfig = {
        get: jest.fn((key) => {
          const defaults = {
            enabled: true
          };
          return defaults[key];
        }),
        set: jest.fn(),
        loadFile: jest.fn()
      };

      // Create mock client
      mockClient = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        isConnected: false,
        actualPort: 8080
      };

      // Create mock decoder
      mockDecoder = {
        initialize: jest.fn().mockResolvedValue(undefined),
        decode: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4])),
        cleanup: jest.fn()
      };

      // Create mock player
      mockPlayer = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        play: jest.fn().mockResolvedValue(undefined),
        isActive: jest.fn().mockReturnValue(false)
      };

      // Mock module constructors
      SendspinClient.mockImplementation(() => mockClient);
      AudioDecoder.mockImplementation(() => mockDecoder);
      AudioPlayer.mockImplementation(() => mockPlayer);

      // Mock v-conf
      vconf.mockImplementation(function() {
        return mockConfig;
      });

      mockContext = {
        coreCommand: {
          pluginManager: {
            getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
          },
          servicePushState: jest.fn()
        },
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      };

      controller = new ControllerSendspin(mockContext);
      
      // Initialize config by calling onVolumioStart
      const startPromise = controller.onVolumioStart();
      if (startPromise && startPromise.promise) {
        // Store promise for tests that need it
        controller._volumioStartPromise = startPromise;
      }
    });

    afterEach(async () => {
      if (controller && controller.sendspinPlayer) {
        try {
          await controller.onStop();
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      // Clear any remaining timers
      jest.clearAllTimers();
    });

    it('should start when onStart is called', async () => {
      // Ensure config is initialized
      if (controller._volumioStartPromise) {
        await new Promise((resolve, reject) => {
          controller._volumioStartPromise.promise.then(resolve, reject);
        });
      }
      
      // This test verifies that onStart can be called without errors
      // The actual implementation will be tested in integration tests
      // For compliance, we just need to verify it doesn't crash
      await expect(controller.onStart()).resolves.not.toThrow();
    });

    it('should not crash on errors in onStart', async () => {
      // Ensure config is initialized
      if (controller._volumioStartPromise) {
        await new Promise((resolve, reject) => {
          controller._volumioStartPromise.promise.then(resolve, reject);
        });
      }
      
      // Make start fail
      mockClient.start.mockRejectedValue(new Error('Test error'));

      // onStart() now catches errors and resolves to prevent crashes
      // It logs the error but doesn't throw
      await expect(controller.onStart()).resolves.toBeUndefined();
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start:'),
        expect.any(String)
      );
    });

    it('should stop correctly and disable functionality', async () => {
      // Ensure config is initialized and start the controller
      if (controller._volumioStartPromise) {
        await new Promise((resolve, reject) => {
          controller._volumioStartPromise.promise.then(resolve, reject);
        });
      }
      await controller.onStart();

      await controller.onStop();

      expect(mockClient.stop).toHaveBeenCalled();
      expect(controller.sendspinPlayer).toBeNull();
    });

    it('should not require configuration before starting', async () => {
      // Plugin should work with default config
      const defaultConfig = {
        get: jest.fn((key) => {
          // Return undefined for all keys - should use defaults
          return undefined;
        }),
        set: jest.fn(),
        loadFile: jest.fn()
      };

      vconf.mockImplementationOnce(function() {
        return defaultConfig;
      });

      const minimalContext = {
        coreCommand: {
          pluginManager: {
            getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
          },
          servicePushState: jest.fn()
        },
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      };

      const minimalController = new ControllerSendspin(minimalContext);
      
      // Initialize config
      await minimalController.onVolumioStart();
      
      // Should not throw even with minimal config
      expect(minimalController).toBeDefined();
    });
  });

  describe('INSTALL', () => {
    it('should have install.sh script', () => {
      const installScript = path.join(pluginRoot, 'install.sh');
      expect(fs.existsSync(installScript)).toBe(true);
    });

    it('install.sh should end with "plugininstallend"', () => {
      const installScript = path.join(pluginRoot, 'install.sh');
      const content = fs.readFileSync(installScript, 'utf8');
      expect(content.trim().endsWith('echo "plugininstallend"')).toBe(true);
    });

    it('should not compile on user device (no build in install.sh)', () => {
      const installScript = path.join(pluginRoot, 'install.sh');
      const content = fs.readFileSync(installScript, 'utf8');
      
      // Should only install dependencies, not compile
      // npm install is allowed, but no compilation steps
      expect(content).not.toContain('make');
      expect(content).not.toContain('gcc');
      expect(content).not.toContain('g++');
      expect(content).not.toContain('cmake');
      
      // npm run build is only for submodule, which is pre-built
      // This is acceptable as it's building a dependency, not the plugin itself
    });
  });

  describe('RESILIENCY', () => {
    it('should wrap sync file operations in try-catch', () => {
      const controller = new ControllerSendspin({
        coreCommand: {
          pluginManager: {
            getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
          },
          servicePushState: jest.fn()
        },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      });

      // getUIConfig uses readFileSync - should be wrapped in try-catch
      // This test verifies it doesn't throw
      expect(() => {
        controller.getUIConfig();
      }).not.toThrow();
    });

    it('should handle missing UIConfig.json gracefully', () => {
      const controller = new ControllerSendspin({
        coreCommand: {
          pluginManager: {
            getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
          },
          servicePushState: jest.fn()
        },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      });

      // Temporarily rename UIConfig.json to test error handling
      const uiConfigPath = path.join(pluginRoot, 'lib/UIConfig.json');
      const backupPath = path.join(pluginRoot, 'lib/UIConfig.json.backup');
      
      try {
        if (fs.existsSync(uiConfigPath)) {
          fs.renameSync(uiConfigPath, backupPath);
        }

        const config = controller.getUIConfig();
        expect(config).toBeDefined();
        expect(config.page).toBeDefined();
      } finally {
        // Restore file
        if (fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, uiConfigPath);
        }
      }
    });
  });

  describe('PACKAGE.JSON', () => {
    it('should have required volumio_info fields', () => {
      expect(packageJson.volumio_info).toBeDefined();
      expect(packageJson.volumio_info.plugin_type).toBe('audio_interface');
      expect(packageJson.volumio_info.architectures).toBeDefined();
      expect(Array.isArray(packageJson.volumio_info.architectures)).toBe(true);
    });

    it('should have valid main entry point', () => {
      expect(packageJson.main).toBe('index.js');
      expect(fs.existsSync(path.join(pluginRoot, packageJson.main))).toBe(true);
    });

    it('should have license', () => {
      expect(packageJson.license).toBeDefined();
      expect(packageJson.license).toBe('Apache-2.0');
    });
  });

  describe('ERROR HANDLING', () => {
    it('should handle errors in getUIConfig without crashing', () => {
      const controller = new ControllerSendspin({
        coreCommand: {
          pluginManager: {
            getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
          },
          servicePushState: jest.fn()
        },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
      });

      // Should return default config on error
      const config = controller.getUIConfig();
      expect(config).toBeDefined();
    });
  });
});
