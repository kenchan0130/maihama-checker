import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { performance } from 'perf_hooks';

const sleep = ms => new Promise(res => setTimeout(res, ms))
const loopWaitMs = 5000; // 5 sec
const loopLimitMs = 1000 * 60 * 30; // 30 min

const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
const url = process.env.TARGET_URL;
const rejectList = (process.env.REJECT_LIST ?? "").split(",").filter((v) => v.length !== 0);

if (!slackWebhookUrl) {
  throw "Please set SLACK_WEBHOOK_URL";
}
if (!url) {
  throw "Please set TARGET_URL";
}

puppeteer.use(StealthPlugin());

(async () => {
  let counter = 0;
  const start = performance.now();

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox'],
  });
  const [page] = await browser.pages();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');

  while (true) {
    const lap = performance.now();
    const loopTime = lap - start
    if (loopTime > loopLimitMs) {
      console.log(`${loopLimitMs} ms elapsed, timeout.`)
      break
    }

    if (counter > 0) {
      console.log(`reserve page waiting ${loopWaitMs} ms, loop ${loopTime} ms...`);
      await sleep(loopWaitMs);
    }
    counter++

    console.log({
      loading: url,
      times: counter,
    });
    try {
      await page.goto(url, {
        timeout: 30000, // 30s
        waitUntil: 'load',
      });
    } catch(e) {
      console.log(`'${e.message}' error occurred, process continue...`)
      continue
    }

    // wait to process queue page
    while (page.url() !== url) {
      const lap = performance.now();
      if ((lap - start) > loopLimitMs) {
        break
      }

      try {
        await page.waitForSelector('#MainPart_lbWhichIsIn');
      } catch(e) {
        continue
      }
      const source = await page.content();
      const dom = new JSDOM(source);
      console.log({
        currentUrl: page.url(),
        waitTime: dom.window.document.querySelector("#MainPart_lbWhichIsIn").textContent,
        accessTime: dom.window.document.querySelector("#MainPart_lbExpectedServiceTime").textContent,
        updateTime: dom.window.document.querySelector("#MainPart_lbLastUpdateTimeText").textContent,
      });
      console.log(`queue page waiting ${loopWaitMs} ms...`);
      await sleep(loopWaitMs);
    }

    if (page.url() !== url) {
      continue
    }

    const cookies = await page.cookies();
    const reserveSiteCookies = cookies.filter(v => v.name.match(/^JSESSIONID$/) || v.name.match(/^QueueITAccepted/));
    const editThisCookieFormatCookies = reserveSiteCookies.map((v) => {
      return {
        domain: v.domain,
        hostOnly: true,
        httpOnly: v.httpOnly,
        name: v.name,
        path: v.path,
        sameSite: v.sameSite === 'None' ? 'no_restriction' :  v.sameSite ?? 'unspecified',
        secure: v.secure,
        session: v.session,
        storeId: "0",
        value: v.value,
      };
    });
    console.log('======= Cookie JSON value Start =======')
    console.log(JSON.stringify(editThisCookieFormatCookies, null, 2));
    console.log('======= Cookie JSON value End =======')

    const source = await page.content();
    const dom = new JSDOM(source);
    const hasGotReservationDom = dom.window.document.querySelectorAll(".hasGotReservation");
    if (hasGotReservationDom.length === 0) {
      console.log(`No found seats via ${counter} times`);
      continue
    }

    const results = Array.from(hasGotReservationDom)
      .map((v) => {
        const [_, nameCd, contentsCd] = v.querySelector("button").getAttribute("onclick").replaceAll("'", "").match(/\((.+)\)/)[1].split(",");
        const checkUrl = new URL(url);
        checkUrl.searchParams.append('nameCd', nameCd);
        checkUrl.searchParams.append('contentsCd', contentsCd);
        checkUrl.pathname = checkUrl.pathname.replace('list', 'check');

        return {
          name: v.querySelector(".name").textContent.trim(),
          url: checkUrl.toString(),
        };
      })
      .filter((v) => !rejectList.includes(v.name));
    if (results.length === 0) {
      console.log(`No found seats via ${counter} times`);
      continue
    }

    console.log({ results });

    // post session info
    await Promise.all([
      axios.post(
        slackWebhookUrl,
        JSON.stringify({
          "text":`Cookie JSON
\`\`\`
${JSON.stringify(editThisCookieFormatCookies, null, 2)}
\`\`\``,
        }),
      ),
      axios.post(
        slackWebhookUrl,
        JSON.stringify({
          "text": `<${url}|空席が見つかりました>\n${results.map((v) => `- <${v.url}|${v.name}>`).join("\n")}`,
        }),
      ),
    ]);
  }

  await browser.close();
})();
