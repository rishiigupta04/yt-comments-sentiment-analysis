/*
======================================================
CommentSense v2

popup.js

Popup Controller

Responsibilities
------------------------------------------------------
✓ Initialize popup
✓ Check API health
✓ Send analysis request
✓ Update popup UI

No AI inference.
No cache.
No DOM scanning.
======================================================
*/

"use strict";

/* ======================================================
   Popup
====================================================== */

(() => {

    /* ==================================================
       DOM References
    ================================================== */

    const statusElement =
        document.getElementById("cs-status");

    const apiStatusElement =
        document.getElementById("cs-api-status");

    const analyzeButton =
        document.getElementById("cs-analyze");

    const limitSelect =
        document.getElementById("cs-limit");

    const versionElement =
        document.getElementById("cs-version");

    /* ==================================================
       UI Helpers
    ================================================== */

    function setStatus(

        text,

        className

    ) {

        statusElement.className =

            `cs-status ${className}`;

        statusElement.innerHTML = `

<span class="cs-status-dot">

●

</span>

<span>${text}</span>

`;

    }

    function setApiStatus(

        text,

        className

    ) {

        apiStatusElement.className =

            `cs-badge ${className}`;

        apiStatusElement.textContent =

            text;

    }

    function setLoading(

        loading

    ) {

        analyzeButton.disabled =

            loading;

        analyzeButton.textContent =

            loading

                ? "Analyzing..."

                : "Analyze";

    }

    /* ==================================================
       Backend Health
    ================================================== */

    async function checkApiHealth() {

        setApiStatus(

            "Checking...",

            "cs-badge-loading"

        );

        try {

            const response = await fetch(

                `${CS.Config.API_BASE_URL}/health`

            );

            if (!response.ok) {

                throw new Error(

                    `HTTP ${response.status}`

                );

            }

            setApiStatus(

                "Online",

                "cs-badge-online"

            );

            return true;

        }

        catch (error) {

            console.error(error);

            setApiStatus(

                "Offline",

                "cs-badge-offline"

            );

            return false;

        }

    }

    /* ==================================================
       Chrome Helpers
    ================================================== */

    async function getActiveTab() {

        const tabs = await chrome.tabs.query({

            active: true,

            currentWindow: true

        });

        return tabs[0] ?? null;

    }

    async function validateYouTubeTab() {

        const tab = await getActiveTab();

        if (!tab) {

            throw new Error(

                "No active tab found."

            );

        }

        if (

            !tab.url ||

            !tab.url.includes(

                "youtube.com/watch"

            )

        ) {

            throw new Error(

                "Open a YouTube video before starting analysis."

            );

        }

        return tab;

    }

    /* ==================================================
       Continues in Part 1B...
    ================================================== */




    /* ==================================================
       Messaging
    ================================================== */

    async function sendAnalysisRequest(

        tab,

        limit

    ) {

        try {

            const response = await chrome.tabs.sendMessage(

                tab.id,

                {

                    action:

                        CS.Constants.Messages.START_ANALYSIS,

                    limit

                }

            );

            if (!response) {

                throw new Error(

                    "No response from content script."

                );

            }

            return response;

        }

        catch (error) {

            if (

                error?.message?.includes(

                    "Receiving end does not exist"

                )

            ) {

                throw new Error(

                    "CommentSense is not available on this page. Open a YouTube video and refresh the page."

                );

            }

            throw error;

        }

    }

    /* ==================================================
       Analyze
    ================================================== */

    async function handleAnalyze() {

        setLoading(true);

        setStatus(

            "Analyzing...",

            "cs-status-analyzing"

        );

        try {

            const apiOnline =

                await checkApiHealth();

            if (!apiOnline) {

                throw new Error(

                    "API is offline."

                );

            }

            const tab =

                await validateYouTubeTab();

            const limit = Number(

                limitSelect.value

            );

            const response =

                await sendAnalysisRequest(

                    tab,

                    limit

                );

            if (

                !response.success

            ) {

                throw new Error(

                    response.error ||

                    "Analysis failed."

                );

            }

            setStatus(

                "Analysis Complete",

                "cs-status-ready"

            );

            analyzeButton.textContent =

                "Analyze Again";

        }

        catch (error) {

            console.error(error);

            setStatus(

                "Analysis Failed",

                "cs-status-error"

            );



setApiStatus(

    error.message,

    "cs-badge-offline"

);

            analyzeButton.textContent =

                "Try Again";

        }

        finally {

            analyzeButton.disabled = false;

        }

    }

    /* ==================================================
       Continues in Part 2...
    ================================================== */


    /* ==================================================
       Initialization
    ================================================== */

    async function initialize() {
const versionElement =
        document.getElementById("cs-version");
        try {

            versionElement.textContent =

                `Version ${CS.VERSION}`;

            setStatus(

                "Ready",

                "cs-status-ready"

            );

            await checkApiHealth();

            analyzeButton.addEventListener(

                "click",

                handleAnalyze

            );

            CS.Logger.info(

                "POPUP",

                "Popup initialized."

            );

        }

        catch (error) {

            console.error(error);

            setStatus(

                "Initialization Failed",

                "cs-status-error"

            );

            setApiStatus(

                "Unavailable",

                "cs-badge-offline"

            );

            analyzeButton.disabled = true;

        }

    }

    /* ==================================================
       Startup
    ================================================== */

    document.addEventListener(

        "DOMContentLoaded",

        initialize,

        {

            once: true
         }
    );

    })();