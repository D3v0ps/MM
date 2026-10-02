import { openProto, visit } from './lib.mjs';
const { page, close } = await openProto();
await visit(page, 'samordnare', 'sam.inkorg', {});
console.log(await page.evaluate(() => ({
  sidebar: document.querySelector('.nav-item.active .count')?.innerText,
  kpi: [...document.querySelectorAll('.ink-sum')].map((x) => x.innerText.replace(/\n/g, ' ')),
  tab: document.querySelector('[role=tab][aria-selected=true]')?.innerText.replace(/\n/g, ' '),
  awaiting: MM.sel.awaitingAnswer().map((c) => c.number), inbox: MM.sel.inbox().map((e) => e.id + ':' + e.status),
})));
await visit(page, 'samordnare', 'sam.start', {});
console.log(await page.evaluate(() => [...document.querySelectorAll('.kpi, .ink-tile')].slice(0, 4).map((x) => x.innerText.replace(/\n/g, ' '))));
await close();
