const analyzeBtn =
document.getElementById(
    "analyzeBtn"
);

const status =
document.getElementById(
    "status"
);

const commentCount =
document.getElementById(
    "commentCount"
);

analyzeBtn.addEventListener(

    "click",

    async () => {

        try {

            const [tab] =

            await chrome.tabs.query({

                active: true,

                currentWindow: true
            });

            if (

                !tab.url.includes(
                    "youtube.com/watch"
                )

            ) {

                status.innerHTML =
                "Open a YouTube video first";

                return;
            }

            analyzeBtn.disabled =
            true;

            analyzeBtn.innerHTML =
            "Analyzing...";

            status.innerHTML =
            "Starting analysis...";

            chrome.tabs.sendMessage(

                tab.id,

                {

                    action:
                    "analyze",

                    count:
                    parseInt(
                        commentCount.value
                    )
                },

                response => {

                    analyzeBtn.disabled =
                    false;

                    analyzeBtn.innerHTML =
                    "Analyze Comments";

                    if (
                        chrome.runtime.lastError
                    ) {

                        status.innerHTML =
                        "Failed";

                        return;
                    }

                    if (
                        response &&
                        response.success
                    ) {

                        status.innerHTML =

                        `✓ ${response.count} comments analyzed`;
                    }

                    else {

                        status.innerHTML =
                        "Analysis failed";
                    }
                }
            );
        }

        catch (error) {

            console.error(
                error
            );

            analyzeBtn.disabled =
            false;

            analyzeBtn.innerHTML =
            "Analyze Comments";

            status.innerHTML =
            "Error";
        }
    }
);