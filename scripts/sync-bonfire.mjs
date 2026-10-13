#!/usr/bin/env node
/** Public Bonfire listing capture. No login and no private contact data. */
import {chromium} from "playwright";
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";

const PORTAL="https://bahamas.bonfirehub.com/portal/?tab=openOpportunities";
const DEST=process.argv[2]||"data/sources/bonfire-latest.json";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1350,height:920}});
const seen=new Map();
let pages=0;
try{
  await page.goto(PORTAL,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>{
    const table=document.querySelector("#DataTables_Table_0");
    return !!table && table.querySelectorAll('tbody a[href*="/opportunities/"]').length>0;
  },null,{timeout:60000});
  while(pages<12){
    pages++;
    const rows=await page.evaluate(()=>{
      const table=document.querySelector("#DataTables_Table_0");
      if(!table)return [];
      return [...table.querySelectorAll("tbody tr")].map(row=>{
        const td=[...row.querySelectorAll("td")];
        const values=td.map(x=>(x.innerText||"").replace(/\s+/g," ").trim());
        const link=row.querySelector('a[href*="/opportunities/"]');
        if(values.length<7||!link)return null;
        return {status:values[0],reference:values[1],title:values[2],
          agency:values[3],deadline:values[4],url:link.href};
      }).filter(Boolean);
    });
    for(const row of rows){
      if(!/^open$/i.test(row.status.trim()))continue;
      const url=new URL(row.url);
      if(url.protocol!=="https:"||url.hostname!=="bahamas.bonfirehub.com"||
         !/^\/opportunities\/\d+$/.test(url.pathname)||url.search)throw Error("Untrusted opportunity URL");
      if(!row.title||!row.agency||!row.deadline||!row.reference)throw Error("Malformed official listing row");
      seen.set(url.pathname,{url:url.href,title:row.title,agency:row.agency,
        reference:row.reference,deadline:row.deadline});
    }
    const next=page.locator("#DataTables_Table_0_next, .dataTables_paginate .next").first();
    if(!(await next.count()))break;
    const disabled=await next.evaluate(el=>el.classList.contains("disabled")||el.getAttribute("aria-disabled")==="true");
    if(disabled)break;
    const oldUrl=(await page.locator("#DataTables_Table_0 tbody a[href*='/opportunities/']").first().getAttribute("href"))||"";
    await next.click({timeout:10000});
    try{
      await page.waitForFunction(previous=>{
        const el=document.querySelector("#DataTables_Table_0 tbody a[href*='/opportunities/']");
        return el && el.getAttribute("href")!==previous;
      },oldUrl,{timeout:15000});
    }catch{throw Error("Bonfire pagination did not advance; source capture aborted")}
  }
  if(pages>=12)throw Error("Reached bounded 12-page listing scan; refusing partial publish");
  if(seen.size<1)throw Error("No confirmed open Bonfire opportunities visible. Keeping old snapshot.");
  const capturedAt=new Date().toISOString();
  const output={
    source_url:PORTAL,
    captured_at:capturedAt,
    capture_method:"github_actions_public_playwright_browser",
    coverage:"All accessible open-listing table pages traversed ("+pages+" pages). No claim of continuous availability.",
    opportunities:[...seen.values()]
  };
  mkdirSync(dirname(DEST),{recursive:true});
  writeFileSync(DEST,JSON.stringify(output,null,2)+"\n");
  console.log("Public Bonfire pages:",pages);
  console.log("Official open listings captured:",seen.size);
  console.log("Capture time (UTC):",capturedAt);
}finally{
  await browser.close();
}
