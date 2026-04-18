/**
 * Frontend Configuration
 * Environment-specific settings for the Medical Patients Generator frontend
 */

/* eslint no-console: "off" */

class Config {
    constructor() {
        // Auto-detect environment based on hostname
        this.environment = this.detectEnvironment();

        // Environment-specific configuration
        this.config = this.getEnvironmentConfig();

        // Initialize API key from backend
        this._initializeApiKey();

        console.log(`🔧 Frontend configured for ${this.environment} environment`);
    }

    async _initializeApiKey() {
        try {
            const response = await fetch('/api/v1/config/frontend');
            if (response.ok) {
                const backendConfig = await response.json();
                this.config.apiKey = backendConfig.apiKey;
                console.log('🔑 API key fetched from backend config endpoint');
            } else {
                console.warn('Failed to fetch API key from backend config endpoint');
            }
        } catch (error) {
            console.warn('Error fetching API key from backend:', error);
        } finally {
            if (window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('configReady'));
            }
        }
    }

    detectEnvironment() {
        const hostname = window.location.hostname;

        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'local';
        } else if (hostname.includes('staging') || hostname.includes('z9rms')) {
            return 'staging';
        } else if (hostname === 'milmed.tech' || hostname === 'patients.milmed.tech') {
            return 'production';
        } else if (hostname === 'medical-patients-main-uksc-medsnomed-medsno.apps.ocp1.azure.dso.digital.mod.uk') {
            return 'production';
        } else {
            console.warn(`Unknown hostname: ${hostname}, defaulting to local config`);
            return 'local';
        }
    }

    getEnvironmentConfig() {
        const configs = {
            local: {
                apiKey: null,
                apiBaseUrl: '',
                debug: true,
                environment: 'local'
            },
            staging: {
                apiKey: null,
                apiBaseUrl: '',
                debug: false,
                environment: 'staging'
            },
            production: {
                apiKey: null,
                apiBaseUrl: '',
                debug: false,
                environment: 'production'
            }
        };

        return configs[this.environment] || configs.local;
    }

    // Getter methods for easy access
    get apiKey() {
        return this.config.apiKey;
    }

    get apiBaseUrl() {
        return this.config.apiBaseUrl;
    }

    get debug() {
        return this.config.debug;
    }

    get isProduction() {
        return this.environment === 'production';
    }

    get isStaging() {
        return this.environment === 'staging';
    }

    get isLocal() {
        return this.environment === 'local';
    }
}

// Create global config instance
const config = new Config();

// Export for modules and global use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Config, config };
}

if (typeof window !== 'undefined') {
    window.Config = Config;
    window.config = config;
}

console.log('🔧 Frontend configuration loaded');
