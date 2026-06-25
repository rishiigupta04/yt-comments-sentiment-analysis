
/*
======================================================
CommentSense v2

filters.js

Comment filtering.

Responsibilities
------------------------------------------------------
✓ Filter analyzed comments
✓ Toggle visibility

No API calls.
No cache.
No UI rendering.
No toolbar.
======================================================
*/

"use strict";

/* ======================================================
   Filters
====================================================== */

const Filters = (() => {

    const MODULE = CS.Constants.Modules.FILTERS;

    /**
     * Apply sentiment filter.
     *
     * @param {string} filter
     * @param {Array<Object>} comments
     */
    function apply(filter, comments = []) {

        if (!CS.Validate.isArray(comments)) {

            CS.Logger.warn(

                MODULE,

                "Invalid comments array."

            );

            return;

        }

        const hiddenClass =

            CS.Constants.Classes.HIDDEN;

        for (const comment of comments) {

            if (

                !comment ||

                !comment.element

            ) {

                continue;

            }

            const visible =

                filter === CS.Constants.Filters.ALL ||

                comment.sentiment === filter;

            comment.element.classList.toggle(

                hiddenClass,

                !visible

            );

        }

        CS.Logger.debug(

            MODULE,

            `Applied filter: ${filter}`

        );

    }

    return Object.freeze({

        apply

    });

})();