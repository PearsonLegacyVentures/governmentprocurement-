#!/usr/bin/env node
/**
 * Opportunity Radar: explainable venture-fit signals for public Bonfire listings.
 * Not a probability of winning, bid eligibility determination, or live status API.
 *
 * Usage: node scripts/radar.mjs data/sources/bonfire-2026-10-13.json data/public/opportunities.json
 */
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";

export const OFFICIAL_HOST="bahamas.bonfirehub.com";
export const OFFICIAL_PORTAL="https://bahamas.bonfirehub.com/portal/?tab=openOpportunities";
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

export function parseDeadline(text){
  const match=/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(EDT|EST)\b/i.exec(text||"");
  if(!match)return null;
  const [,mo,d,y,hh,mm,ap,zone]=match;
  const year=Number(y),month=MONTHS[mo.toLowerCase().slice(0,3)],day=Number(d);
  let hour=Number(hh)%12;if(ap.toUpperCase()==="PM")hour+=12;
  const minute=Number(mm);
  const dayString=[year,String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
  const utc=new Date(Date.UTC(year,month-1,day,hour+(zone.toUpperCase()==="EDT"?4:5),minute));
  if(utc.getUTCFullYear()<2020||month<1||minute>59||
    new Date(Date.UTC(year,month-1,day)).getUTCDate()!==day)return null;
  return {deadline_date_local:dayString,deadline_time_local:String(hour).padStart(2,"0")+":"+String(minute),timezone:zone.toUpperCase(),deadline_utc:utc.toISOString()};
}

const RULES=[
  {venture:"Tranquilitas",patterns:[
    [/massage|spa treatment|therapeutic touch|chair massage|employee wellness|staff wellness|corporate wellness/i,"direct",70,"Massage or workplace wellness service"],
    [/\bwellness\b|\bfitness\b|health promotion|sports recovery/i,"watch",28,"Adjacent wellness programming; check the exact scope"]
  ]},
  {venture:"Bahamas AI Solutions",patterns:[
    [/software development|website|web portal|app development|data dashboard|artificial intelligence|AI solution|automation|digital transformation|information management system|information system/i,"direct",74,"Digital systems or development deliverable"],
    [/ICT equipment|computer equipment|hardware|bulk order|telecom equipment/i,"partner",22,"Hardware procurement; a qualified supply partner would be required"],
    [/evaluation consultant|business process|capacity building|consulting service|feasibility study/i,"watch",24,"Consulting scope must be reviewed before claiming fit"]
  ]},
  {venture:"Bahamas Mineral Company",patterns:[
    [/poultry feed|animal feed|feed supplement|calcium carbonate|shell recycling|conch shell|agricultural lime/i,"direct",75,"Potential match for validated feed-calcium or recovered-shell products"],
    [/packing house|construction aggregate|building material|building supplies|agriculture|waste processing|recycling|compost/i,"watch",21,"Agriculture or material-supply sector; not evidence that BMC's product is required"]
  ]},
  {venture:"Mel J's Event Rentals",patterns:[
    [/tent rental|chair rental|table rental|event rental|event production|event decor|portable stage|event equipment/i,"direct",70,"Event equipment or rentals"],
    [/hotel venue|awards ceremony|conference venue|national sports awards|banquet|festival|event management|catering/i,"partner",41,"Possible subcontracting to a qualified venue or event prime"]
  ]},
  {venture:"EasyTap",patterns:[
    [/payment processing|merchant payment|ticketing system|revenue collection software|cashless payments|point of sale|digital payment/i,"watch",45,"Payments-related procurement; licensing and eligibility require review"]
  ]},
  {venture:"ClearKayakPhotos.com",patterns:[
    [/photography|videography|drone photography|event photography|visual content creation/i,"direct",62,"Potential photographic service scope"]
  ]},
  {venture:"Bahama Breeze Cabanas",patterns:[
    [/cabana rental|beach cabana|beach shade|temporary beach shelter/i,"direct",65,"Potential cabana or beach shelter rental"],
    [/outdoor tent rental|event tent rental/i,"partner",35,"Adjacent tent rental; equipment and location eligibility require review"]
  ]}
];
const RANK={direct:3,partner:2,watch:1};
export function matchVentures(title){
  const text=String(title||"");
  const found=[];
  for(const rule of RULES){
    const evidence=[];
    for(const [pattern,type,points,reason] of rule.patterns){
      const match=pattern.exec(text);
      if(match)evidence.push({type,points,term:match[0],reason});
    }
    if(!evidence.length)continue;
    evidence.sort((a,b)=>RANK[b.type]-RANK[a.type]||b.points-a.points);
    const best=evidence[0];
    found.push({venture:rule.venture,match_type:best.type,strength:best.points>=60?"strong":best.points>=35?"moderate":"weak",score:best.points,trigger:best.term,reason:best.reason,qualification:"Not assessed — verify the official tender documents and statutory eligibility."});
  }
  found.sort((a,b)=>b.score-a.score);
  return found;
}
export function normalizeSnapshot(snapshot){
  if(!snapshot||!Array.isArray(snapshot.opportunities))throw Error("Missing observed opportunities");
  const checkedAt=String(snapshot.captured_at||"");
  if(!/^\d{4}-\d{2}-\d{2}T/.test(checkedAt)||!Number.isFinite(Date.parse(checkedAt)))throw Error("Missing real capture date");
  if(snapshot.source_url!==OFFICIAL_PORTAL)throw Error("Snapshot source is not the Bahamas official Bonfire portal");
  const ids=new Set(),opportunities=[];
  for(const raw of snapshot.opportunities){
    const url=new URL(raw.url);
    const id=/^\/opportunities\/(\d+)$/.exec(url.pathname);
    if(url.hostname!==OFFICIAL_HOST||url.protocol!=="https:"||!id||url.search)throw Error("Non-official opportunity URL: "+raw.url);
    if(ids.has(id[1]))throw Error("Duplicate Bonfire opportunity "+id[1]);
    ids.add(id[1]);
    if(!raw.title||!raw.agency||!raw.deadline||String(raw.title).length>500)throw Error("Incomplete observed tender "+id[1]);
    const date=parseDeadline(raw.deadline);
    if(!date)throw Error("Unrecognized Bonfire deadline: "+raw.deadline);
    opportunities.push({
      id:id[1],title:String(raw.title).trim(),agency:String(raw.agency).trim(),
      reference:String(raw.reference||"").trim(),url:url.href,
      deadline_raw:String(raw.deadline),...date,status_at_capture:"Listed under Open Opportunities",
      matches:matchVentures(raw.title)
    });
  }
  opportunities.sort((a,b)=>a.deadline_utc.localeCompare(b.deadline_utc));
  return {
    metadata:{
      source_url:OFFICIAL_PORTAL,captured_at:checkedAt,checked_date:checkedAt.slice(0,10),
      method:snapshot.capture_method||"browser_capture",
      record_count:opportunities.length,coverage:snapshot.coverage||"Observed records, not guaranteed exhaustive.",
      caveat:"Snapshot only: opportunities may be amended, cancelled, expired, or changed after capture. No bid eligibility or scope verified."
    },
    opportunities
  };
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
  const input=process.argv[2],output=process.argv[3];
  if(!input||!output)throw Error("Usage: node scripts/radar.mjs SOURCE_JSON OUTPUT_JSON");
  const clean=normalizeSnapshot(JSON.parse(readFileSync(input,"utf8")));
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(clean,null,2)+"\n");
  console.log("Official observed opportunity records:",clean.opportunities.length);
  console.log("Venture matches:",clean.opportunities.filter(x=>x.matches.length).length);
}
