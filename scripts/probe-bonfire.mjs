import { chromium } from "playwright";
/** Investigate public Bonfire markup on GitHub runner without login or personal data. */
const pageUrl="https://bahamas.bonfirehub.com/portal/?tab=openOpportunities";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const apiUrls=new Set();
page.on("response",resp=>{
  try{
    const url=new URL(resp.url());
    if(url.hostname==="bahamas.bonfirehub.com"&&/api|opportun|portal/i.test(url.pathname)&&
        !/account|session|token|login/i.test(url.pathname))apiUrls.add(url.origin+url.pathname);
  }catch{}
});
try{
  await page.goto(pageUrl,{waitUntil:"domcontentloaded",timeout:55000});
  await page.waitForTimeout(15000);
  console.log("PROBE_TITLE",await page.title());
  console.log("BODY_SNIPPET",JSON.stringify((await page.locator("body").innerText({timeout:15000})).slice(0,3800)));
  const d=await page.evaluate(()=>{
    const arr=[...document.querySelectorAll("a[href*='/opportunities/']")];
    const tabs=[...document.querySelectorAll("table")].slice(0,4);
    return {
      opportunityLinks:arr.slice(0,8).map(a=>({text:a.textContent.trim().slice(0,100),href:a.href})),
      linkCount:arr.length,
      tables:tabs.map(t=>({className:t.className,rows:t.rows.length,html:t.outerHTML.slice(0,2000)})),
      keywords:[...document.querySelectorAll("[class*='opportunity'],[id*='opportunity']")].slice(0,8).map(x=>({tag:x.tagName,id:x.id,cls:String(x.className).slice(0,150),text:x.textContent.trim().slice(0,220)}))
    };
  });
  console.log("STRUCTURE",JSON.stringify(d).slice(0,10500));
  console.log("PUBLIC_API_PATHS",JSON.stringify([...apiUrls].slice(0,12)));
}finally{await browser.close()}
