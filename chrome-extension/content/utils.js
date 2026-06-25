/*
=========================================================
 CommentSense v2
 File: utils.js

 Shared Foundation

 Responsibilities
 --------------------------------------------------------
 ✓ Global namespace
 ✓ Configuration
 ✓ Feature flags
 ✓ Constants
 ✓ Logger
 ✓ Custom errors
 ✓ Safe execution helpers
 ✓ DOM helpers
 ✓ Utility helpers
 ✓ Validation
 ✓ Event Bus
 ✓ Chrome wrappers
 ✓ YouTube helpers

 This file contains NO business logic.

=========================================================
*/

"use strict";

/* =======================================================
   Namespace
======================================================= */

const CS = {};

/* =======================================================
   Version
======================================================= */

CS.VERSION = "2.0.0";

/* =======================================================
   Configuration
======================================================= */

CS.Config = Object.freeze({

    DEBUG: true,

    API_BASE_URL: "https://rishigupta04-yt-comments-sentiment-analyzer.hf.space",

    API_TIMEOUT: 30000,

    CACHE_EXPIRY_MS: 6 * 60 * 60 * 1000,

    OBSERVER_TIMEOUT_MS: 15000,

    DEFAULT_COMMENT_LIMIT: 100,

    MAX_COMMENT_LIMIT: 500,

    MAX_BATCH_SIZE: 100,

    MAX_RETRIES: 2,

    DATA_ATTRIBUTE: "commentsense",
   TOOLBAR_ID: "cs-toolbar"

});

/* =======================================================
   Feature Flags
======================================================= */

CS.Features = Object.freeze({

    CACHE: true,

    TOOLBAR: true,

    FILTERS: true,

    COMMENT_DECORATION: true,

    DEBUG_LOGGING: true

});

/* =======================================================
   Constants
======================================================= */

CS.Constants = Object.freeze({

    Modules: Object.freeze({

        CORE: "Core",

        CONTENT: "Content",

        ANALYZER: "Analyzer",

        CACHE: "Cache",

        TOOLBAR: "Toolbar",

        FILTERS: "Filters",

        UI: "UI",

        DOM: "DOM",

        YOUTUBE: "YouTube",

        POPUP: "Popup"

    }),

    Events: Object.freeze({

        START_ANALYSIS: "cs-start-analysis",

        REFRESH: "cs-refresh",

        FILTER: "cs-filter",

        COLLAPSE: "cs-collapse"

    }),

    Messages: Object.freeze({

        START_ANALYSIS: "START_ANALYSIS"

    }),

    Sentiments: Object.freeze({

        POSITIVE: "positive",

        NEUTRAL: "neutral",

        NEGATIVE: "negative"

    }),

    Filters: Object.freeze({

        ALL: "all",

        POSITIVE: "positive",

        NEUTRAL: "neutral",

        NEGATIVE: "negative"

    }),

    Status: Object.freeze({

        READY: "ready",

        ANALYZING: "analyzing",

        CACHE: "cache",

        OFFLINE: "offline",

        ERROR: "error"

    }),

    Storage: Object.freeze({

        CACHE_PREFIX: "commentsense-cache",

        SETTINGS: "commentsense-settings"

    }),

    Attributes: Object.freeze({

        ROOT: "data-commentsense",

        SENTIMENT: "data-cs-sentiment",

        CONFIDENCE: "data-cs-confidence"

    }),

    Classes: Object.freeze({

        TOOLBAR: "cs-toolbar",

        HEADER: "cs-header",

        BODY: "cs-body",

        FOOTER: "cs-footer",

        BUTTON: "cs-btn",

        BUTTON_ACTIVE: "cs-btn-active",

        BADGE: "cs-badge",

        TAG: "cs-tag",

        PILL: "cs-pill",

        COMMENT: "cs-comment",

        HIDDEN: "cs-hidden",

        COLLAPSED: "cs-collapsed"

    }),

    Selectors: Object.freeze({

        COMMENTS_SECTION: "#comments",

        COMMENT_THREAD: "ytd-comment-thread-renderer",

        COMMENT_TEXT: [
            "#content-text",
            "#content"
        ],

        AUTHOR: [
            "#author-text",
            "#header-author"
        ],

        TOOLBAR_ANCHOR: "#comments"

    })

});

/* =======================================================
   Logger
======================================================= */

/**
 * Centralized logger.
 * Toggle DEBUG in Config to silence debug logs.
 */
CS.Logger = (() => {

    const PREFIX = "[CommentSense]";

    function timestamp() {

        return new Date().toISOString();

    }

    function format(level, module) {

        return `${PREFIX} ${timestamp()} [${level}] [${module}]`;

    }

    function debug(module, ...args) {

        if (!CS.Config.DEBUG) return;

        if (!CS.Features.DEBUG_LOGGING) return;

        console.debug(format("DEBUG", module), ...args);

    }

    function info(module, ...args) {

        console.info(format("INFO", module), ...args);

    }

    function warn(module, ...args) {

        console.warn(format("WARN", module), ...args);

    }

    function error(module, ...args) {

        console.error(format("ERROR", module), ...args);

    }

    function group(module, label) {

        if (!CS.Config.DEBUG) return;

        console.group(format("GROUP", module), label);

    }

    function groupEnd() {

        if (!CS.Config.DEBUG) return;

        console.groupEnd();

    }

    function table(module, data) {

        if (!CS.Config.DEBUG) return;

        console.groupCollapsed(format("TABLE", module));

        console.table(data);

        console.groupEnd();

    }

    function time(label) {

        if (!CS.Config.DEBUG) return;

        console.time(`${PREFIX} ${label}`);

    }

    function timeEnd(label) {

        if (!CS.Config.DEBUG) return;

        console.timeEnd(`${PREFIX} ${label}`);

    }

    return Object.freeze({

        debug,

        info,

        warn,

        error,

        group,

        groupEnd,

        table,

        time,

        timeEnd

    });

})();

/* =======================================================
   Custom Errors
======================================================= */

class CommentSenseError extends Error {

    constructor(message, details = {}) {

        super(message);

        this.name = this.constructor.name;

        this.details = details;

        this.timestamp = new Date().toISOString();

    }

}

class APIError extends CommentSenseError {}

class CacheError extends CommentSenseError {}

class DOMError extends CommentSenseError {}

class ValidationError extends CommentSenseError {}

CS.Errors = Object.freeze({

    APIError,

    CacheError,

    DOMError,

    ValidationError

});

/* =======================================================
   Safe Execution

   Continues in Part 2...
======================================================= */



/* =======================================================
   Safe Execution

   Centralized error handling for all modules.
   Public APIs should use this instead of repetitive
   try/catch blocks.

   Example

   return CS.Safe.execute(
       CS.Constants.Modules.CACHE,
       async () => { ... },
       { fallback: [] }
   );
======================================================= */

CS.Safe = Object.freeze({

    /**
     * Execute async function safely.
     *
     * @template T
     * @param {string} module
     * @param {Function} callback
     * @param {Object} [options]
     * @returns {Promise<T>}
     */
    async execute(module, callback, options = {}) {

        const {

            fallback = null,
            rethrow = false,
            logStart = false,
            logSuccess = false,
            timer = false

        } = options;

        const start = performance.now();

        try {

            if (logStart) {

                CS.Logger.debug(module, "Execution started.");

            }

            const result = await callback();

            if (timer || logSuccess) {

                const duration = performance.now() - start;

                CS.Logger.debug(
                    module,
                    `Completed in ${duration.toFixed(1)} ms`
                );

            }

            return result;

        }

        catch (error) {

            const duration = performance.now() - start;

            CS.Logger.error(module, {

                message: error.message,

                stack: error.stack,

                details: error.details || null,

                duration: `${duration.toFixed(1)} ms`

            });

            if (rethrow) {

                throw error;

            }

            return fallback;

        }

    },

    /**
     * Execute sync function safely.
     */

    executeSync(module, callback, options = {}) {

        const {

            fallback = null,
            rethrow = false

        } = options;

        try {

            return callback();

        }

        catch (error) {

            CS.Logger.error(module, {

                message: error.message,

                stack: error.stack,

                details: error.details || null

            });

            if (rethrow) {

                throw error;

            }

            return fallback;

        }

    }

});

/* =======================================================
   DOM Helpers

   Defensive wrappers around common DOM operations.
======================================================= */

CS.DOM = Object.freeze({

    query(selector, parent = document) {

        if (!selector || !parent) {

            return null;

        }

        try {

            return parent.querySelector(selector);

        }

        catch {

            return null;

        }

    },

    queryAll(selector, parent = document) {

        if (!selector || !parent) {

            return [];

        }

        try {

            return [...parent.querySelectorAll(selector)];

        }

        catch {

            return [];

        }

    },

    queryFirst(selectors, parent = document) {

        if (!Array.isArray(selectors)) {

            return this.query(selectors, parent);

        }

        for (const selector of selectors) {

            const element = this.query(selector, parent);

            if (element) {

                return element;

            }

        }

        return null;

    },

    create(tag, className = "") {

        const element = document.createElement(tag);

        if (className) {

            element.className = className;

        }

        element.dataset.commentsense = "true";

        return element;

    },

    append(parent, child) {

        if (!parent || !child) {

            return false;

        }

        parent.appendChild(child);

        return true;

    },

    prepend(parent, child) {

        if (!parent || !child) {

            return false;

        }

        parent.prepend(child);

        return true;

    },

    remove(element) {

        if (!element) {

            return false;

        }

        element.remove();

        return true;

    },

    clear(element) {

        if (!element) {

            return false;

        }

        element.replaceChildren();

        return true;

    },

    text(element, value) {

        if (!element) {

            return false;

        }

        element.textContent = value;

        return true;

    },

    html(element, value) {

        if (!element) {

            return false;

        }

        element.innerHTML = value;

        return true;

    },

    addClass(element, className) {

        if (!element) {

            return false;

        }

        element.classList.add(className);

        return true;

    },

    removeClass(element, className) {

        if (!element) {

            return false;

        }

        element.classList.remove(className);

        return true;

    },

    toggleClass(element, className, state) {

        if (!element) {

            return false;

        }

        element.classList.toggle(className, state);

        return true;

    },

    hasClass(element, className) {

        if (!element) {

            return false;

        }

        return element.classList.contains(className);

    },

    attr(element, name, value) {

        if (!element) {

            return null;

        }

        if (value === undefined) {

            return element.getAttribute(name);

        }

        element.setAttribute(name, value);

        return value;

    },

    data(element, key, value) {

        if (!element) {

            return null;

        }

        if (value === undefined) {

            return element.dataset[key];

        }

        element.dataset[key] = value;

        return value;

    }

});

/* =======================================================
   Utility Helpers
======================================================= */

CS.Utils = Object.freeze({

    debounce(fn, delay = 300) {

        let timer = null;

        return (...args) => {

            clearTimeout(timer);

            timer = setTimeout(() => {

                fn(...args);

            }, delay);

        };

    },

    throttle(fn, limit = 300) {

        let waiting = false;

        return (...args) => {

            if (waiting) {

                return;

            }

            waiting = true;

            fn(...args);

            setTimeout(() => {

                waiting = false;

            }, limit);

        };

    },

    sleep(ms) {

        return new Promise(resolve => {

            setTimeout(resolve, ms);

        });

    },

    chunk(array, size) {

        const chunks = [];

        for (let i = 0; i < array.length; i += size) {

            chunks.push(array.slice(i, i + size));

        }

        return chunks;

    },

    clamp(value, min, max) {

        return Math.min(

            max,

            Math.max(min, value)

        );

    },

    round(value, digits = 2) {

        return Number(

            Number(value).toFixed(digits)

        );

    },

    formatPercent(value) {

        return `${this.round(value)}%`;

    },

    formatNumber(value) {

        return Number(value).toLocaleString();

    },

    unique(array) {

        return [...new Set(array)];

    },

    isEmpty(value) {

        return (

            value === null ||

            value === undefined ||

            value === ""

        );

    }

});

/* =======================================================
   Validation Helpers
======================================================= */

CS.Validate = Object.freeze({

    isHTMLElement(value) {

        return value instanceof HTMLElement;

    },

    isArray(value) {

        return Array.isArray(value);

    },

    isString(value) {

        return typeof value === "string";

    },

    isNonEmptyString(value) {

        return (

            typeof value === "string" &&

            value.trim().length > 0

        );

    },

    isNumber(value) {

        return (

            typeof value === "number" &&

            Number.isFinite(value)

        );

    },

    isPrediction(prediction) {

        return (

            prediction &&

            typeof prediction.sentiment === "string" &&

            typeof prediction.confidence === "number"

        );

    },

    isVideoId(videoId) {

        return (

            typeof videoId === "string" &&

            videoId.length === 11

        );

    }

});

/* =======================================================
   Continues in Part 3

   - EventBus
   - Chrome wrappers
   - YouTube helpers
   - Public API freeze
   - Initialization
======================================================= */


/* =======================================================
   Event Bus

   Centralized communication between modules.
======================================================= */

CS.EventBus = Object.freeze({

    /**
     * Dispatch a custom event.
     *
     * @param {string} eventName
     * @param {Object} detail
     */
    emit(eventName, detail = {}) {

        document.dispatchEvent(
            new CustomEvent(eventName, { detail })
        );

    },

    /**
     * Register event listener.
     *
     * @param {string} eventName
     * @param {Function} callback
     * @param {Object|boolean} options
     */
    on(eventName, callback, options = false) {

        document.addEventListener(
            eventName,
            callback,
            options
        );

    },

    /**
     * Remove event listener.
     */
    off(eventName, callback, options = false) {

        document.removeEventListener(
            eventName,
            callback,
            options
        );

    },

    /**
     * Register one-time listener.
     */
    once(eventName, callback) {

        document.addEventListener(
            eventName,
            callback,
            { once: true }
        );

    }

});

/* =======================================================
   Chrome Helpers

   Promise wrappers around Chrome APIs.
======================================================= */

CS.Chrome = Object.freeze({

    storage: Object.freeze({

        async get(keys = null) {

            return chrome.storage.local.get(keys);

        },

        async set(data) {

            await chrome.storage.local.set(data);

        },

        async remove(keys) {

            await chrome.storage.local.remove(keys);

        },

        async clear() {

            await chrome.storage.local.clear();

        }

    }),

    runtime: Object.freeze({

        sendMessage(message) {

            return chrome.runtime.sendMessage(message);

        }

    })

});

/* =======================================================
   YouTube Helpers

   Contains ONLY YouTube-specific helpers.

   No UI logic.
======================================================= */

CS.YouTube = (() => {

    let observer = null;

    function getVideoId() {

        return new URL(location.href).searchParams.get("v");

    }

    function getCommentThreads() {

        return CS.DOM.queryAll(
            CS.Constants.Selectors.COMMENT_THREAD
        );

    }

    function getCommentText(thread) {

        const node = CS.DOM.queryFirst(
            CS.Constants.Selectors.COMMENT_TEXT,
            thread
        );

        return node?.textContent.trim() || "";

    }

    function getAuthor(thread) {

        const node = CS.DOM.queryFirst(
            CS.Constants.Selectors.AUTHOR,
            thread
        );

        return node?.textContent.trim() || "";

    }

    /**
     * Wait until comments become available.
     */
    function waitForComments(
        timeout = CS.Config.OBSERVER_TIMEOUT_MS
    ) {

        return new Promise((resolve, reject) => {

            const existing = getCommentThreads();

            if (existing.length) {

                resolve(existing);

                return;

            }

            const timer = setTimeout(() => {

                observer?.disconnect();

                observer = null;

                reject(
                    new CS.Errors.DOMError(
                        "Timed out waiting for comments."
                    )
                );

            }, timeout);

            observer = new MutationObserver(() => {

                const comments = getCommentThreads();

                if (!comments.length) {

                    return;

                }

                clearTimeout(timer);

                observer.disconnect();

                observer = null;

                resolve(comments);

            });

            observer.observe(document.body, {

                childList: true,

                subtree: true

            });

        });

    }

    /**
     * Observe future comment changes.
     *
     * Used later by content.js
     */
    function observe(callback) {

        disconnect();

        observer = new MutationObserver(callback);

        observer.observe(document.body, {

            childList: true,

            subtree: true

        });

    }

    function disconnect() {

        if (!observer) {

            return;

        }

        observer.disconnect();

        observer = null;

    }

    return Object.freeze({

        getVideoId,

        getCommentThreads,

        getCommentText,

        getAuthor,

        waitForComments,

        observe,

        disconnect

    });

})();
async function getActiveTab() {

    const [tab] = await chrome.tabs.query({

        active: true,

        currentWindow: true

    });

    return tab;

}
/* =======================================================
   Initialization
======================================================= */


CS.Logger.info(
    CS.Constants.Modules.CORE,
    `CommentSense v${CS.VERSION} initialized`
);