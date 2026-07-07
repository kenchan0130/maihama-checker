const API_URL =
  "https://zw5imfeelcfhupz6ctfpzgnqem0hxvdj.lambda-url.ap-northeast-1.on.aws/";
// 購入ページのベース URL（{base}/module/ticket/{sourceContentId} でリンク生成）
const EVENT_BASE =
  process.env.EVENT_BASE ??
  "https://fanclub-funderful.tokyodisneyresort.jp/event/16321";

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const month = process.env.MONTH;
// DAY は任意。未指定ならその月の全日をチェックする
const day = process.env.DAY;
// SHOW は公演コード(DTG/DTF/MMW など) か公演名の一部。カンマ区切りで複数可
const showFilter = (process.env.SHOW ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v.length !== 0);

const LOOP_LIMIT_MS = 28 * 60 * 1000; // 28 min (GitHub Actions 全体は 30 min timeout)
const WAIT_MS = 10 * 1000; // 10 秒ごとにチェック

if (!slackWebhookUrl) {
  throw new Error("Please set SLACK_WEBHOOK_URL environment variable");
}
if (!month) {
  throw new Error("Please set MONTH environment variable");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function matchesShowFilter(showCode, fullShowName) {
  if (showFilter.length === 0) return true;
  return showFilter.some(
    (f) =>
      showCode === f ||
      showCode.toLowerCase() === f.toLowerCase() ||
      fullShowName.includes(f)
  );
}

async function fetchMasterData() {
  const response = await fetch(`${API_URL}?month=${month}`, {
    headers: {
      Referer: "https://main.d17i4dgeb1exbe.amplifyapp.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// 対象公演の available な performance を全て返す
function collectAvailable(masterData) {
  const results = [];
  // DAY 指定があればその日だけ、無ければ全日
  const days = day ? [day.toString()] : Object.keys(masterData ?? {});

  for (const dayStr of days) {
    const dayData = masterData?.[dayStr];
    if (!dayData) continue;

    for (const showCode of Object.keys(dayData)) {
      const show = dayData[showCode];
      const fullShowName = show.fullShowName ?? showCode;
      if (!matchesShowFilter(showCode, fullShowName)) continue;

      for (const perf of show.performances ?? []) {
        if (perf.status !== "available") continue;
        results.push({
          key: `${dayStr}-${showCode}-${perf.round}`,
          day: dayStr,
          showCode,
          fullShowName,
          round: perf.round,
          sourceContentId: perf.sourceContentId,
        });
      }
    }
  }

  return results;
}

async function sendSlackNotification(available) {
  const lines = available
    .map((a) => {
      const label = `${month}/${a.day} ${a.fullShowName} 第${a.round}回公演`;
      const url = a.sourceContentId
        ? `${EVENT_BASE}/module/ticket/${a.sourceContentId}`
        : EVENT_BASE;
      return `• <${url}|${label}>`;
    })
    .join("\n");

  const message = {
    text: `チケットに空きが見つかりました！\n\n${lines}`,
  };

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack HTTP error! status: ${response.status}`);
  }

  console.log(`Slack notification sent for ${available.length} performances`);
}

async function runLoop() {
  const startTime = Date.now();
  let loopCount = 0;
  // 同じ公演で通知を連発しないよう、通知済み key を記録する
  const notified = new Set();

  console.log(
    `Checking month=${month}${day ? ` day=${day}` : " (all days)"}${
      showFilter.length ? ` show=${showFilter.join(",")}` : " (all shows)"
    }`
  );

  while (Date.now() - startTime < LOOP_LIMIT_MS) {
    loopCount++;
    const currentTime = new Date().toLocaleString("ja-JP");
    console.log(`\n--- Loop ${loopCount} at ${currentTime} ---`);

    try {
      const data = await fetchMasterData();
      const available = collectAvailable(data.masterData);

      if (available.length === 0) {
        console.log("No available performances");
        // 一旦売り切れたら、再度空いたときに通知するためリセット
        notified.clear();
      } else {
        const fresh = available.filter((a) => !notified.has(a.key));
        if (fresh.length > 0) {
          await sendSlackNotification(fresh);
          fresh.forEach((a) => notified.add(a.key));
        } else {
          console.log("Available performances already notified, skipping");
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
