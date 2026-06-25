/*
======================================================
CommentSense v2

content.js

Application Controller

Responsibilities
------------------------------------------------------
✓ Receive popup commands
✓ Manage AppState
✓ Extract comments
✓ Generate fingerprint
✓ Coordinate modules

No rendering.
No styling.
No business logic inside services.
======================================================
*/

"use strict";

/* ======================================================
   Application State
====================================================== */
let currentVideoId = null;

let navigationObserver = null;


const AppState = {

    videoId: null,

    fingerprint: null,

    commentLimit: CS.Config.DEFAULT_COMMENT_LIMIT,

    currentFilter: CS.Constants.Filters.ALL,

    fromCache: false,

    loadedComments: [],

    analyzedComments: [],

    stats: {

        loaded: 0,

        analyzed: 0,

        positive: 0,

        neutral: 0,

        negative: 0,

        confidence: 0

    },

    analyzing: false,

    toolbarInjected: false

};

/* ======================================================
   Controller
====================================================== */

(() => {

    const MODULE = CS.Constants.Modules.CONTENT;

    /* ==================================================
       Private Helpers
    ================================================== */

    function updateStatistics() {

        const stats = {

            loaded: AppState.loadedComments.length,

            analyzed: AppState.analyzedComments.length,

            positive: 0,

            neutral: 0,

            negative: 0,

            confidence: 0

        };

        let confidenceSum = 0;

        for (const comment of AppState.analyzedComments) {

            switch (comment.sentiment) {

                case CS.Constants.Sentiments.POSITIVE:
                    stats.positive++;
                    break;

                case CS.Constants.Sentiments.NEUTRAL:
                    stats.neutral++;
                    break;

                case CS.Constants.Sentiments.NEGATIVE:
                    stats.negative++;
                    break;

            }

            confidenceSum += comment.confidence;

        }

        if (stats.analyzed) {

            stats.confidence =

                (confidenceSum / stats.analyzed) * 100;

        }

        AppState.stats = stats;

    }

  /**
 * Creates a deterministic UTF-8 safe comment ID.
 *
 * @param {string} author
 * @param {string} text
 * @returns {Promise<string>}
 */
async function createCommentId(author, text) {

    const encoder = new TextEncoder();

    const data = encoder.encode(

        `${author.trim()}|${text.trim()}`

    );

    const hashBuffer = await crypto.subtle.digest(

        "SHA-256",

        data

    );

    return [...new Uint8Array(hashBuffer)]

        .map(byte =>

            byte.toString(16).padStart(2, "0")

        )

        .join("");

}

    async function extractComments(limit) {

        const threads =

            CS.YouTube

                .getCommentThreads()

                .slice(0, limit);

        const comments = [];

        for (const thread of threads) {

            const text =

                CS.YouTube

                    .getCommentText(thread);

            if (

                !CS.Validate.isNonEmptyString(text)

            ) {

                continue;

            }

            const author =

                CS.YouTube

                    .getAuthor(thread);

           const id = await createCommentId(
    author,
    text
);

            comments.push({

                id,

                fingerprint: id,

                element: thread,

                author,

                text

            });

        }

        return comments;

    }

    function generateFingerprint(comments) {

        if (!comments.length) {

            return "";

        }

        const first = comments[0]?.text ?? "";

        const middle =

            comments[

                Math.floor(

                    comments.length / 2

                )

            ]?.text ?? "";

        const last =

            comments[

                comments.length - 1

            ]?.text ?? "";

        return btoa(

            `${first}|${middle}|${last}|${comments.length}`

        ).replace(/=/g, "");

    }

    async function ensureToolbar() {

        if (AppState.toolbarInjected) {

            return;

        }

        Toolbar.inject();

        AppState.toolbarInjected = true;

    }

    async function waitForComments() {

        const comments =

            await CS.YouTube.waitForComments();

        if (!comments.length) {

            throw new CS.Errors.DOMError(

                "No comments loaded."

            );

        }

    }

    /* ==================================================
       Popup Messages
    ================================================== */

    chrome.runtime.onMessage.addListener(

        (message, sender, sendResponse) => {

            if (

                !message ||

                message.action !==

                CS.Constants.Messages.START_ANALYSIS

            ) {

                return;

            }

            AppState.commentLimit =

                Number(

                    message.limit ||

                    CS.Config.DEFAULT_COMMENT_LIMIT

                );

            startAnalysis()

                .then(() => {

                    sendResponse({

                        success: true,

                        count:

                            AppState.stats.analyzed,

                        cached:

                            AppState.fromCache

                    });

                })

                .catch(error => {

                    CS.Logger.error(

                        MODULE,

                        error

                    );

                    sendResponse({

                        success: false,

                        error:

                            error.message

                    });

                });

            return true;

        }

    );

    /* ==================================================
       Analysis Entry Point

       Continues in Part 2...
    ================================================== */


    async function startAnalysis() {

        if (AppState.analyzing) {

            CS.Logger.warn(

                MODULE,

                "Analysis already in progress."

            );

            return;

        }

        AppState.analyzing = true;

        try {

            await ensureToolbar();

            Toolbar.setStatus(

                CS.Constants.Status.ANALYZING

            );

            await waitForComments();

            AppState.videoId =

                CS.YouTube.getVideoId();

            AppState.loadedComments = await

                extractComments(

                    AppState.commentLimit

                );

            AppState.fingerprint =

                generateFingerprint(

                    AppState.loadedComments

                );

            /* ==========================================
               Cache Restore
            ========================================== */

            const cache = await CacheManager.load(

                AppState.videoId,

                AppState.fingerprint

            );

            if (cache) {

                AppState.fromCache = true;

                AppState.analyzedComments =

                    Object.values(

                        cache.comments

                    ).map(item => {

                        const source =

                            AppState.loadedComments.find(

                                comment =>

                                    comment.id === item.id

                            );

                        return {

                            id: item.id,

                            fingerprint:

                                item.fingerprint,

                            element:

                                source?.element || null,

                            text: item.text,

                            sentiment:

                                item.sentiment,

                            confidence:

                                item.confidence

                        };

                    });

            }

            else {

                AppState.fromCache = false;

                AppState.analyzedComments = [];

            }

            /* ==========================================
               Incremental Analysis
            ========================================== */

            const analyzedIds = new Set(

                AppState.analyzedComments.map(

                    comment => comment.id

                )

            );

            const pendingComments =

                AppState.loadedComments.filter(

                    comment =>

                        !analyzedIds.has(

                            comment.id

                        )

                );

            if (pendingComments.length) {

                const predictions =

                    await Analyzer.analyze(

                        pendingComments,

                        pendingComments.length

                    );

                AppState.analyzedComments.push(

                    ...predictions

                );

                if (AppState.fromCache) {

                    await CacheManager.merge(

                        AppState.videoId,

                        AppState.fingerprint,

                        predictions

                    );

                }

                else {

                    await CacheManager.save(

                        AppState.videoId,

                        AppState.fingerprint,

                        AppState.analyzedComments

                    );

                }

            }

            /* ==========================================
               UI
            ========================================== */

            UI.decorate(

                AppState.analyzedComments

            );

            Filters.apply(

                AppState.currentFilter,

                AppState.analyzedComments

            );

            updateStatistics();

            Toolbar.update({

                loaded:

                    AppState.stats.loaded,

                analyzed:

                    AppState.stats.analyzed,

                positive:

                    AppState.stats.positive,

                neutral:

                    AppState.stats.neutral,

                negative:

                    AppState.stats.negative,

                confidence:

                    AppState.stats.confidence,

                currentFilter:

                    AppState.currentFilter,

                status:

                    AppState.fromCache

                        ? CS.Constants.Status.CACHE

                        : CS.Constants.Status.READY

            });

            CS.Logger.info(

                MODULE,

                `Analysis completed (${AppState.stats.analyzed} comments).`

            );

        }

        catch (error) {

            Toolbar.setStatus(

                CS.Constants.Status.ERROR

            );

            CS.Logger.error(

                MODULE,

                error

            );

            throw error;

        }

        finally {

            AppState.analyzing = false;

        }

    }

    /* ==================================================
       Event Handling

       Continues in Part 3...
    ================================================== */

    /* ==================================================
       Event Handling
    ================================================== */
const listeners = [];
function bindEvents() {

    /* ----------------------------------------------
       Refresh
    ---------------------------------------------- */

    const refreshHandler = async () => {

        if (AppState.analyzing) {

            return;

        }

        CS.Logger.info(

            MODULE,

            "Refresh requested."

        );

        await startAnalysis();

    };

    listeners.push({

        event: CS.Constants.Events.REFRESH,

        callback: refreshHandler

    });

    CS.EventBus.on(

        CS.Constants.Events.REFRESH,

        refreshHandler

    );

    /* ----------------------------------------------
       Filter
    ---------------------------------------------- */

    const filterHandler = event => {

        const filter =

            event.detail?.filter ??

            CS.Constants.Filters.ALL;

        AppState.currentFilter = filter;

        Filters.apply(

            filter,

            AppState.analyzedComments

        );

        Toolbar.update({

            ...AppState.stats,

            currentFilter: filter,

            status: AppState.fromCache

                ? CS.Constants.Status.CACHE

                : CS.Constants.Status.READY

        });

    };

    listeners.push({

        event: CS.Constants.Events.FILTER,

        callback: filterHandler

    });

    CS.EventBus.on(

        CS.Constants.Events.FILTER,

        filterHandler

    );

    /* ----------------------------------------------
       Collapse
    ---------------------------------------------- */

    const collapseHandler = () => {

        CS.Logger.debug(

            MODULE,

            "Toolbar collapsed state changed."

        );

    };

    listeners.push({

        event: CS.Constants.Events.COLLAPSE,

        callback: collapseHandler

    });

    CS.EventBus.on(

        CS.Constants.Events.COLLAPSE,

        collapseHandler

    );

}

    /* ==================================================
       Mutation Observer

       Watches YouTube for newly loaded comments.
       Does NOT auto-analyze.

       Refresh button remains user controlled.
    ================================================== */

    let observer = null;

    function startObserver() {

        if (observer) {

            return;

        }

        observer = new MutationObserver(() => {

            const latestComments =

                extractComments(

                    AppState.commentLimit

                );

            AppState.loadedComments = latestComments;

            updateStatistics();

            if (AppState.toolbarInjected) {

                Toolbar.update({

                    ...AppState.stats,

                    currentFilter:

                        AppState.currentFilter,

                    status:

                        AppState.fromCache

                            ? CS.Constants.Status.CACHE

                            : CS.Constants.Status.READY

                });

            }

        });

        const commentsRoot = CS.DOM.query(

    CS.Constants.Selectors.COMMENTS_SECTION

);

if (!commentsRoot) {

    return;

}

observer.observe(

    commentsRoot,

    {

        childList: true,

        subtree: true

    }

);

        CS.Logger.info(

            MODULE,

            "MutationObserver started."

        );

    }

    function stopObserver() {

        if (!observer) {

            return;

        }

        observer.disconnect();

        observer = null;

    }

//     async function handleVideoNavigation() {
//
//     const nextVideoId = CS.YouTube.getVideoId();
//
//     if (!nextVideoId) {
//
//         return;
//
//     }
//
//     if (nextVideoId === currentVideoId) {
//
//         return;
//
//     }
//
//     currentVideoId = nextVideoId;
//
//     stopObserver();
//
//     Toolbar.destroy();
//
//     Object.assign(AppState, {
//
//         videoId: nextVideoId,
//
//         fingerprint: null,
//
//         fromCache: false,
//
//         loadedComments: [],
//
//         analyzedComments: [],
//
//         analyzing: false,
//
//         toolbarInjected: false,
//
//         currentFilter: CS.Constants.Filters.ALL,
//
//         stats: {
//
//             loaded: 0,
//
//             analyzed: 0,
//
//             positive: 0,
//
//             neutral: 0,
//
//             negative: 0,
//
//             confidence: 0
//
//         }
//
//     });
//
//     await ensureToolbar();
//
//     startObserver();
//
//     Toolbar.update({
//
//         loaded: 0,
//
//         analyzed: 0,
//
//         positive: 0,
//
//         neutral: 0,
//
//         negative: 0,
//
//         confidence: 0,
//
//         currentFilter: AppState.currentFilter,
//
//         status: CS.Constants.Status.READY
//
//     });
//
//     CS.Logger.info(
//
//         MODULE,
//
//         `Navigated to video ${nextVideoId}`
//
//     );
//
// }

    /* ==================================================
       Startup
    ================================================== */

    async function initialize() {

    try {

        AppState.videoId =

            CS.YouTube.getVideoId();

        if (!AppState.videoId) {

            return;

        }

        await CacheManager.cleanup();

        /*
         * Wait until YouTube has rendered
         * the comments section before
         * injecting the toolbar.
         */
        await CS.YouTube.waitForComments();

        await ensureToolbar();

        bindEvents();

        startObserver();

        Toolbar.update({

            loaded: 0,

            analyzed: 0,

            positive: 0,

            neutral: 0,

            negative: 0,

            confidence: 0,

            currentFilter:

                AppState.currentFilter,

            status:

                CS.Constants.Status.READY

        });

        CS.Logger.info(

            MODULE,

            "Content controller initialized."

        );

    }

    catch (error) {

        CS.Logger.error(

            MODULE,

            error

        );

    }

}

//  initialize().then(() => {
//
//     startNavigationWatcher();
//
// });
    initialize()

//     function startNavigationWatcher() {
//
//     currentVideoId =
//
//         CS.YouTube.getVideoId();
//
//     navigationObserver =
//
//         new MutationObserver(() => {
//
//             handleVideoNavigation();
//
//         });
//
//     navigationObserver.observe(
//
//         document.body,
//
//         {
//
//             childList: true,
//
//             subtree: true
//
//         }
//
//     );
//
// }

    /* ==================================================
       Cleanup

       Future-proof hook for SPA navigation.
    ================================================== */

   window.addEventListener(

    "beforeunload",

    () => {

        stopObserver();

        navigationObserver?.disconnect();


        for (const listener of listeners) {

    CS.EventBus.off(

        listener.event,

        listener.callback

    );

}

listeners.length = 0;
         Toolbar.destroy();

    }

);

})();

/* ======================================================
   End of File
====================================================== */