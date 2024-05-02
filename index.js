import puppeteer from 'puppeteer';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { performance } from 'perf_hooks';

const sleep = ms => new Promise(res => setTimeout(res, ms))
const loopWaitMs = 5000; // 5秒
const loopLimitMs = 1000 * 60 * 30; // 30分

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const url = process.env.TARGET_URL;

if (!slackWebhookUrl) {
  throw "Please set SLACK_WEBHOOK_URL";
}
if (!url) {
  throw "Please set TARGET_URL";
}


(async () => {
  let counter = 0;
  const start = performance.now();

  console.log(`Loading ${url} ...`);
  while (true) {
    const lap = performance.now();
    if ((lap - start) > loopLimitMs) {
      console.log(`${loopLimitMs} ms elapsed, timeout.`)
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
      const lap = performance.now();
      if ((lap - start) > loopLimitMs) {
        console.log(`${loopLimitMs} ms elapsed, timeout.`)
        break
      }
      console.log(`Current URL is ${page.url()}, waiting 5000 ms`);
      await sleep(5000);
    }

    const source = await page.content({
      waitUntil: 'domcontentloaded',
    });
    const dom = new JSDOM(source);
    const hasGotReservationDom = dom.window.document.querySelectorAll(".hasGotReservation");
    if (hasGotReservationDom.length === 0) {
      console.log("No found seats");
      await browser.close();
      continue
    }

    const results = Array.from(hasGotReservationDom).map((v) => v.querySelector(".name").textContent);

    console.log("Found seats!!");
    await axios.post(
      slackWebhookUrl,
      JSON.stringify({
        "text": `<${url}|空席が見つかりました>\n${results.map((v) => `- ${v}`).join("\n")}`,
      }),
    )

    await browser.close();
  }

})();
