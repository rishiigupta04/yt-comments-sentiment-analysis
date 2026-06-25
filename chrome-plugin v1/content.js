let storedResults = [];

let selectedCount = 100;

let isAnalyzing = false;

const CACHE_HOURS = 6;

chrome.runtime.onMessage.addListener(

    async (
        message,
        sender,
        sendResponse
    ) => {

        if (
            message.action ===
            "analyze"
        ) {

            if (
                isAnalyzing
            ) {

                sendResponse({

                    success: false
                });

                return true;
            }

            selectedCount =
            message.count || 100;

            try {

                isAnalyzing =
                true;

                await analyzeComments();

                sendResponse({

                    success: true,

                    count:
                    storedResults.length
                });
            }

            catch (error) {

                console.error(
                    error
                );

                sendResponse({

                    success: false
                });
            }

            finally {

                isAnalyzing =
                false;
            }

            return true;
        }
    }
);

function getVideoId() {

    const params =

    new URLSearchParams(

        window.location.search
    );

    return params.get("v");
}

function getCacheKey() {

    const videoId =
    getVideoId();

    return `commentsense_${videoId}`;
}

function getCachedResults() {

    const cacheKey =
    getCacheKey();

    const cached =

    localStorage.getItem(
        cacheKey
    );

    if (
        !cached
    ) {

        return null;
    }

    const parsed =
    JSON.parse(cached);

    const ageHours =

        (
            Date.now()
            -
            parsed.timestamp
        )

        /

        (1000 * 60 * 60);

    if (
        ageHours >
        CACHE_HOURS
    ) {

        localStorage.removeItem(
            cacheKey
        );

        return null;
    }

    return parsed.results;
}

function saveCachedResults(
    results
) {

    localStorage.setItem(

        getCacheKey(),

        JSON.stringify({

            timestamp:
            Date.now(),

            results
        })
    );
}

// async function loadCommentsUntilTarget() {
//
//     const originalScroll =
//
//     window.scrollY;
//
//     let previousCount = 0;
//
//     let stagnantCount = 0;
//
//     while (true) {
//
//         const comments =
//
//         document.querySelectorAll(
//
//             "ytd-comment-thread-renderer #content-text"
//         );
//
//         const currentCount =
//         comments.length;
//
//         updateStatusBadge(
//
//             "loading",
//
//             currentCount
//         );
//
//         if (
//             currentCount >=
//             selectedCount
//         ) {
//
//             break;
//         }
//
//         window.scrollBy(
//             0,
//             2500
//         );
//
//         await new Promise(
//
//             resolve =>
//
//             setTimeout(
//
//                 resolve,
//
//                 1500
//             )
//         );
//
//         if (
//
//             currentCount ===
//             previousCount
//
//         ) {
//
//             stagnantCount++;
//
//             if (
//                 stagnantCount >= 3
//             ) {
//
//                 break;
//             }
//         }
//
//         else {
//
//             stagnantCount = 0;
//         }
//
//         previousCount =
//         currentCount;
//     }
//
//     window.scrollTo(
//
//         0,
//
//         originalScroll
//     );
// }

function getCommentElements() {

    return Array.from(

        document.querySelectorAll(

            "ytd-comment-thread-renderer #content-text"
        )

    )

    .filter(

        element =>

        element.innerText
        .trim()
        .length > 0
    )

    .slice(
        0,
        selectedCount
    );
}

async function predictComments(
    comments
) {

    const response =

    await fetch(

        "https://rishigupta04-yt-comments-sentiment-analyzer.hf.space/predict_batch",

        {

            method: "POST",

            headers: {

                "Content-Type":
                "application/json"
            },

            body:
            JSON.stringify({

                texts:
                comments
            })
        }
    );

    if (
        !response.ok
    ) {

        throw new Error(

            `API Error:
            ${response.status}`
        );
    }

    const data =

    await response.json();

    return data.predictions;
}

function calculateAverageConfidence() {

    if (
        storedResults.length === 0
    ) {

        return 0;
    }

    const total =

    storedResults.reduce(

        (
            sum,
            item
        ) =>

        sum +
        item.confidence,

        0
    );

    return Math.round(

        (total /
        storedResults.length)

        * 100
    );
}

function countSentiments() {

    const counts = {

        positive: 0,

        neutral: 0,

        negative: 0
    };

    storedResults.forEach(

        result => {

            counts[
                result.sentiment
            ]++;
        }
    );

    return counts;
}

async function analyzeComments() {

    updateStatusBadge(
        "loading"
    );
    const commentsReady =

await waitForCommentsSection();

if (
    !commentsReady
) {

    alert(
        "Comments have not loaded yet. Scroll to comments first."
    );

    return;
}



    // await loadCommentsUntilTarget();

    const commentElements =

    getCommentElements();

    if (
        commentElements.length === 0
    ) {

        alert(
            "No comments found."
        );

        return;
    }

    const cachedResults =

    getCachedResults();

    if (
        cachedResults
    ) {

        storedResults =

        cachedResults

        .slice(
            0,
            commentElements.length
        )

        .map(

            (
                result,
                index
            ) => ({

                ...result,

                element:
                commentElements[index]
            })
        );

        injectToolbar();

        colorComments();

        addSentimentTags();

        updateFilterBadge(
            "All Comments"
        );

        updateStatusBadge(
            "cached"
        );

        return;
    }

    updateStatusBadge(
        "analyzing"
    );

    const comments =

    commentElements.map(

        element =>

        element.innerText.trim()
    );

    const predictions =

    await predictComments(
        comments
    );

    storedResults =

    predictions.map(

        (
            prediction,
            index
        ) => ({

            sentiment:
            prediction.sentiment,

            confidence:
            prediction.confidence,

            text:
            comments[index],

            element:
            commentElements[index]
        })
    );

    saveCachedResults(

        storedResults.map(

            result => ({

                sentiment:
                result.sentiment,

                confidence:
                result.confidence,

                text:
                result.text
            })
        )
    );

    injectToolbar();

    colorComments();

    addSentimentTags();

    updateFilterBadge(
        "All Comments"
    );

    updateStatusBadge(
        "ready"
    );
}

function injectToolbar() {

    const existingToolbar =

    document.getElementById(
        "commentsense-toolbar"
    );

    if (
        existingToolbar
    ) {

        existingToolbar.remove();
    }

    const counts =
    countSentiments();

    const avgConfidence =
    calculateAverageConfidence();

    const toolbar =

    document.createElement(
        "div"
    );

    toolbar.id =
    "commentsense-toolbar";

    toolbar.innerHTML = `

<div class="cs-card">

    <div class="cs-header">

        <div class="cs-brand">

            <img
                src="${chrome.runtime.getURL(
                    "assets/icon.png"
                )}"
                class="cs-logo"
            >

            <div>

                <div class="cs-title">

                    CommentSense

                </div>

                <div class="cs-subtitle">

                    Understanding YouTube Sentiment

                </div>

            </div>

        </div>

        <div class="cs-header-right">

            <div
                id="cs-status"
                class="cs-status"
            >

                Ready

            </div>

            <div class="cs-analyzed">

                ${storedResults.length}
                Analyzed

            </div>

        </div>

    </div>

    <div class="cs-metrics">

        Avg Confidence:
        ${avgConfidence}%

    </div>

    <div class="cs-buttons">

        <button id="cs-positive">

            Positive (${counts.positive})

        </button>

        <button id="cs-neutral">

            Neutral (${counts.neutral})

        </button>

        <button id="cs-negative">

            Negative (${counts.negative})

        </button>

        <button id="cs-showall">

            Show All

        </button>

    </div>

    <div
        id="cs-active-filter"
        class="cs-active-filter"
    >

        Showing:
        All Comments

    </div>

</div>

<style>

#commentsense-toolbar {

margin-bottom:20px;

font-family:
Inter,
sans-serif;
}

.cs-card {

background:

linear-gradient(
145deg,
#0f172a,
#111827
);

border:
1px solid rgba(
255,
255,
255,
0.08
);

border-radius:
20px;

padding:
20px;

box-shadow:
0 10px 25px rgba(
0,
0,
0,
0.25
);
}

.cs-header {

display:flex;

justify-content:
space-between;

align-items:center;

margin-bottom:18px;
}

.cs-brand {

display:flex;

gap:12px;

align-items:center;
}

.cs-logo {

width:42px;

height:42px;

border-radius:12px;
}

.cs-title {

font-size:18px;

font-weight:700;

color:white;
}

.cs-subtitle {

font-size:12px;

color:#94a3b8;
}

.cs-header-right {

display:flex;

flex-direction:column;

align-items:flex-end;

gap:6px;
}

.cs-status {

padding:6px 12px;

border-radius:999px;

background:
rgba(
255,
255,
255,
0.05
);

font-size:12px;

color:#cbd5e1;
}

.cs-analyzed {

padding:6px 12px;

border-radius:999px;

background:
rgba(
99,
102,
241,
0.15
);

font-size:12px;

color:#a5b4fc;
}

.cs-metrics {

margin-bottom:14px;

color:#94a3b8;

font-size:13px;
}

.cs-buttons {

display:flex;

gap:10px;

flex-wrap:wrap;
}

.cs-buttons button {

border:none;

cursor:pointer;

padding:
10px 16px;

border-radius:
999px;

font-weight:600;

color:white;

background:
linear-gradient(
135deg,
#6366f1,
#8b5cf6
);
}

.cs-active-filter {

margin-top:14px;

padding:10px;

border-radius:12px;

background:
rgba(
255,
255,
255,
0.05
);

font-size:13px;

color:#cbd5e1;
}

</style>

`;

    const commentsSection =

    document.querySelector(
        "ytd-comments"
    );

    if (
        commentsSection
    ) {

        commentsSection.prepend(
            toolbar
        );
    }

    attachFilterListeners();
}

function updateStatusBadge(
    status,
    count = null
) {

    const badge =

    document.getElementById(
        "cs-status"
    );

    if (
        !badge
    ) return;

    let text =
    "Ready";

    if (
        status ===
        "loading"
    ) {

        text =

        count
        ?

        `Loading (${count})`

        :

        "Loading Comments";
    }

    else if (
        status ===
        "analyzing"
    ) {

        text =
        "Analyzing";
    }

    else if (
        status ===
        "cached"
    ) {

        text =
        "⚡ Cached";
    }

    badge.innerHTML =
    text;
}

function updateFilterBadge(
    text
) {

    const badge =

    document.getElementById(
        "cs-active-filter"
    );

    if (
        badge
    ) {

        badge.innerHTML =

        `Showing: ${text}`;
    }
}
function colorComments() {

    storedResults.forEach(

        result => {

            const container =

            result.element
            ?.closest(

                "ytd-comment-thread-renderer"
            );

            if (
                !container
            ) return;

            const opacity =

            Math.max(

                0.05,

                result.confidence
                * 0.12
            );

            if (
                result.sentiment ===
                "positive"
            ) {

                container.style.background =

                `rgba(
                    34,
                    197,
                    94,
                    ${opacity}
                )`;

                container.style.borderLeft =
                "3px solid #22c55e";
            }

            else if (
                result.sentiment ===
                "negative"
            ) {

                container.style.background =

                `rgba(
                    239,
                    68,
                    68,
                    ${opacity}
                )`;

                container.style.borderLeft =
                "3px solid #ef4444";
            }

            else {

                container.style.background =

                `rgba(
                    148,
                    163,
                    184,
                    ${opacity}
                )`;

                container.style.borderLeft =
                "3px solid #94a3b8";
            }

            container.style.borderRadius =
            "12px";

            container.style.padding =
            "8px";
        }
    );
}
function addSentimentTags() {

    storedResults.forEach(

        result => {

            const authorLine =

            result.element
            ?.closest(
                "ytd-comment-thread-renderer"
            )

            ?.querySelector(
                "#header-author"
            );

            if (
                !authorLine
            ) return;

            authorLine
            .querySelectorAll(
                ".cs-tag"
            )
            .forEach(

                tag =>
                tag.remove()
            );

            const tag =

            document.createElement(
                "span"
            );

            tag.className =
            "cs-tag";

            tag.title =

            `Confidence:
            ${Math.round(
                result.confidence
                * 100
            )}%`;

            let color =
            "#94a3b8";

            if (
                result.sentiment ===
                "positive"
            ) {

                color =
                "#22c55e";
            }

            if (
                result.sentiment ===
                "negative"
            ) {

                color =
                "#ef4444";
            }

            tag.style.marginLeft =
            "8px";

            tag.style.color =
            color;

            tag.style.fontWeight =
            "600";

            tag.style.fontSize =
            "12px";

            tag.innerHTML =

            `● ${
                result.sentiment
                .charAt(0)
                .toUpperCase()

                +

                result.sentiment
                .slice(1)
            }`;

            authorLine.appendChild(
                tag
            );
        }
    );
}

function filterComments(
    sentiment
) {

    storedResults.forEach(

        result => {

            const container =

            result.element
            ?.closest(
                "ytd-comment-thread-renderer"
            );

            if (
                !container
            ) return;

            if (
                result.sentiment ===
                sentiment
            ) {

                container.style.display =
                "block";
            }

            else {

                container.style.display =
                "none";
            }
        }
    );

    updateFilterBadge(

        sentiment.charAt(0)
        .toUpperCase()

        +

        sentiment.slice(1)

        +

        " Comments"
    );
}

function showAllComments() {

    storedResults.forEach(

        result => {

            const container =

            result.element
            ?.closest(
                "ytd-comment-thread-renderer"
            );

            if (
                container
            ) {

                container.style.display =
                "block";
            }
        }
    );

    updateFilterBadge(
        "All Comments"
    );
}

function attachFilterListeners() {

    document
    .getElementById(
        "cs-positive"
    )
    .onclick = () =>
    filterComments(
        "positive"
    );

    document
    .getElementById(
        "cs-neutral"
    )
    .onclick = () =>
    filterComments(
        "neutral"
    );

    document
    .getElementById(
        "cs-negative"
    )
    .onclick = () =>
    filterComments(
        "negative"
    );

    document
    .getElementById(
        "cs-showall"
    )
    .onclick =
    showAllComments;
}

    async function waitForCommentsSection() {

    for (
        let i = 0;
        i < 20;
        i++
    ) {

        const comments =

        document.querySelectorAll(
            "#content-text"
        );

        if (
            comments.length > 0
        ) {

            return true;
        }

        await new Promise(

            resolve =>

            setTimeout(
                resolve,
                1000
            )
        );
    }

    return false;
}