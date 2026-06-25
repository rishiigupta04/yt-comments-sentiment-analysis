/*
======================================================
CommentSense v2

toolbar.js

Owns ONLY the toolbar.

Responsibilities
------------------------------------------------------
✓ Inject toolbar
✓ Cache DOM references
✓ Bind events

No API calls.
No cache.
No filtering.
No DOM scanning.
======================================================
*/

"use strict";

/* ======================================================
   Toolbar
====================================================== */

const Toolbar = (() => {

    const MODULE = CS.Constants.Modules.TOOLBAR;

    let root = null;

    let collapsed = false;

    const refs = {

        status: null,

        loaded: null,

        analyzed: null,

        confidence: null,

        positive: null,

        neutral: null,

        negative: null,

        filter: null,

        refreshButton: null,

        collapseButton: null

    };

    /* ==================================================
       Build Toolbar
    ================================================== */
    function buildToolbar() {

        const container = CS.DOM.create(

            "aside",

            "cs-toolbar"

        );

        container.id = CS.Config.TOOLBAR_ID;

        container.innerHTML = `

<header class="cs-header">

<div class="cs-title">

<img
class="cs-logo"
src="${chrome.runtime.getURL("assets/icon.png")}"
alt="CommentSense">

<span>CommentSense</span>

</div>

<button
class="cs-collapse-btn"
type="button"
title="Collapse">

▾

</button>

</header>

<div class="cs-body">

<div
class="cs-status cs-status-ready">

<span>

●

</span>

<span
data-role="status">

Ready

</span>

</div>

<div class="cs-divider"></div>

<div class="cs-stats">

<div class="cs-card">

<div class="cs-card-title">

Loaded

</div>

<div
class="cs-card-value"
data-role="loaded">

0

</div>

</div>

<div class="cs-card">

<div class="cs-card-title">

Analyzed

</div>

<div
class="cs-card-value"
data-role="analyzed">

0

</div>

</div>

</div>

<div class="cs-card">

<div class="cs-card-title">

Average Confidence

</div>

<div
class="cs-card-value"
data-role="confidence">

0%

</div>

</div>

<div class="cs-divider"></div>

<div class="cs-filter-group">

<button
class="cs-btn cs-filter"
data-filter="all">

All

</button>

<button
class="cs-btn cs-filter"
data-filter="positive">

Positive (0)

</button>

<button
class="cs-btn cs-filter"
data-filter="neutral">

Neutral (0)

</button>

<button
class="cs-btn cs-filter"
data-filter="negative">

Negative (0)

</button>

</div>

<div class="cs-divider"></div>

<div class="cs-row">

<button
class="cs-btn cs-btn-primary"
data-role="refresh">

Refresh

</button>

<div
class="cs-badge"

data-role="current-filter">

All

</div>

</div>

<div class="cs-divider"></div>

<div class="cs-row">

<div>

Positive

</div>

<div
class="cs-pill cs-pill-positive"

data-role="positive">

0

</div>

</div>

<div class="cs-row">

<div>

Neutral

</div>

<div
class="cs-pill cs-pill-neutral"

data-role="neutral">

0

</div>

</div>

<div class="cs-row">

<div>

Negative

</div>

<div
class="cs-pill cs-pill-negative"

data-role="negative">

0

</div>

</div>

</div>

`;

        return container;

    }

    /* ==================================================
       Cache DOM References
    ================================================== */

    function cacheRefs() {

        refs.status = CS.DOM.query('[data-role="status"]', root);

        refs.loaded =

            root.querySelector(

                '[data-role="loaded"]'

            );

        refs.analyzed =

            root.querySelector(

                '[data-role="analyzed"]'

            );

        refs.confidence =

            root.querySelector(

                '[data-role="confidence"]'

            );

        refs.positive =

            root.querySelector(

                '[data-role="positive"]'

            );

        refs.neutral =

            root.querySelector(

                '[data-role="neutral"]'

            );

        refs.negative =

            root.querySelector(

                '[data-role="negative"]'

            );

        refs.filter =

            root.querySelector(

                '[data-role="current-filter"]'

            );

        refs.refreshButton =

            root.querySelector(

                '[data-role="refresh"]'

            );

        refs.collapseButton =

            root.querySelector(

                ".cs-collapse-btn"

            );

    }

    /* ==================================================
       Events
    ================================================== */

    function bindEvents() {

        refs.refreshButton.addEventListener(

            "click",

            () => {

                CS.EventBus.emit(

                    CS.Constants.Events.REFRESH

                );

            }

        );

        CS.DOM.queryAll("[data-filter]", root

        ).forEach(button => {

            button.addEventListener(

                "click",

                () => {

                    CS.EventBus.emit(

                        CS.Constants.Events.FILTER,

                        {

                            filter:

                                button.dataset.filter

                        }

                    );

                }

            );

        });

        refs.collapseButton.addEventListener(

            "click",

            () => {

                collapsed = !collapsed;


                                root.classList.toggle(

                    CS.Constants.Classes.COLLAPSED,

                    collapsed

                );

                refs.collapseButton.textContent =

                    collapsed ? "▸" : "▾";

                CS.EventBus.emit(

                    CS.Constants.Events.COLLAPSE,

                    {

                        collapsed

                    }

                );

            }

        );

    }

    /* ==================================================
       Private Helpers
    ================================================== */

    function resetStatusClasses() {

        root.classList.remove(

            "cs-status-ready",

            "cs-status-analyzing",

            "cs-status-cache",

            "cs-status-offline",

            "cs-status-error"

        );

    }

    function updateStatus(status) {

        resetStatusClasses();

        const statusElement = CS.DOM.query(

            ".cs-status",

            root

        );

        switch (status) {

            case CS.Constants.Status.ANALYZING:

                statusElement.classList.add(

                    "cs-status-analyzing"

                );

                refs.status.textContent = "Analyzing";

                break;

            case CS.Constants.Status.CACHE:

                statusElement.classList.add(

                    "cs-status-cache"

                );

                refs.status.textContent =

                    "Loaded from Cache";

                break;

            case CS.Constants.Status.OFFLINE:

                statusElement.classList.add(

                    "cs-status-offline"

                );

                refs.status.textContent =

                    "API Offline";

                break;

            case CS.Constants.Status.ERROR:

                statusElement.classList.add(

                    "cs-status-error"

                );

                refs.status.textContent = "Error";

                break;

            default:

                statusElement.classList.add(

                    "cs-status-ready"

                );

                refs.status.textContent = "Ready";

        }

        refs.refreshButton.disabled =

    status ===

    CS.Constants.Status.ANALYZING;

    }

    function updateStatistics(data) {

        CS.DOM.text(

            refs.loaded,

            CS.Utils.formatNumber(

                data.loaded ?? 0

            )

        );

        CS.DOM.text(

            refs.analyzed,

            CS.Utils.formatNumber(

                data.analyzed ?? 0

            )

        );

        CS.DOM.text(

            refs.confidence,

            CS.Utils.formatPercent(

                data.confidence ?? 0

            )

        );

        CS.DOM.text(
    refs.positive,
    `Positive (${data.positive ?? 0})`
);

        CS.DOM.text(
    refs.neutral,
    `Neutral (${data.neutral ?? 0})`
);

      CS.DOM.text(
    refs.negative,
    `Negative (${data.negative ?? 0})`
);

        CS.DOM.text(

            refs.filter,

            data.currentFilter ?? "All"

        );

    }

    /* ==================================================
       Public API
    ================================================== */

    function inject() {

        if (root) {

            return;

        }

        const anchor = CS.DOM.query(

            CS.Constants.Selectors.TOOLBAR_ANCHOR

        );

        if (!anchor) {

            CS.Logger.warn(

                MODULE,

                "Toolbar anchor not found."

            );

            return;

        }

        root = buildToolbar();

anchor.prepend(root);

cacheRefs();

bindEvents();

        CS.Logger.info(

            MODULE,

            "Toolbar injected."

        );

    }

    function update(data = {}) {

        if (!root) {

            return;

        }

        updateStatus(

            data.status ??

            CS.Constants.Status.READY

        );

        updateStatistics(data);

    }

    function setStatus(status) {

        if (!root) {

            return;

        }

        updateStatus(status);

    }

    function destroy() {

        if (!root) {

            return;

        }

        root.remove();

        root = null;

        collapsed = false;

        Object.keys(refs).forEach(key => {

            refs[key] = null;

        });

        CS.Logger.info(

            MODULE,

            "Toolbar destroyed."

        );

    }

    return Object.freeze({

        inject,

        update,

        setStatus,

        destroy

    });

})();

/* ======================================================
   End of File
====================================================== */