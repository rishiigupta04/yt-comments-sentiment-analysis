const analyzeBtn = document.getElementById("analyzeBtn");
const status = document.getElementById("status");
const commentCount = document.getElementById("commentCount");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

// Mirrors content.js's Config.progressPhases. Kept in sync manually since
// popup.js (a separate extension context) can't import content.js's
// internal Config object — there's no module system across that boundary
// in a classic MV3 popup + content script pair.
const PHASE_WEIGHTS = {
    "waiting-section": 5,
    "loading": 70,
    "predicting": 20,
    "rendering": 5
};

const PHASE_LABELS = {
    "waiting-section": "Waiting for comments to load…",
    "loading": "Loading comments…",
    "predicting": "Running sentiment analysis…",
    "rendering": "Rendering results…"
};

function cumulativeWeightBefore(phaseKey) {
    const order = ["waiting-section", "loading", "predicting", "rendering"];
    const index = order.indexOf(phaseKey);
    return order.slice(0, index).reduce((sum, key) => sum + PHASE_WEIGHTS[key], 0);
}

function showProgress() {
    progressWrap.hidden = false;
    setProgress("waiting-section");
}

function hideProgress() {
    progressWrap.hidden = true;
    progressFill.classList.remove("is-indeterminate");
    progressFill.style.width = "0%";
}

/**
 * Renders one progress update. "loading" has a real loaded/target count
 * from the content script, so it gets a precise percentage within its
 * weighted slice of the bar. Every other phase is a single indeterminate
 * step — there's no meaningful sub-progress for "one fetch is in flight"
 * or "tagging finished comments", so those phases animate instead of
 * showing a number that would be fake precision.
 *
 * "retrying" and "busy" aren't bar-advancing phases — they're status
 * overlays. "retrying" fires mid-"predicting" when the API call needed a
 * retry (e.g. the backing Space was cold-starting), so the bar stays put
 * but the label says so instead of going silent for up to ~45s per
 * attempt. "busy" means a second analysis was requested while one was
 * already running in the page (e.g. popup closed and reopened mid-run).
 */
function setProgress(phaseKey, detail) {
    if (phaseKey === "retrying") {
        progressFill.classList.add("is-indeterminate");
        progressLabel.textContent = `Retrying… (attempt ${detail.attempt}/${detail.maxAttempts})`;
        return;
    }

    if (phaseKey === "busy") {
        progressLabel.textContent = "An analysis is already running on this page…";
        return;
    }

    const base = cumulativeWeightBefore(phaseKey);
    const weight = PHASE_WEIGHTS[phaseKey] ?? 0;

    if (phaseKey === "loading" && detail?.target) {
        const fraction = Math.min(detail.loaded / detail.target, 1);
        progressFill.classList.remove("is-indeterminate");
        progressFill.style.width = `${base + weight * fraction}%`;
        progressLabel.textContent = `Loading comments… ${detail.loaded}/${detail.target}`;
        return;
    }

    progressLabel.textContent = PHASE_LABELS[phaseKey] || "Working…";

    if (phaseKey === "predicting") {
        // No readable sub-progress for a single in-flight fetch — slide
        // instead of freezing at a static percentage that isn't real.
        progressFill.classList.add("is-indeterminate");
    } else {
        progressFill.classList.remove("is-indeterminate");
        progressFill.style.width = `${base}%`;
    }
}

function completeProgress() {
    progressFill.classList.remove("is-indeterminate");
    progressFill.style.width = "100%";
}

function resetButton() {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = "Analyze Comments";
}

analyzeBtn.addEventListener("click", async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("youtube.com/watch")) {
            status.innerHTML = "Open a YouTube video first";
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = "Analyzing...";
        status.innerHTML = "Starting analysis...";
        showProgress();

        // A long-lived Port (rather than one-shot sendMessage) is what
        // lets the content script push real-time progress while it's
        // still scrolling/loading comments, instead of only delivering a
        // single response at the very end.
        const port = chrome.tabs.connect(tab.id, { name: "commentsense-analyze" });

        let settled = false;

        port.onMessage.addListener(message => {
            if (message?.type === "progress") {
                setProgress(message.phase, message.detail);
                return;
            }

            if (message?.type === "result") {
                settled = true;
                resetButton();

                if (message.success) {
                    completeProgress();
                    status.innerHTML = message.isPartial
                        ? `✓ ${message.count}/${message.requested} comments analyzed (no more available)`
                        : `✓ ${message.count} comments analyzed`;
                    setTimeout(hideProgress, 600);
                } else {
                    hideProgress();
                    status.innerHTML = message.error || "Analysis failed";
                }

                port.disconnect();
            }
        });

        port.onDisconnect.addListener(() => {
            if (settled) return;

            // Disconnected without ever sending a result — e.g. the content
            // script isn't injected on this page (reload the tab after
            // installing/updating the extension) or the page navigated away.
            resetButton();
            hideProgress();
            status.innerHTML = "Failed";
        });

        port.postMessage({ action: "analyze", count: parseInt(commentCount.value) });
    } catch (error) {
        console.error(error);
        resetButton();
        hideProgress();
        status.innerHTML = "Error";
    }
});