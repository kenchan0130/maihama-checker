const API_URL =
  "https://zw5imfeelcfhupz6ctfpzgnqem0hxvdj.lambda-url.ap-northeast-1.on.aws/";
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const month = process.env.MONTH;
const day = process.env.DAY;

const LOOP_INTERVAL_MS = 30 * 1000; // 30 sec
const LOOP_DURATION_MS = 30 * 60 * 1000; // 30 min

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
      return [];
    }

    const availableShows = [];
    const dayData = data.masterData[dayStr];

    for (const showCode in dayData) {
      const show = dayData[showCode];
      const fullShowName = show.fullShowName;

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

    return availableShows;
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

    const availableShows = await getAvailableShows(month, day);

    if (availableShows.length > 0) {
      await sendSlackNotification(availableShows, month, day);
    } else {
      console.log(`No available shows found for ${month}/${day}`);
    }

    return availableShows;
  } catch (error) {
    console.error(
      `Error in checkAndNotify for ${month}/${day}:`,
      error.message
    );
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLoop() {
  const startTime = Date.now();
  let loopCount = 0;

  console.log(
    `Starting loop for ${
      LOOP_DURATION_MS / 1000 / 60
    } minutes, checking every ${LOOP_INTERVAL_MS / 1000} seconds`
  );
  console.log(`Checking shows for ${month}/${day}`);

  while (Date.now() - startTime < LOOP_DURATION_MS) {
    loopCount++;
    const currentTime = new Date().toLocaleString("ja-JP");

    try {
      console.log(`\n--- Loop ${loopCount} at ${currentTime} ---`);
      await checkAndNotify(month, day);
    } catch (error) {
      console.error(`Error in loop ${loopCount}:`, error.message);
    }

    const elapsedTime = Date.now() - startTime;
    const remainingTime = LOOP_DURATION_MS - elapsedTime;

    if (remainingTime > LOOP_INTERVAL_MS) {
      console.log(
        `Waiting ${LOOP_INTERVAL_MS / 1000} seconds... (${Math.ceil(
          remainingTime / 1000 / 60
        )} minutes remaining)`
      );
      await sleep(LOOP_INTERVAL_MS);
    } else if (remainingTime > 0) {
      console.log(
        `Final wait: ${Math.ceil(remainingTime / 1000)} seconds remaining`
      );
      await sleep(remainingTime);
      break;
    } else {
      break;
    }
  }
}

(async () => {
  await runLoop();
})();
