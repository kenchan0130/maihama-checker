const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const targetUrl = process.env.TARGET_URL;
const referer = process.env.REFERER;
// この枚数以上の残数がある場合のみ通知する（デフォルト 2 枚以上）
const MIN_REMAINING_COUNT = Number(process.env.MIN_REMAINING_COUNT ?? 2);

const LOOP_LIMIT_MS = 28 * 60 * 1000; // 28 min (GitHub Actions 全体は 30 min timeout)
const WAIT_MS = 10 * 1000; // 10 秒ごとにチェック

if (!slackWebhookUrl) {
  throw new Error("Please set SLACK_WEBHOOK_URL environment variable");
}
if (!targetUrl) {
  throw new Error("Please set TARGET_URL environment variable");
}
if (!referer) {
  throw new Error("Please set REFERER environment variable");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAvailableTickets() {
  const response = await fetch(targetUrl, {
    headers: {
      accept: "application/json",
      language: "jpn",
      referer,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const json = await response.json();
  const tickets = json?.data?.tickets ?? [];

  return tickets
    .filter((t) => (t.remaining_count ?? 0) >= MIN_REMAINING_COUNT)
    .map((t) => ({
      id: t.ticket_content?.id ?? t.ticket_content?.content_id,
      title: t.ticket_content?.title ?? "(no title)",
      remainingCount: t.remaining_count,
    }));
}

async function sendSlackNotification(available) {
  const lines = available
    .map((t) => `• ${t.title}（残り ${t.remainingCount}）`)
    .join("\n");

  const message = {
    text: `チケットに空きが見つかりました！\n\n${lines}\n\n${referer}`,
  };

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack HTTP error! status: ${response.status}`);
  }

  console.log(`Slack notification sent for ${available.length} tickets`);
}

async function runLoop() {
  const startTime = Date.now();
  let loopCount = 0;
  // 同じチケットで通知を連発しないよう、通知済み ID を記録する
  const notified = new Set();

  console.log(`Checking tickets: ${targetUrl}`);
  console.log(`Notify when remaining_count >= ${MIN_REMAINING_COUNT}`);

  while (Date.now() - startTime < LOOP_LIMIT_MS) {
    loopCount++;
    const currentTime = new Date().toLocaleString("ja-JP");
    console.log(`\n--- Loop ${loopCount} at ${currentTime} ---`);

    try {
      const available = await getAvailableTickets();

      if (available.length === 0) {
        console.log("No available tickets");
        // 在庫が無くなったチケットは再度空いたときに通知するためリセット
        notified.clear();
      } else {
        const fresh = available.filter((t) => !notified.has(t.id));
        if (fresh.length > 0) {
          await sendSlackNotification(fresh);
          fresh.forEach((t) => notified.add(t.id));
        } else {
          console.log("Available tickets already notified, skipping");
        }
      }
    } catch (error) {
      console.error(`Error in loop ${loopCount}:`, error.message);
    }

    if (Date.now() - startTime + WAIT_MS >= LOOP_LIMIT_MS) {
      break;
    }
    console.log(`⏳ Sleeping for ${WAIT_MS / 1000} seconds...`);
    await sleep(WAIT_MS);
  }

  console.log(`Loop completed after ${loopCount} iterations`);
}

(async () => {
  await runLoop();
})();
