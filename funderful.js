const API_URL =
  "https://zw5imfeelcfhupz6ctfpzgnqem0hxvdj.lambda-url.ap-northeast-1.on.aws/";
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const month = process.env.MONTH;
const day = process.env.DAY;
const rejectList = (process.env.REJECT_LIST ?? "")
  .split(",")
  .filter((v) => v.length !== 0);

const LOOP_DURATION_MS = 45 * 60 * 1000; // 45 min
const MIN_WAIT_MS = 10 * 1000; // 最小10秒待機
const MAX_WAIT_MS = 15 * 60 * 1000; // 最大15分待機

if (!slackWebhookUrl) {
  throw new Error("Please set SLACK_WEBHOOK_URL environment variable");
}
if (!month) {
  throw new Error("Please set MONTH environment variable");
}
if (!day) {
  throw new Error("Please set DAY environment variable");
}

async function getAvailableShows(month, day) {
  try {
    const response = await fetch(`${API_URL}?month=${month}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const dayStr = day.toString();
    if (!data.masterData[dayStr]) {
      console.log(`No data found for day ${day} in month ${month}`);
      return { availableShows: [], cacheInfo: data.cacheInfo };
    }

    const availableShows = [];
    const dayData = data.masterData[dayStr];

    for (const showCode in dayData) {
      const show = dayData[showCode];
      const fullShowName = show.fullShowName;

      if (rejectList.includes(fullShowName)) {
        console.log(`Skipping ${fullShowName} (in reject list)`);
        continue;
      }

      const availablePerformances = show.performances.filter(
        (perf) => perf.status === "available"
      );

      if (availablePerformances.length > 0) {
        availableShows.push({
          showCode,
          fullShowName,
          availableCount: availablePerformances.length,
          performances: availablePerformances,
        });
      }
    }

    return { availableShows, cacheInfo: data.cacheInfo };
  } catch (error) {
    console.error("Error fetching show data:", error.message);
    throw error;
  }
}

async function sendSlackNotification(availableShows, month, day) {
  if (availableShows.length === 0) {
    console.log(`No available shows found for ${month}/${day}`);
    return;
  }

  const showNames = availableShows
    .map((show) => `• ${show.fullShowName}`)
    .join("\n");

  const message = {
    text: `${month}月${day}日に空席が見つかりました！\n\n${showNames}\n\nhttps://fanclub-funderful.tokyodisneyresort.jp/event/13806`,
  };

  try {
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log(
      `Slack notification sent for ${availableShows.length} shows on ${month}/${day}`
    );
  } catch (error) {
    console.error("Error sending Slack notification:", error.message);
    throw error;
  }
}

async function checkAndNotify(month, day) {
  try {
    console.log(`Checking for available shows on ${month}/${day}...`);

    const result = await getAvailableShows(month, day);
    const availableShows = result.availableShows;
    const cacheInfo = result.cacheInfo;

    if (availableShows.length > 0) {
      await sendSlackNotification(availableShows, month, day);
    } else {
      console.log(`No available shows found for ${month}/${day}`);
    }

    return { availableShows, cacheInfo };
  } catch (error) {
    console.error(
      `Error in checkAndNotify for ${month}/${day}:`,
      error.message
    );
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateWaitTime(nextUpdateUTC) {
  try {
    const nextUpdate = new Date(nextUpdateUTC);
    const now = new Date();
    const waitTimeMs = nextUpdate.getTime() - now.getTime();

    console.log(`Time calculation debug:`);
    console.log(`  Current time (UTC): ${now.toISOString()}`);
    console.log(`  Next update (UTC): ${nextUpdate.toISOString()}`);
    console.log(
      `  Calculated wait time: ${waitTimeMs}ms (${Math.ceil(
        waitTimeMs / 1000
      )}s)`
    );

    // 過去の時刻の場合や異常な値の場合は最小待機時間を使用
    if (waitTimeMs <= 0) {
      console.log(
        `nextUpdate is in the past or invalid, using minimum wait time`
      );
      return MIN_WAIT_MS;
    }

    // 最大待機時間を超える場合は制限
    if (waitTimeMs > MAX_WAIT_MS) {
      console.log(
        `nextUpdate is too far in the future (${Math.ceil(
          waitTimeMs / 1000 / 60
        )} minutes), limiting to max wait time (${
          MAX_WAIT_MS / 1000 / 60
        } minutes)`
      );
      return MAX_WAIT_MS;
    }

    return Math.max(waitTimeMs, MIN_WAIT_MS);
  } catch (error) {
    console.error(`Error parsing nextUpdate: ${nextUpdateUTC}`, error.message);
    return MIN_WAIT_MS;
  }
}

async function runLoop() {
  const startTime = Date.now();
  let loopCount = 0;

  console.log(
    `Starting loop for ${
      LOOP_DURATION_MS / 1000 / 60
    } minutes, waiting based on cacheInfo.nextUpdate`
  );
  console.log(`Checking shows for ${month}/${day}`);

  if (rejectList.length > 0) {
    console.log(`Reject list: ${rejectList.join(", ")}`);
  } else {
    console.log("No shows in reject list");
  }

  while (Date.now() - startTime < LOOP_DURATION_MS) {
    loopCount++;
    const currentTime = new Date().toLocaleString("ja-JP");

    try {
      console.log(`\n--- Loop ${loopCount} at ${currentTime} ---`);
      const result = await checkAndNotify(month, day);

      let waitTimeMs = MIN_WAIT_MS;
      if (result.cacheInfo && result.cacheInfo.nextUpdate) {
        waitTimeMs = calculateWaitTime(result.cacheInfo.nextUpdate);

        console.log(`Cache info:`, {
          lastUpdated: result.cacheInfo.lastUpdated,
          nextUpdate: result.cacheInfo.nextUpdate,
          source: result.cacheInfo.source,
          isStale: result.cacheInfo.isStale,
        });

        const nextUpdateLocal = new Date(
          result.cacheInfo.nextUpdate
        ).toLocaleString("ja-JP");
        console.log(
          `Next update scheduled at: ${nextUpdateLocal} (waiting ${Math.ceil(
            waitTimeMs / 1000
          )} seconds)`
        );
      } else {
        console.log(
          `No nextUpdate info found, using minimum wait time: ${
            waitTimeMs / 1000
          } seconds`
        );
      }

      const elapsedTime = Date.now() - startTime;
      const remainingTime = LOOP_DURATION_MS - elapsedTime;

      if (remainingTime > waitTimeMs) {
        console.log(
          `⏳ Sleeping for ${Math.ceil(
            waitTimeMs / 1000
          )} seconds until next update... (${Math.ceil(
            remainingTime / 1000 / 60
          )} minutes remaining in total loop)`
        );
        await sleep(waitTimeMs);
      } else if (remainingTime > 0) {
        console.log(
          `⏳ Final wait: ${Math.ceil(remainingTime / 1000)} seconds remaining`
        );
        await sleep(remainingTime);
        break;
      } else {
        console.log(`⏰ Loop time expired, ending loop`);
        break;
      }
    } catch (error) {
      console.error(`Error in loop ${loopCount}:`, error.message);
      console.log(
        `Waiting minimum time before retry: ${MIN_WAIT_MS / 1000} seconds`
      );
      await sleep(MIN_WAIT_MS);
    }
  }

  console.log(
    `Loop completed after ${loopCount} iterations over ${
      LOOP_DURATION_MS / 1000 / 60
    } minutes`
  );
}

(async () => {
  await runLoop();
})();
