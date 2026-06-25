/*
======================================================
CommentSense v2

cache.js

Persistent cache layer.

Responsibilities
------------------------------------------------------
✓ Load cache
✓ Save cache
✓ Merge new analysis
✓ Cleanup expired cache
✓ Validate cache

No UI.
No API.
No DOM.
No AppState mutations.
======================================================
*/

"use strict";

/* ======================================================
   Cache Manager
====================================================== */

const CacheManager = (() => {

    const MODULE = CS.Constants.Modules.CACHE;

    /* ==================================================
       Private Helpers
    ================================================== */

    function buildKey(videoId, fingerprint) {

        return `${CS.Constants.Storage.CACHE_PREFIX}:${videoId}:${fingerprint}`;

    }

    function now() {

        return Date.now();

    }

    function isExpired(cache) {

        if (!cache) {

            return true;

        }

        return (

            now() - cache.updatedAt >

            CS.Config.CACHE_EXPIRY_MS

        );

    }

    function validate(videoId, fingerprint) {

        if (!CS.Validate.isVideoId(videoId)) {

            throw new CS.Errors.ValidationError(

                "Invalid video id."

            );

        }

        if (!CS.Validate.isNonEmptyString(fingerprint)) {

            throw new CS.Errors.ValidationError(

                "Invalid fingerprint."

            );

        }

    }

    function buildCache(

        videoId,

        fingerprint,

        comments

    ) {

        const commentMap = {};

        for (const comment of comments) {

            commentMap[comment.id] = {

                id: comment.id,

                text: comment.text,

                sentiment: comment.sentiment,

                confidence: comment.confidence,

                fingerprint: comment.fingerprint || "",

                updatedAt: now()

            };

        }

        return {

            version: 1,

            videoId,

            fingerprint,

            createdAt: now(),

            updatedAt: now(),

            comments: commentMap

        };

    }

    /* ==================================================
       Public API
    ================================================== */

    /**
     * Load cache.
     *
     * @param {string} videoId
     * @param {string} fingerprint
     * @returns {Promise<Object|null>}
     */

    async function load(

        videoId,

        fingerprint

    ) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                validate(

                    videoId,

                    fingerprint

                );

                const key = buildKey(

                    videoId,

                    fingerprint

                );

                const result = await CS.Chrome.storage.get(

                    key

                );

                const cache = result[key];

                if (!cache) {

                    return null;

                }

                if (isExpired(cache)) {

                    await CS.Chrome.storage.remove(

                        key

                    );

                    return null;

                }

                return cache;

            },

            {

                fallback: null

            }

        );

    }

    /**
     * Save cache.
     *
     * @param {string} videoId
     * @param {string} fingerprint
     * @param {Array<Object>} comments
     * @returns {Promise<boolean>}
     */

    async function save(

        videoId,

        fingerprint,

        comments

    ) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                validate(

                    videoId,

                    fingerprint

                );

                if (!CS.Validate.isArray(comments)) {

                    throw new CS.Errors.ValidationError(

                        "Comments must be an array."

                    );

                }

                const key = buildKey(

                    videoId,

                    fingerprint

                );

                const cache = buildCache(

                    videoId,

                    fingerprint,

                    comments

                );

                await CS.Chrome.storage.set({

                    [key]: cache

                });

                return true;

            },

            {

                fallback: false

            }

        );

    }
        /**
     * Merge newly analyzed comments into an existing cache.
     *
     * Existing comments are preserved.
     * New comments overwrite only their own entries.
     *
     * @param {string} videoId
     * @param {string} fingerprint
     * @param {Array<Object>} comments
     * @returns {Promise<Object|null>}
     */
    async function merge(

        videoId,

        fingerprint,

        comments

    ) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                validate(

                    videoId,

                    fingerprint

                );

                if (!CS.Validate.isArray(comments)) {

                    throw new CS.Errors.ValidationError(

                        "Comments must be an array."

                    );

                }

                const key = buildKey(

                    videoId,

                    fingerprint

                );

                const result = await CS.Chrome.storage.get(

                    key

                );

                let cache = result[key];

                if (!cache || isExpired(cache)) {

                    cache = buildCache(

                        videoId,

                        fingerprint,

                        comments

                    );

                }

                else {

                    for (const comment of comments) {

                        cache.comments[comment.id] = {

                            id: comment.id,

                            text: comment.text,

                            sentiment: comment.sentiment,

                            confidence: comment.confidence,

                            fingerprint: comment.fingerprint || "",

                            updatedAt: now()

                        };

                    }

                    cache.updatedAt = now();

                }

                await CS.Chrome.storage.set({

                    [key]: cache

                });

                return cache;

            },

            {

                fallback: null

            }

        );

    }

    /**
     * Delete cache for a specific video fingerprint.
     *
     * @param {string} videoId
     * @param {string} fingerprint
     * @returns {Promise<boolean>}
     */

    async function clear(

        videoId,

        fingerprint

    ) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                validate(

                    videoId,

                    fingerprint

                );

                const key = buildKey(

                    videoId,

                    fingerprint

                );

                await CS.Chrome.storage.remove(

                    key

                );

                return true;

            },

            {

                fallback: false

            }

        );

    }

    /**
     * Remove expired cache entries.
     *
     * Runs once during extension startup.
     *
     * @returns {Promise<number>}
     */

    async function cleanup() {

        return CS.Safe.execute(

            MODULE,

            async () => {

                const storage = await CS.Chrome.storage.get(null);

                let removed = 0;

                const keysToRemove = [];

                for (const [key, value] of Object.entries(storage)) {

                    if (

                        !key.startsWith(

                            CS.Constants.Storage.CACHE_PREFIX

                        )

                    ) {

                        continue;

                    }

                    if (isExpired(value)) {

                        keysToRemove.push(key);

                    }

                }

                if (keysToRemove.length) {

                    await CS.Chrome.storage.remove(

                        keysToRemove

                    );

                    removed = keysToRemove.length;

                }

                CS.Logger.info(

                    MODULE,

                    `Cache cleanup completed. Removed ${removed} expired entr${removed === 1 ? "y" : "ies"}.`

                );

                return removed;

            },

            {

                fallback: 0

            }

        );

    }

    /* ==================================================
       Public API
    ================================================== */

    return Object.freeze({

        load,

        save,

        merge,

        clear,

        cleanup

    });

})();

/* ======================================================
   End of File
====================================================== */