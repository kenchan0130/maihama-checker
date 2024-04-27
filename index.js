import puppeteer from 'puppeteer';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { performance } from 'perf_hooks';

const sleep = ms => new Promise(res => setTimeout(res, ms))
const loopWaitMs = 5000; // 5秒
const loopLimitMs = 1000 * 60 * 30; // 30分

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const url = `https://reserve.tokyodisneyresort.jp/sp/restaurant/list/?useDate=20240522&mealDivInform=&adultNum=4&childNum=2&childAgeInform=02%7C02%7C&restaurantTypeInform=4&restaurantNameCd=&wheelchairCount=0&stretcherCount=0&showWay=&reservationStatus=1&beforeUrl=https%3A%2F%2Freserve.tokyodisneyresort.jp%2Fsp%2Frestaurant%2Flist%2F%3FuseDate%3D20240522%26mealDivInform%3D%26adultNum%3D4%26childNum%3D2%26childAgeInform%3D02%257C02%257C%26restaurantTypeInform%3D%26restaurantNameCd%3D%26wheelchairCount%3D0%26stretcherCount%3D0%26showWay%3D%26reservationStatus%3D1%26wayBack%3D&wayBack=`;

if (!slackWebhookUrl) {
  throw "Please set SLACK_WEBHOOK_URL"
}


(async () => {
  let counter = 0;
  const start = performance.now();

  console.log(`Loading ${url} ...`);
  while (true) {
    const lap = performance.now();
    if ((lap - start) > loopLimitMs) {
      break
    }

    if (counter > 0) {
      await sleep(loopWaitMs);
    }
    counter++

    const browser = await puppeteer.launch({
      headless: "new",
    });
    const [page] = await browser.pages();
    await page.setCacheEnabled(false);
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');

    console.log(`${counter} times....`);
    await page.goto(url, {
      timeout: 0,
      waitUntil: 'load',
    });

    // wait to process queue page
    while (page.url() !== url) {
      console.log(`Current URL is ${page.url()}`)
      await sleep(5000);
    }

    const source = await page.content({
      waitUntil: 'domcontentloaded',
    });
    const dom = new JSDOM(source);
    const hasGotReservationDom = dom.window.document.querySelectorAll(".hasGotReservation");
    if (hasGotReservationDom.length == 0) {
      console.log("No found seats");
      await browser.close();
      continue
    }

    const results = Array.from(hasGotReservationDom).map((v) => v.querySelector(".name").textContent);

    console.log("Found seats!!")
    await axios.post(
      slackWebhookUrl,
      JSON.stringify({
        "text": `<${url}|空席が見つかりました>\n${results.map((v) => `- ${v}`).join("\n")}`
      }),
    )

    await browser.close();
  }

})();
