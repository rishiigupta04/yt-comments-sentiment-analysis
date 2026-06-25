/*
======================================================
CommentSense v2

analyzer.js

AI inference layer.

Responsibilities
------------------------------------------------------
✓ Backend health check
✓ Batch prediction
✓ Request validation
✓ Response validation
✓ Prediction normalization

No DOM manipulation.
No Cache.
No Toolbar.
No UI.
No AppState.
======================================================
*/

"use strict";

/* ======================================================
   Analyzer
====================================================== */

const Analyzer = (() => {

    const MODULE = CS.Constants.Modules.ANALYZER;

    const HEALTH_ENDPOINT = "/health";

    const PREDICT_ENDPOINT = "/predict_batch";

    /* ==================================================
       Private Helpers
    ================================================== */

    function buildUrl(endpoint) {

        return `${CS.Config.API_BASE_URL}${endpoint}`;

    }

    function createTimeoutController() {

        const controller = new AbortController();

        const timer = setTimeout(() => {

            controller.abort();

        }, CS.Config.API_TIMEOUT);

        return {

            controller,

            timer

        };

    }

    function clearTimer(timer) {

        clearTimeout(timer);

    }

    function buildRequest(texts) {

        return {

            texts

        };

    }

    function validatePrediction(prediction) {

        if (!prediction) {

            throw new CS.Errors.ValidationError(
                "Prediction missing."
            );

        }

        if (

            !Object.values(
                CS.Constants.Sentiments
            ).includes(
                prediction.sentiment
            )

        ) {

            throw new CS.Errors.ValidationError(
                "Invalid sentiment."
            );

        }

        if (

            !CS.Validate.isNumber(
                prediction.confidence
            )

        ) {

            throw new CS.Errors.ValidationError(
                "Invalid confidence."
            );

        }

    }

    function normalizePrediction(prediction) {

        validatePrediction(prediction);

        return {

            sentiment:

                prediction.sentiment.toLowerCase(),

            confidence:

                Number(prediction.confidence)

        };

    }

    async function post(texts) {

        const {

            controller,

            timer

        } = createTimeoutController();

        try {

            const response = await fetch(

                buildUrl(
                    PREDICT_ENDPOINT
                ),

                {

                    method: "POST",

                    headers: {

                        "Content-Type":

                            "application/json"

                    },

                    body: JSON.stringify(

                        buildRequest(texts)

                    ),

                    signal:

                        controller.signal

                }

            );

            if (!response.ok) {

                throw new CS.Errors.APIError(

                    `HTTP ${response.status}`,

                    {

                        status:

                            response.status

                    }

                );

            }

            const json = await response.json();

            if (

                !json ||

                !Array.isArray(
                    json.predictions
                )

            ) {

                throw new CS.Errors.ValidationError(

                    "Invalid API response."

                );

            }

            if (

                json.predictions.length !==

                texts.length

            ) {

                throw new CS.Errors.ValidationError(

                    "Prediction count mismatch."

                );

            }

            return json.predictions.map(

                normalizePrediction

            );

        }

        finally {

            clearTimer(timer);

        }

    }

    /**
     * Private prediction engine.
     *
     * Shared by predict() and analyze().
     */

    async function predictBatch(comments) {

        if (!comments.length) {

            return [];

        }

        const batches = CS.Utils.chunk(

            comments,

            CS.Config.MAX_BATCH_SIZE

        );

        const batchPromises = batches.map(

            batch =>

                post(

                    batch.map(

                        comment => comment.text

                    )

                )

        );

        const results = await Promise.allSettled(

            batchPromises

        );

        return results.flat();

    }

        /* ==================================================
       Public API
    ================================================== */

    /**
     * Check backend health.
     *
     * @returns {Promise<boolean>}
     */
    async function health() {

        return CS.Safe.execute(

            MODULE,

            async () => {

                const {

                    controller,

                    timer

                } = createTimeoutController();

                try {

                    const response = await fetch(

                        buildUrl(
                            HEALTH_ENDPOINT
                        ),

                        {

                            method: "GET",

                            signal: controller.signal

                        }

                    );

                    return response.ok;

                }

                catch (error) {

                    if (error.name === "AbortError") {

                        throw new CS.Errors.APIError(

                            "Health check timed out."

                        );

                    }

                    throw error;

                }

                finally {

                    clearTimer(timer);

                }

            },

            {

                fallback: false,

                timer: true

            }

        );

    }

    /**
     * Predict sentiment for validated comments.
     *
     * Input:
     * [
     *   {
     *      id,
     *      text
     *   }
     * ]
     *
     * Output:
     * [
     *   {
     *      sentiment,
     *      confidence
     *   }
     * ]
     *
     * Continued in Part 2...
     */

        async function predict(comments) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                if (!CS.Validate.isArray(comments)) {

                    throw new CS.Errors.ValidationError(
                        "Comments must be an array."
                    );

                }

                if (!comments.length) {

                    return [];

                }

                return await predictBatch(comments);

            },

            {

                fallback: [],

                timer: true

            }

        );

    }

    /**
     * Analyze validated comments.
     *
     * Expected input:
     *
     * [
     *   {
     *      id,
     *      element,
     *      text,
     *      fingerprint
     *   }
     * ]
     *
     * Returns:
     *
     * [
     *   {
     *      id,
     *      element,
     *      text,
     *      fingerprint,
     *      sentiment,
     *      confidence
     *   }
     * ]
     *
     * @param {Array<Object>} comments
     * @param {number} limit
     * @returns {Promise<Array<Object>>}
     */
    async function analyze(

        comments,

        limit = CS.Config.DEFAULT_COMMENT_LIMIT

    ) {

        return CS.Safe.execute(

            MODULE,

            async () => {

                if (!CS.Validate.isArray(comments)) {

                    throw new CS.Errors.ValidationError(
                        "Comments must be an array."
                    );

                }

                const safeLimit = CS.Utils.clamp(

                    limit,

                    1,

                    CS.Config.MAX_COMMENT_LIMIT

                );

                const selectedComments = comments.slice(

                    0,

                    safeLimit

                );

                if (!selectedComments.length) {

                    return [];

                }

                const predictions = await predictBatch(
                    selectedComments
                );

                if (

                    predictions.length !==

                    selectedComments.length

                ) {

                    throw new CS.Errors.ValidationError(

                        "Prediction count mismatch."

                    );

                }

                return selectedComments.map(

                    (comment, index) => ({

                        id: comment.id,

                        element: comment.element,

                        text: comment.text,

                        fingerprint: comment.fingerprint,

                        sentiment:
                            predictions[index].sentiment,

                        confidence:
                            predictions[index].confidence

                    })

                );

            },

            {

                fallback: [],

                timer: true

            }

        );

    }

    /* ==================================================
       Public API
    ================================================== */

    return Object.freeze({

        health,

        predict,

        analyze

    });

})();

/* ======================================================
   End of File
====================================================== */