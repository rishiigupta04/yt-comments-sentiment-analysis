/**
 * CommentSense — content script (v2)
 * -----------------------------------------------------------------------
 * Architecture overview
 *
 *   Config          static constants
 *   Utils            pure, stateless helpers
 *   CacheManager     per-video, per-count localStorage cache with TTL
 *   CommentLoader    forces YouTube to render >= N comments into the DOM
 *   PredictionApi    single HTTP call to the sentiment endpoint
 *   SentimentEngine  builds analysis records, rehydrates cache, summarizes
 *   Toolbar          renders the summary bar + filter controls
 *   CommentTagger    renders/clears per-comment tag, highlight, and filter
 *   SessionManager   the only module holding mutable runtime state;
 *                    orchestrates everything and is what SPA-nav resets
 *   ProgressBridge   long-lived Port to the popup: relays real-time
 *                    loading/predicting/rendering progress, then the result
 *
 * This file replaces the previous ~1300-line monolith. The original had
 * three concrete bugs this rewrite fixes (not just refactors):
 *
 *   1. Comment loading never actually scrolled. The scroll-to-target
 *      function existed but was commented out and never called, so
 *      "analyze 250/500" silently analyzed whatever ~20 comments YouTube
 *      had already rendered. CommentLoader.loadAtLeast() below is the
 *      real implementation of that intent.
 *   2. The cache-hit path sliced cached results to whatever count of
 *      comment elements currently existed in the DOM, regardless of how
 *      many were originally requested or analyzed — a 500-comment
 *      analysis, re-opened on a page that had only rendered 20 comments
 *      so far, would silently report a 20-comment "cache hit". The cache
 *      is now keyed by (videoId, requestedCount) and a low DOM-match
 *      rate forces a fresh prediction instead of a misleading partial one.
 *   3. There was no SPA-navigation handling at all — switching videos
 *      left the old toolbar, tags, and highlights in place. SessionManager
 *      now resets fully on `yt-navigate-finish`.
 *
 * Module ownership of state: SessionManager is the single source of
 * mutable truth. Every other module is either stateless (Utils,
 * CommentLoader, PredictionApi, SentimentEngine) or only holds disposable
 * DOM handles it created itself (Toolbar, CommentTagger). That is what
 * makes `SessionManager.reset()` a complete, reliable teardown.
 * -----------------------------------------------------------------------
 */

(() => {
    "use strict";

    // =====================================================================
    // Config
    // =====================================================================

    const Config = Object.freeze({
        apiEndpoint:
            "https://rishigupta04-yt-comments-sentiment-analyzer.hf.space/predict_batch",

        cacheTtlMs: 6 * 60 * 60 * 1000, // 6 hours — matches the original CACHE_HOURS
        cacheNamespace: "commentsense_v2_",

        allowedCounts: [100, 250, 500],
        defaultCount: 100,

        // Comment loading
        loadTimeoutMs: 90000,
        commentsSectionTimeoutMs: 20000,
        scrollStepDelayMs: 800,
        maxStagnantRounds: 5,

        // Prediction API resilience. The HF Space backing this endpoint is
        // a free-tier Space that can be asleep and take 10-30s to cold
        // start, so a single un-retried fetch with no timeout was the
        // single most likely point of total failure in a long analysis.
        apiTimeoutMs: 45000,
        apiMaxAttempts: 3,
        apiRetryBaseDelayMs: 1500,

        toolbarId: "commentsense-toolbar",
        tagClass: "cs-tag",
        highlightClass: "cs-highlight",
        styleTagId: "commentsense-styles",
        bannerId: "commentsense-banner",

        // Progress phases reported to the popup over the long-lived port.
        // Rough weight of each phase within the overall 0-100% bar — only
        // "loading" has real sub-progress (a live comment count), the rest
        // are single discrete steps so they just jump the bar forward.
        // "busy" and "retrying" are status pings, not bar-advancing phases.
        progressPhases: {
            waitingSection: { key: "waiting-section", weight: 5 },
            loading: { key: "loading", weight: 70 },
            predicting: { key: "predicting", weight: 20 },
            rendering: { key: "rendering", weight: 5 }
        },

        sentiments: {
            positive: { label: "Positive", emoji: "🟢", color: "#22c55e" },
            neutral: { label: "Neutral", emoji: "⚪", color: "#94a3b8" },
            negative: { label: "Negative", emoji: "🔴", color: "#ef4444" }
        }
    });

    // =====================================================================
    // Utils — pure helpers, no shared state
    // =====================================================================

    const Utils = {
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        getVideoId() {
            return new URLSearchParams(window.location.search).get("v");
        },

        normalizeSentiment(rawLabel) {
            const key = String(rawLabel || "").toLowerCase().trim();
            return Config.sentiments[key] ? key : "neutral";
        },

        clampCount(count) {
            return Config.allowedCounts.includes(count) ? count : Config.defaultCount;
        },

        capitalize(word) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
    };

    // =====================================================================
    // CacheManager — per-video, per-count prediction cache with TTL
    // =====================================================================

    const CacheManager = {
        keyFor(videoId) {
            return `${Config.cacheNamespace}${videoId || "unknown"}`;
        },

        /**
         * Returns cached records for a video only if present, unexpired,
         * AND saved for the same requested count. The original cache
         * happily served a 500-comment cache entry to a 100-comment
         * request (and vice versa, truncated) — that mismatch is what
         * caused misleading "cached" results. We require an exact match
         * and let the caller fall back to a fresh prediction otherwise.
         */
        load(videoId, requestedCount) {
            const raw = localStorage.getItem(this.keyFor(videoId));
            if (!raw) return null;

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                this.clear(videoId);
                return null;
            }

            const isExpired = Date.now() - parsed.timestamp > Config.cacheTtlMs;
            const isWrongCount = parsed.requestedCount !== requestedCount;

            if (isExpired || isWrongCount || !Array.isArray(parsed.records)) {
                if (isExpired) this.clear(videoId);
                return null;
            }

            return parsed.records;
        },

        save(videoId, requestedCount, records) {
            try {
                localStorage.setItem(
                    this.keyFor(videoId),
                    JSON.stringify({ timestamp: Date.now(), requestedCount, records })
                );
            } catch (error) {
                // Quota exceeded or storage disabled — non-fatal, just skip caching.
                console.warn("[CommentSense] cache write skipped:", error);
            }
        },

        clear(videoId) {
            localStorage.removeItem(this.keyFor(videoId));
        }
    };

    // =====================================================================
    // CommentLoader — drives YouTube's lazy-loaded comment list
    // =====================================================================

    const CommentLoader = {
        /** Live query against comment-text nodes currently in the DOM. */
        queryCommentTextNodes() {
            return Array.from(
                document.querySelectorAll("ytd-comment-thread-renderer #content-text")
            ).filter(el => el.innerText.trim().length > 0);
        },

        /** Waits for at least one comment to exist (mirrors the original's wait, kept as-is since it works). */
        async waitForCommentsSection(onProgress) {
            const deadline = Date.now() + Config.commentsSectionTimeoutMs;

            while (Date.now() < deadline) {
                if (document.querySelectorAll("#content-text").length > 0) return true;
                onProgress?.(0);
                window.scrollBy(0, 600); // nudge YouTube into mounting the comments section
                await Utils.sleep(500);
            }

            return false;
        },

        /**
         * Scrolls the real page (not a detached/hidden container — that
         * mismatch is a common cause of "blank comments section" bugs,
         * since YouTube's lazy-render pager listens for page-level
         * intersection, not arbitrary scroll events) in fixed steps until:
         *
         *   - `targetCount` comment threads are present, or
         *   - the hard timeout is hit, or
         *   - loading has stagnated for `maxStagnantRounds` consecutive
         *     rounds (YouTube has run out of comments, or the network/UI
         *     is stuck) — this is what makes the loop reliably terminate
         *     instead of scrolling forever, the core reliability problem
         *     the original left unsolved by never actually running this.
         *
         * Returns the final list of comment-text elements, in DOM order,
         * capped at targetCount.
         *
         * @param {number} targetCount
         * @param {(loaded: number, target: number) => void} [onProgress]
         *   Called with the live comment count after every scroll round,
         *   so the popup can render real "loaded 140/250" progress instead
         *   of a generic spinner during the slowest phase of analysis.
         */
        async loadAtLeast(targetCount, onProgress) {
            const sectionReady = await this.waitForCommentsSection(onProgress);
            if (!sectionReady) {
                throw new Error("Comments have not loaded yet. Scroll to comments first.");
            }

            const deadline = Date.now() + Config.loadTimeoutMs;
            let stagnantRounds = 0;
            let previousCount = this.queryCommentTextNodes().length;
            onProgress?.(Math.min(previousCount, targetCount), targetCount);

            while (
                previousCount < targetCount &&
                Date.now() < deadline &&
                stagnantRounds < Config.maxStagnantRounds
            ) {
                window.scrollTo(0, document.documentElement.scrollHeight);
                await Utils.sleep(Config.scrollStepDelayMs);

                const currentCount = this.queryCommentTextNodes().length;
                stagnantRounds = currentCount > previousCount ? 0 : stagnantRounds + 1;
                previousCount = currentCount;
                onProgress?.(Math.min(currentCount, targetCount), targetCount);
            }

            // Settle: let any in-flight render finish before we snapshot,
            // so we don't capture half-rendered comment nodes.
            await Utils.sleep(300);
            return this.queryCommentTextNodes().slice(0, targetCount);
        }
    };

    // =====================================================================
    // PredictionApi — single batch HTTP call, with timeout + retry
    // -----------------------------------------------------------------------
    // The HF Space backing this endpoint is a free-tier Space: it sleeps
    // when idle and can take 10-30s to cold-start on the next request. A
    // bare, un-retried fetch with no timeout meant that one slow wake-up
    // (or one transient network hiccup) silently killed an entire 250/500
    // comment analysis after all the scrolling work was already done.
    // This wraps the same single logical request in a timeout + a small
    // number of retries with exponential backoff, and is still exactly
    // "one request per analysis" in the success case — retries only fire
    // on failure, not speculatively.
    // =====================================================================

    const PredictionApi = {
        async _fetchOnce(texts) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Config.apiTimeoutMs);

            try {
                const response = await fetch(Config.apiEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ texts }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const error = new Error(`Prediction API returned ${response.status}`);
                    // 4xx means our request itself is malformed — retrying
                    // an identical request won't change that, so callers
                    // should fail fast rather than burn retry budget on it.
                    error.isRetryable = response.status >= 500;
                    throw error;
                }

                const data = await response.json();

                if (!Array.isArray(data.predictions) || data.predictions.length !== texts.length) {
                    const error = new Error("Prediction API returned a malformed response.");
                    error.isRetryable = false;
                    throw error;
                }

                return data.predictions;
            } catch (error) {
                if (error.name === "AbortError") {
                    const timeoutError = new Error("Prediction API timed out.");
                    timeoutError.isRetryable = true;
                    throw timeoutError;
                }
                // Network failure (DNS, connection refused, offline) has no
                // isRetryable flag yet — default it to retryable, since
                // these are exactly the transient cases retries help with.
                if (error.isRetryable === undefined) error.isRetryable = true;
                throw error;
            } finally {
                clearTimeout(timer);
            }
        },

        /**
         * @param {string[]} texts
         * @param {(attempt: number, maxAttempts: number) => void} [onRetry]
         *   Called right before each retry attempt (not on the first try),
         *   so the caller can surface "retrying (2/3)…" instead of the UI
         *   going silent during a cold-start retry window.
         * @returns {Promise<{sentiment: string, confidence: number}[]>}
         */
        async predictBatch(texts, onRetry) {
            let lastError;

            for (let attempt = 1; attempt <= Config.apiMaxAttempts; attempt++) {
                try {
                    return await this._fetchOnce(texts);
                } catch (error) {
                    lastError = error;

                    const isLastAttempt = attempt === Config.apiMaxAttempts;
                    if (!error.isRetryable || isLastAttempt) break;

                    onRetry?.(attempt + 1, Config.apiMaxAttempts);
                    const backoffMs = Config.apiRetryBaseDelayMs * 2 ** (attempt - 1);
                    await Utils.sleep(backoffMs);
                }
            }

            throw lastError;
        }
    };

    // =====================================================================
    // SentimentEngine — pure data layer: builds & summarizes analysis records
    // =====================================================================

    const SentimentEngine = {
        /** Zips comment elements with their predictions into records. */
        buildRecords(elements, predictions) {
            return elements.map((element, index) => {
                const prediction = predictions[index] || {};
                return {
                    element,
                    text: element.innerText.trim(),
                    sentiment: Utils.normalizeSentiment(prediction.sentiment),
                    confidence: typeof prediction.confidence === "number" ? prediction.confidence : 0
                };
            });
        },

        /** Serializable form for caching (DOM elements can't survive JSON). */
        toCacheable(records) {
            return records.map(({ text, sentiment, confidence }) => ({ text, sentiment, confidence }));
        },

        /**
         * Rehydrates cached records against the *current* DOM by matching
         * comment text. Comments YouTube didn't re-render this time are
         * simply skipped. Returns null (a cache "miss") if the match rate
         * is too low — e.g. comments changed, or a different subset
         * rendered this time — so the caller falls back to a fresh
         * prediction instead of silently showing a near-empty analysis.
         */
        fromCache(cachedRecords, liveElements) {
            const textToPrediction = new Map(cachedRecords.map(r => [r.text, r]));

            const matched = liveElements
                .map(element => {
                    const text = element.innerText.trim();
                    const cached = textToPrediction.get(text);
                    if (!cached) return null;
                    return { element, text, sentiment: cached.sentiment, confidence: cached.confidence };
                })
                .filter(Boolean);

            const matchRate = liveElements.length ? matched.length / liveElements.length : 0;
            return matchRate >= 0.8 ? matched : null;
        },

        summarize(records) {
            const counts = { positive: 0, neutral: 0, negative: 0 };
            let confidenceSum = 0;

            for (const record of records) {
                counts[record.sentiment] += 1;
                confidenceSum += record.confidence;
            }

            return {
                total: records.length,
                counts,
                averageConfidence: records.length ? confidenceSum / records.length : 0
            };
        }
    };

    // =====================================================================
    // Toolbar — summary UI injected above the comments section
    // =====================================================================

    const Toolbar = {
        ensureStylesInjected() {
            if (document.getElementById(Config.styleTagId)) return;

            const style = document.createElement("style");
            style.id = Config.styleTagId;
            style.textContent = `
                #${Config.toolbarId} {
                    margin-bottom: 20px;
                    font-family: Inter, Roboto, sans-serif;
                }
                #${Config.toolbarId} .cs-card {
                    background: linear-gradient(145deg, #0f172a, #111827);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 20px;
                    padding: 20px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
                    color: #fff;
                }
                #${Config.toolbarId} .cs-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 18px;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                #${Config.toolbarId} .cs-brand {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }
                #${Config.toolbarId} .cs-logo {
                    width: 42px;
                    height: 42px;
                    border-radius: 12px;
                }
                #${Config.toolbarId} .cs-title {
                    font-size: 18px;
                    font-weight: 700;
                }
                #${Config.toolbarId} .cs-subtitle {
                    font-size: 12px;
                    color: #94a3b8;
                }
                #${Config.toolbarId} .cs-analyzed {
                    padding: 6px 12px;
                    border-radius: 999px;
                    background: rgba(99, 102, 241, 0.15);
                    font-size: 12px;
                    color: #a5b4fc;
                    white-space: nowrap;
                }
                #${Config.toolbarId} .cs-metrics {
                    margin-bottom: 14px;
                    color: #94a3b8;
                    font-size: 13px;
                }
                #${Config.toolbarId} .cs-buttons {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                #${Config.toolbarId} .cs-buttons button {
                    border: none;
                    cursor: pointer;
                    padding: 10px 16px;
                    border-radius: 999px;
                    font-weight: 600;
                    color: #fff;
                    background: rgba(255, 255, 255, 0.06);
                    transition: background 0.15s ease;
                }
                #${Config.toolbarId} .cs-buttons button[data-active="true"] {
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                }
                #${Config.toolbarId} .cs-active-filter {
                    margin-top: 14px;
                    padding: 10px;
                    border-radius: 12px;
                    background: rgba(255, 255, 255, 0.05);
                    font-size: 13px;
                    color: #cbd5e1;
                }
                .${Config.tagClass} {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: 8px;
                    padding: 4px 10px;
                    border-radius: 999px;
                    background: #1f2937;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    font-size: 12px;
                    font-weight: 600;
                }
                .cs-tag-label {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .cs-confidence-pill {
                    padding: 2px 8px;
                    border-radius: 999px;
                    background: rgba(255, 255, 255, 0.10);
                    color: #e2e8f0;
                    font-size: 11px;
                    font-weight: 700;
                }
                .${Config.highlightClass} {
                    border-radius: 12px;
                    padding: 8px;
                }
                ytd-comment-thread-renderer.cs-filtered-out {
                    display: none !important;
                }
                #${Config.bannerId} {
                    position: fixed;
                    top: 16px;
                    right: 16px;
                    z-index: 9999;
                    max-width: 320px;
                    padding: 12px 16px;
                    border-radius: 12px;
                    font-family: Inter, Roboto, sans-serif;
                    font-size: 13px;
                    line-height: 1.4;
                    color: #fff;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    animation: cs-banner-in 0.2s ease-out;
                }
                #${Config.bannerId}[data-kind="error"] {
                    background: linear-gradient(145deg, #7f1d1d, #450a0a);
                }
                #${Config.bannerId}[data-kind="info"] {
                    background: linear-gradient(145deg, #0f172a, #111827);
                }
                @keyframes cs-banner-in {
                    from { opacity: 0; transform: translateY(-8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        },

        findInsertionPoint() {
            return document.querySelector("ytd-comments#comments") || document.querySelector("ytd-comments");
        },

        /** Renders (or re-renders in place) the toolbar for a given summary + active filter. */
        render(summary, activeFilter, callbacks) {
            this.ensureStylesInjected();

            const anchor = this.findInsertionPoint();
            if (!anchor) return; // page navigated away mid-render; nothing to attach to

            let toolbar = document.getElementById(Config.toolbarId);
            if (!toolbar) {
                toolbar = document.createElement("div");
                toolbar.id = Config.toolbarId;
                anchor.prepend(toolbar);
            }

            const filterLabel = activeFilter === "all"
                ? "All Comments"
                : `${Utils.capitalize(activeFilter)} Comments`;

            toolbar.innerHTML = `
                <div class="cs-card">
                    <div class="cs-header">
                        <div class="cs-brand">
                            <img src="${chrome.runtime.getURL("assets/icon.png")}" class="cs-logo" alt="">
                            <div>
                                <div class="cs-title">CommentSense</div>
                                <div class="cs-subtitle">Understanding YouTube Sentiment</div>
                            </div>
                        </div>
                        <div class="cs-analyzed">${summary.total} Analyzed</div>
                    </div>
                    <div class="cs-metrics">
                        Avg Confidence: ${Math.round(summary.averageConfidence * 100)}%
                    </div>
                    <div class="cs-buttons">
                        <button data-filter="all" data-active="${activeFilter === "all"}">
                            Show All
                        </button>
                        <button data-filter="positive" data-active="${activeFilter === "positive"}">
                            🟢 Positive (${summary.counts.positive})
                        </button>
                        <button data-filter="neutral" data-active="${activeFilter === "neutral"}">
                            ⚪ Neutral (${summary.counts.neutral})
                        </button>
                        <button data-filter="negative" data-active="${activeFilter === "negative"}">
                            🔴 Negative (${summary.counts.negative})
                        </button>
                    </div>
                    <div class="cs-active-filter">Showing: ${filterLabel}</div>
                </div>
            `;

            toolbar.querySelectorAll("button[data-filter]").forEach(button => {
                button.addEventListener("click", () => callbacks.onFilterSelect(button.dataset.filter));
            });
        },

        remove() {
            document.getElementById(Config.toolbarId)?.remove();
        },

        /**
         * Shows a transient, auto-dismissing notification in the corner of
         * the page. This is the only place an error or partial-load notice
         * was visible before: the popup's #status text, which disappears
         * the instant the popup closes. A page-level banner means the
         * person still sees what happened even if they weren't watching
         * the popup when it finished (a real scenario for 500-comment
         * analyses that can run for a minute or more).
         */
        showBanner(message, kind = "info", durationMs = 6000) {
            this.ensureStylesInjected();

            document.getElementById(Config.bannerId)?.remove();

            const banner = document.createElement("div");
            banner.id = Config.bannerId;
            banner.dataset.kind = kind;
            banner.textContent = message;
            document.body.appendChild(banner);

            setTimeout(() => banner.remove(), durationMs);
        }
    };

    // =====================================================================
    // CommentTagger — per-comment sentiment tag + highlight + filter visibility
    // =====================================================================

    const CommentTagger = {
        /**
         * Renders the sentiment tag next to the comment author's name and
         * a subtle background highlight on the whole thread. Tag placement
         * matches the original (#header-author), since that's what keeps
         * the tag visually attached to "who said this" rather than
         * floating above the comment body.
         */
        applyTag(record) {
            const thread = record.element.closest("ytd-comment-thread-renderer");
            const authorLine = thread?.querySelector("#header-author");
            if (!thread || !authorLine) return;

            this.clearTag(thread);

            const meta = Config.sentiments[record.sentiment];
            const confidence = Math.round(record.confidence * 100);

            const tag = document.createElement("span");
            tag.className = Config.tagClass;
            tag.innerHTML = `
                <span class="cs-tag-label" style="color:${meta.color}">
                    ${meta.emoji} ${meta.label}
                </span>
                <span class="cs-confidence-pill">
                    <span style="opacity:.7;font-weight:500;">Confidence</span>
                    <strong>${confidence}%</strong>
                </span>
            `;
            authorLine.appendChild(tag);

            const opacity = Math.max(0.05, record.confidence * 0.12);
            thread.classList.add(Config.highlightClass);
            thread.style.background = this._rgbaFor(record.sentiment, opacity);
            thread.style.borderLeft = `3px solid ${meta.color}`;
        },

        _rgbaFor(sentiment, opacity) {
            const rgb = { positive: "34,197,94", neutral: "148,163,184", negative: "239,68,68" }[sentiment];
            return `rgba(${rgb}, ${opacity})`;
        },

        clearTag(thread) {
            thread.querySelectorAll(`.${Config.tagClass}`).forEach(tag => tag.remove());
            thread.classList.remove(Config.highlightClass);
            thread.style.background = "";
            thread.style.borderLeft = "";
        },

        clearAll() {
            document.querySelectorAll("ytd-comment-thread-renderer").forEach(thread => {
                this.clearTag(thread);
                thread.classList.remove("cs-filtered-out");
            });
        },

        /** Shows only threads matching the filter ("all" shows everything). */
        applyFilter(records, filterKey) {
            const visibleElements = filterKey === "all"
                ? null
                : new Set(records.filter(r => r.sentiment === filterKey).map(r => r.element));

            for (const record of records) {
                const thread = record.element.closest("ytd-comment-thread-renderer");
                if (!thread) continue;
                const shouldHide = visibleElements !== null && !visibleElements.has(record.element);
                thread.classList.toggle("cs-filtered-out", shouldHide);
            }
        }
    };

    // =====================================================================
    // SessionManager — the only module holding mutable runtime state.
    // Owns the lifecycle of a single "analysis" and is fully reset on nav.
    // =====================================================================

    const SessionManager = {
        videoId: null,
        records: [],
        activeFilter: "all",
        isAnalyzing: false,

        initialize() {
            this.videoId = Utils.getVideoId();
            this._bindNavigation();
        },

        _bindNavigation() {
            // The original had no navigation handling at all, which is why
            // switching videos left the old toolbar/tags/highlights in
            // place. yt-navigate-finish fires on every SPA route change
            // (including non-video pages), so we re-check the video id
            // ourselves rather than trusting the event alone.
            document.addEventListener("yt-navigate-finish", () => this._handleNavigation());
            window.addEventListener("beforeunload", () => this.reset());
        },

        _handleNavigation() {
            const nextVideoId = Utils.getVideoId();
            if (nextVideoId === this.videoId) return;

            this.videoId = nextVideoId;
            this.reset();
        },

        /** Full teardown — returns the page to a "fresh load" state. */
        reset() {
            Toolbar.remove();
            CommentTagger.clearAll();

            this.records = [];
            this.activeFilter = "all";
            this.isAnalyzing = false;
        },

        /**
         * @param {number} requestedCount
         * @param {(phase: string, detail?: object) => void} [onProgress]
         *   Fired at each phase transition (and on every scroll round during
         *   "loading", and before each retry during "predicting") so the
         *   caller can drive a real-time progress bar. Optional — callers
         *   that don't care about progress can omit it.
         */
        async analyze(requestedCount, onProgress) {
            const report = (phaseKey, detail) => onProgress?.(phaseKey, detail);

            if (this.isAnalyzing) {
                // The popup's own button is disabled during an analysis,
                // but if the popup is closed and reopened mid-analysis, a
                // second click is otherwise possible and would previously
                // just throw with no feedback on the new port. Report it
                // as a status instead of leaving the new caller guessing.
                report("busy");
                const busyError = new Error("An analysis is already in progress.");
                busyError.isExpected = true; // not a fault — skip error-level banner/logging
                throw busyError;
            }

            const count = Utils.clampCount(requestedCount);
            const videoId = Utils.getVideoId();
            this.isAnalyzing = true;

            try {
                const cached = CacheManager.load(videoId, count);

                report(Config.progressPhases.waitingSection.key);
                const liveElements = await CommentLoader.loadAtLeast(count, (loaded, target) => {
                    report(Config.progressPhases.loading.key, { loaded, target });
                });

                if (liveElements.length === 0) {
                    throw new Error("No comments found.");
                }

                const rehydrated = cached ? SentimentEngine.fromCache(cached, liveElements) : null;

                if (rehydrated) {
                    this.records = rehydrated;
                } else {
                    report(Config.progressPhases.predicting.key);
                    const predictions = await PredictionApi.predictBatch(
                        liveElements.map(el => el.innerText.trim()),
                        (attempt, maxAttempts) => report("retrying", { attempt, maxAttempts })
                    );

                    this.records = SentimentEngine.buildRecords(liveElements, predictions);
                    CacheManager.save(videoId, count, SentimentEngine.toCacheable(this.records));
                }

                report(Config.progressPhases.rendering.key);
                this.activeFilter = "all";
                this._renderAll();

                // requestedCount vs count.length lets the caller tell "got
                // everything you asked for" apart from "loading stagnated
                // early" (YouTube ran out of comments, or it was slow) —
                // previously this distinction was silently lost.
                const isPartial = this.records.length < count;
                if (isPartial) {
                    Toolbar.showBanner(
                        `Loaded ${this.records.length} of ${count} requested — no more comments were available to load.`
                    );
                }

                return { success: true, count: this.records.length, requested: count, isPartial };
            } finally {
                this.isAnalyzing = false;
            }
        },

        setFilter(filterKey) {
            this.activeFilter = filterKey;
            this._renderAll();
        },

        _renderAll() {
            for (const record of this.records) {
                CommentTagger.applyTag(record);
            }
            CommentTagger.applyFilter(this.records, this.activeFilter);

            Toolbar.render(SentimentEngine.summarize(this.records), this.activeFilter, {
                onFilterSelect: filterKey => this.setFilter(filterKey)
            });
        }
    };

    // =====================================================================
    // ProgressBridge — wires popup <-> SessionManager over a long-lived Port
    // -----------------------------------------------------------------------
    // A one-shot chrome.runtime.sendMessage/onMessage round-trip can only
    // deliver a single final response, so there's no channel for the
    // content script to push interim progress while a 250/500-comment
    // analysis is still scrolling. A Port stays open for the duration of
    // the analysis, so we can post {type: "progress", ...} messages as
    // CommentLoader makes headway, then a final {type: "result", ...}.
    // =====================================================================

    const ProgressBridge = {
        initialize() {
            chrome.runtime.onConnect.addListener(port => {
                if (port.name !== "commentsense-analyze") return;

                port.onMessage.addListener(message => {
                    if (message?.action !== "analyze") return;

                    SessionManager.analyze(message.count, (phase, detail) => {
                        this._postSafely(port, { type: "progress", phase, detail });
                    })
                        .then(result => this._postSafely(port, { type: "result", ...result }))
                        .catch(error => {
                            if (!error.isExpected) {
                                console.error("[CommentSense] analysis failed:", error);
                                // The popup's #status text disappears the
                                // moment it's closed — this banner is what
                                // makes a failure visible if the person
                                // wasn't watching the popup when a long
                                // analysis finished.
                                Toolbar.showBanner(error.message || "Analysis failed.", "error");
                            }
                            this._postSafely(port, {
                                type: "result",
                                success: false,
                                error: error.message
                            });
                        });
                });
            });
        },

        /** The popup can close at any time (e.g. user closes it mid-analysis); posting to a closed port throws. */
        _postSafely(port, payload) {
            try {
                port.postMessage(payload);
            } catch {
                // Popup is gone — analysis keeps running in the page itself
                // (tags/toolbar still get applied), there's just no one
                // listening for progress anymore. Nothing to do here.
            }
        }
    };

    // =====================================================================
    // Entry point
    // =====================================================================

    SessionManager.initialize();
    ProgressBridge.initialize();
})();