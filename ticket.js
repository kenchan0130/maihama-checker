const API_BASE =
  "https://fanclub-funderful.tokyodisneyresort.jp/web_api/v2/ticket/902/16321";
// 購入ページのベース URL
const EVENT_BASE =
  process.env.EVENT_BASE ??
  "https://fanclub-funderful.tokyodisneyresort.jp/event/16321";

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
// 公演コンテンツ ID（例: DTF=438174 / DTG=440657）
const contentId = process.env.CONTENT_ID;
// 大カテゴリ ID（例: DTF=17416 / DTG=17494）。日付一覧の取得に使う
const largeCategoryId = process.env.LARGE_CATEGORY_ID;
// 日付の絞り込み。中カテゴリの title（例: "7/8"）の部分一致。空なら全日
const dateFilter = process.env.DATE ?? "";
// この枚数以上の残数がある場合のみ通知する（デフォルト 2 枚以上）
const MIN_REMAINING_COUNT = Number(process.env.MIN_REMAINING_COUNT ?? 2);

const LOOP_LIMIT_MS = 28 * 60 * 1000; // 28 min (GitHub Actions 全体は 30 min timeout)
const WAIT_MS = 10 * 1000; // 10 秒ごとにチェック

if (!slackWebhookUrl) {
  throw new Error("Please set SLACK_WEBHOOK_URL environment variable");
}
if (!contentId) {
  throw new Error("Please set CONTENT_ID environment variable");
}
if (!largeCategoryId) {
  throw new Error("Please set LARGE_CATEGORY_ID environment variable");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listHeaders() {
  return {
    accept: "application/json",
    "app-type": "Event",
    language: "jpn",
    referer: `${EVENT_BASE}/module/ticket/${contentId}?ticketLargeCategoryId=${largeCategoryId}`,
  };
}

async function apiGet(url) {
  const response = await fetch(url, { headers: listHeaders() });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// 大カテゴリから日付（中カテゴリ）一覧を取得し、DATE で絞り込む
async function fetchTargetDates() {
  const url = `${API_BASE}/${contentId}?type=List&ticket_category_id=${largeCategoryId}&ticket_category_type=Large`;
  const json = await apiGet(url);
  const middles = json?.data?.ticket_middle_categories ?? [];
  return middles
    .filter((c) => !dateFilter || (c.title ?? "").includes(dateFilter))
    .map((c) => ({ id: c.ticket_middle_category_id, title: c.title }));
}

// 指定した日付（中カテゴリ）の公演のうち、しきい値以上の残数があるものを返す
async function fetchAvailableForDate(middle) {
  const url = `${API_BASE}/${contentId}?type=List&ticket_category_id=${middle.id}&ticket_category_type=Middle`;
  const json = await apiGet(url);
  const tickets = json?.data?.tickets ?? [];
  return tickets
    .filter((t) => (t.remaining_count ?? 0) >= MIN_REMAINING_COUNT)
    .map((t) => ({
      key: t.ticket_content?.ticket_id ?? t.ticket_content?.id,
      title: t.ticket_content?.title ?? middle.title,
      remainingCount: t.remaining_count,
    }));
}

async function collectAvailable() {
  const dates = await fetchTargetDates();
  const results = [];
  for (const middle of dates) {
    const available = await fetchAvailableForDate(middle);
    results.push(...available);
  }
  return results;
}

async function sendSlackNotification(available) {
  const url = `${EVENT_BASE}/module/ticket/${contentId}?ticketLargeCategoryId=${largeCategoryId}`;
  const lines = available
    .map((t) => `• ${t.title}（残り ${t.remainingCount}）`)
    .join("\n");

  const message = {
    text: `チケットに空きが見つかりました！\n\n${lines}\n\n<${url}|チケットページを開く>`,
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
    `Checking contentId=${contentId} large=${largeCategoryId}${
      dateFilter ? ` date=${dateFilter}` : " (all dates)"
    } threshold>=${MIN_REMAINING_COUNT}`
  );

  while (Date.now() - startTime < LOOP_LIMIT_MS) {
    loopCount++;
    const currentTime = new Date().toLocaleString("ja-JP");
    console.log(`\n--- Loop ${loopCount} at ${currentTime} ---`);

    try {
      const available = await collectAvailable();

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
