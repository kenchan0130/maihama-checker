import puppeteer from 'puppeteer';
import axios from 'axios';
import { JSDOM } from "jsdom";

const sleep = ms => new Promise(res => setTimeout(res, ms))
const loopWaitMs = 5000; // 5秒
const loopLimitMs = 1000 * 60 * 10; // 10分

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const url = `https://reserve.tokyodisneyresort.jp/sp/restaurant/list/?useDate=20231010&mealDivInform=&adultNum=4&childNum=2&childAgeInform=01%7C02%7C&restaurantTypeInform=4&restaurantNameCd=&wheelchairCount=0&stretcherCount=0&showWay=&reservationStatus=1&beforeUrl=https%3A%2F%2Freserve.tokyodisneyresort.jp%2Fsp%2Frestaurant%2Flist%2F%3FuseDate%3D20231030%26mealDivInform%3D%26adultNum%3D4%26childNum%3D2%26childAgeInform%3D01%257C02%257C%26restaurantTypeInform%3D4%257C1%26restaurantNameCd%3D%26wheelchairCount%3D0%26stretcherCount%3D0%26showWay%3D%26reservationStatus%3D1%26wayBack%3D&wayBack=`;

if (!slackWebhookUrl) {
  throw "Please set SLACK_WEBHOOK_URL"
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
  });
  const [page] = await browser.pages();
  await page.setCacheEnabled(false);
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');

  let counter = 1;
  let counterMs = 0;
  while (true) {
    if (counterMs > loopLimitMs) {
      break
    }

    console.log(`Loading ${url}... ${counter} times`);
    await page.goto(url, {
      timeout: 0,
      waitUntil: 'load',
    });

    const source = await page.content({
      waitUntil: 'domcontentloaded',
    });
    const dom = new JSDOM(source);
    const hasGotReservationDom = dom.window.document.querySelectorAll(".hasGotReservation");
    if (hasGotReservationDom.length == 0) {
      console.log("No found seats");
      await sleep(loopWaitMs);
      counterMs += loopWaitMs
      continue
    }

    const results = Array.from(hasGotReservationDom).map((v) => v.querySelector(".name").textContent);

    await axios.post(
      slackWebhookUrl,
      JSON.stringify({
        "text": `*空席が見つかりました*\n${results.map((v) => `- ${v}`).join("\n")}`
      }),
    )

    await sleep(loopWaitMs);
    counterMs += loopWaitMs
  }

  await browser.close();
})();
