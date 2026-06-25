/*
======================================================
CommentSense v2

ui.js

Comment decoration layer.

Responsibilities
------------------------------------------------------
✓ Decorate analyzed comments
✓ Add sentiment pill
✓ Add confidence tooltip
✓ Apply sentiment styling
✓ Clear decorations

No API calls.
No cache.
No filtering.
No toolbar.
======================================================
*/

"use strict";

/* ======================================================
   UI
====================================================== */

const UI = (() => {

    const MODULE = CS.Constants.Modules.UI;

    /**
     * Create sentiment pill.
     *
     * @param {string} sentiment
     * @param {number} confidence
     * @returns {HTMLElement}
     */
    function createPill(sentiment, confidence) {

        const pill = CS.DOM.create(
            "span",
            `cs-pill cs-pill-${sentiment}`
        );

        pill.textContent =
            sentiment.charAt(0).toUpperCase() +
            sentiment.slice(1);

        pill.title =
            `Confidence: ${CS.Utils.formatPercent(confidence)}`;

        pill.dataset.commentsense = "true";

        return pill;

    }

    /**
     * Remove existing decoration.
     *
     * Makes decoration idempotent.
     */
    function removeExisting(commentElement) {

        const existing = CS.DOM.query(

            '[data-commentsense="true"]',

            commentElement

        );

        if (existing) {

            CS.DOM.remove(existing);

        }

        commentElement.classList.remove(

            "cs-comment-positive",

            "cs-comment-neutral",

            "cs-comment-negative"

        );

    }

    /**
     * Decorate one comment.
     */
    function decorateComment(comment) {

        if (

            !comment ||

            !comment.element

        ) {

            return;

        }

        removeExisting(comment.element);

        comment.element.dataset.csSentiment =
            comment.sentiment;

        comment.element.dataset.csConfidence =
            comment.confidence;

        comment.element.classList.add(

            `cs-comment-${comment.sentiment}`

        );

        const author = CS.DOM.queryFirst(

            CS.Constants.Selectors.AUTHOR,

            comment.element

        );

        if (!author) {

            return;

        }

        const pill = createPill(

            comment.sentiment,

            comment.confidence

        );

        author.appendChild(pill);

    }

    /**
     * Decorate analyzed comments.
     *
     * @param {Array<Object>} comments
     */
    function decorate(comments = []) {

        if (!CS.Validate.isArray(comments)) {

            CS.Logger.warn(

                MODULE,

                "Invalid comments."

            );

            return;

        }

        for (const comment of comments) {

            decorateComment(comment);

        }

        CS.Logger.debug(

            MODULE,

            `Decorated ${comments.length} comments.`

        );

    }

    /**
     * Re-render comments.
     */
    function refresh(comments = []) {

        clear(comments);

        decorate(comments);

    }

    /**
     * Remove all CommentSense decorations.
     */
    function clear(comments = []) {

        if (!CS.Validate.isArray(comments)) {

            return;

        }

        for (const comment of comments) {

            if (

                !comment ||

                !comment.element

            ) {

                continue;

            }

            removeExisting(comment.element);

            delete comment.element.dataset.csSentiment;

            delete comment.element.dataset.csConfidence;

        }

    }

    return Object.freeze({

        decorate,

        refresh,

        clear

    });

})();