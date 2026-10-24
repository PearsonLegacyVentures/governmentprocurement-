/* Public, source-backed Opportunity Radar: no authentication or browser storage. */
(function(){
"use strict";
const source="https://bahamas.bonfirehub.com/portal/?tab=openOpportunities";
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const model={query:"",venture:"matched",type:"all",includeExpired:false,sort:"relevance"};
let redraw=()=>{};
const uniq=xs=>[...new Set(xs)];
const now=()=>Date.now();
const validLink=u=>{try{const x=new URL(u);return x.protocol==="https:"&&x.hostname==="bahamas.bonfirehub.com"&&/^\/opportunities\/\d+$/.test(x.pathname)?x.href:source}catch{return source}};
function isExpired(entry){return !entry.deadline_utc||Number.isNaN(Date.parse(entry.deadline_utc))||Date.parse(entry.deadline_utc)<=now()}
function icon(t){return t==="direct"?"Direct service signal":t==="partner"?"Possible subcontract":"Sector watch"}
function badge(t){return t==="direct"?"direct":t==="partner"?"partner":"watch"}
function filterRows(rows){
 return rows.filter(row=>
   (model.includeExpired||!isExpired(row))&&
   (model.venture==="all"||(model.venture==="matched"?row.matches.length>0:row.matches.some(x=>x.venture===model.venture)))&&
   (model.type==="all"||row.matches.some(x=>x.match_type===model.type&&(model.venture==="matched"||model.venture==="all"||x.venture===model.venture)))&&
   (!model.query||[row.title,row.agency,row.reference,...(row.matches||[]).map(x=>x.venture)].some(v=>String(v||"").toLowerCase().includes(model.query))));
}
function entryCard(row){
 const expired=isExpired(row);
 const match=topMatch(row);
 const matches=(row.matches||[]).filter(x=>model.venture==="all"||model.venture==="matched"||x.venture===model.venture);
 const chips=matches.length?matches.map(x=>
   '<div class="radar-match '+badge(x.match_type)+'"><div class="radar-match-top"><strong>'+esc(x.venture)+'</strong><span>'+esc(icon(x.match_type))+'</span></div><p>'+esc(x.reason)+' · Matched: “'+esc(x.trigger)+'”</p></div>'
 ).join(""):'<div class="radar-no-match">No keyword-based match to an existing PLV business. This can still be a general procurement lead.</div>';
 return '<article class="radar-record '+esc(match?.match_type||'general')+'">'+
   '<div class="radar-record-top"><span class="radar-category">'+esc(row.agency)+'</span><span class="radar-status '+(expired?"expired":"observed")+'">'+(expired?"Deadline passed":"Open at last scan")+'</span></div>'+
   '<h3><a href="'+validLink(row.url)+'" target="_blank" rel="noopener noreferrer">'+esc(row.title)+' ↗</a></h3>'+
   '<div class="radar-meta"><span>Due '+esc(row.deadline_raw||"Not published")+'</span><span>Reference: '+esc(row.reference||"Not supplied")+'</span></div>'+
   chips+(match?'<p class="radar-next-move"><b>Suggested next move:</b> '+esc(nextAction(match.match_type))+'</p>':'')+
   '<div class="radar-actionline"><span>Eligibility, full specifications and submission conditions require document review.</span><a href="'+validLink(row.url)+'" target="_blank" rel="noopener noreferrer">Review tender <span aria-hidden="true">↗</span></a></div></article>';
}

const matchRank={direct:3,partner:2,watch:1};
function topMatch(row){
 const ms=Array.isArray(row.matches)?row.matches:[];
 return ms.slice().sort((a,b)=>(matchRank[b.match_type]||0)-(matchRank[a.match_type]||0)||(Number(b.score)||0)-(Number(a.score)||0))[0]||null;
}
function relevance(row){
 const m=topMatch(row);
 if(!m)return 0;
 const days=Math.max(0,(Date.parse(row.deadline_utc)-now())/86400000);
 const urgency=days<=2?12:days<=5?7:days<=10?3:0;
 return (matchRank[m.match_type]||0)*100+(Number(m.score)||0)+urgency;
}
function dueLabel(row){
 const ms=Date.parse(row.deadline_utc)-now();
 if(!Number.isFinite(ms)||ms<=0)return "Deadline passed";
 const days=Math.ceil(ms/86400000);
 if(days<=1)return "Due within 24 hours";
 return "Due in "+days+" days";
}
function nextAction(type){
 return type==="direct"?"Verify eligibility and requirements, then price delivery.":type==="partner"?"Check subcontractable scope and identify a qualified prime first.":"Watch the sector. Do not prepare a bid without confirmed scope.";
}
function spotlight(row){
 const match=topMatch(row);
 if(!match)return "";
 const type=match.match_type||"watch";
 return '<article class="radar-spotlight-card '+esc(type)+'">'+
  '<div class="radar-spotlight-label"><span>'+esc(type==="direct"?"DIRECT SERVICE SIGNAL":type==="partner"?"POSSIBLE PARTNER LEAD":"SECTOR WATCH ONLY")+'</span><strong>'+esc(dueLabel(row))+'</strong></div>'+
  '<h3>'+esc(row.title)+'</h3>'+
  '<p class="radar-spotlight-venture">'+esc(match.venture)+' <span>· '+esc(row.agency)+'</span></p>'+
  '<p class="radar-spotlight-reason">'+esc(match.reason)+' — title match: “'+esc(match.trigger)+'”.</p>'+
  '<p class="radar-spotlight-next"><b>Next move:</b> '+esc(nextAction(type))+'</p>'+
  '<a href="'+validLink(row.url)+'" target="_blank" rel="noopener noreferrer">Inspect official tender ↗</a>'+
 '</article>';
}
function brief(rows,meta,stale){
 const open=rows.filter(row=>!isExpired(row));
 const qualified=open.map(row=>({row,match:topMatch(row)})).filter(x=>x.match);
 const direct=qualified.filter(x=>x.match.match_type==="direct");
 const partner=qualified.filter(x=>x.match.match_type==="partner");
 const watch=qualified.filter(x=>x.match.match_type==="watch");
 const shortlist=[...direct,...partner,...watch].sort((a,b)=>relevance(b.row)-relevance(a.row)).slice(0,3);
 const msg=stale?"The saved scan is older than 48 hours. Confirm live listings before taking action.":
  direct.length?"Direct-fit title signals were found. Qualification still requires document review.":
  partner.length?"No direct-fit tenders in this scan. Review only realistic partner leads; don't chase weak matches.":
  "No strong-fit opportunities in this scan. That is useful information, not a reason to chase unrelated contracts.";
 const heading=direct.length?"Start with these opportunities":partner.length?"Potential partnerships worth checking":watch.length?"No strong fits — adjacent signals only":"Nothing worth chasing yet";
 return '<section class="radar-brief" aria-label="Your opportunity brief">'+
  '<div class="radar-brief-top"><div><div class="radar-kicker">YOUR OPPORTUNITY BRIEF · '+esc(meta.checked_date||"DATE UNKNOWN")+'</div>'+
  '<h2>'+esc(heading)+'</h2><p>'+esc(msg)+'</p></div>'+
  '<div class="radar-brief-counters">'+
    '<div><strong>'+direct.length+'</strong><span>Direct signals</span></div>'+
    '<div><strong>'+partner.length+'</strong><span>Partner leads</span></div>'+
    '<div><strong>'+watch.length+'</strong><span>Sector watches</span></div>'+
  '</div></div>'+
  (shortlist.length?'<div class="radar-spotlight-grid">'+shortlist.map(x=>spotlight(x.row)).join("")+'</div>':
   '<div class="radar-clear"><strong>No portfolio-relevant tenders need review from this snapshot.</strong><p>Check back after the next verified scan; you can also inspect all official listings below.</p></div>')+
  '<div class="radar-brief-bottom"><span>Ranked from title-based signals, not bid eligibility or probability of winning.</span><a href="#all-tenders">Explore the full list ↓</a></div>'+
 '</section>';
}

function selectOption(value,label,selected){return '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>'}
function screen(dataset){
 if(!dataset||!dataset.metadata||!Array.isArray(dataset.opportunities)){
   return '<section class="panel"><h2>Opportunity Radar is awaiting a verified tender snapshot.</h2>'+
    '<p>Public award history is available. Tender data has not been published to this deployment yet. We do not show invented opportunities.</p>'+
    '<a href="'+source+'" rel="noopener noreferrer" target="_blank">Check official Bonfire opportunities ↗</a></section>';
 }
 const meta=dataset.metadata,rows=dataset.opportunities;
 const fetched=Date.parse(meta.checked_date+"T00:00:00-04:00");
 const days=Math.floor((now()-fetched)/86400000);
 const stale=!Number.isFinite(days)||days>=2;
 const up=rows.filter(x=>!isExpired(x)),matched=up.filter(x=>(x.matches||[]).length>0);
 const opts=["Tranquilitas","Bahamas AI Solutions","Bahamas Mineral Company",
    "Mel J's Event Rentals","EasyTap","ClearKayakPhotos.com","Bahama Breeze Cabanas"];
 const options=selectOption("matched","Potential PLV matches",model.venture)+selectOption("all","All government listings",model.venture)+opts.map(x=>selectOption(x,x,model.venture)).join("");
 const visible=filterRows(rows);
 visible.sort((a,b)=>model.sort==="relevance"?
    relevance(b)-relevance(a)||a.deadline_utc.localeCompare(b.deadline_utc):
    a.deadline_utc.localeCompare(b.deadline_utc));
 const freshness='<div class="radar-capture '+(stale?"radar-warning":"")+'"><div><strong>'+
   (stale?"Historical snapshot — verify current listings":"Official Bonfire listing snapshot")+'</strong>'+
   '<p>Observed '+esc(meta.checked_date)+' · '+esc(meta.record_count)+' listings captured. '+esc(meta.coverage)+
   ' A tender can change or be cancelled after the scan.</p></div>'+
   '<a target="_blank" rel="noopener noreferrer" href="'+source+'">Official portal ↗</a></div>';
 const top='<div class="radar-overview">'+[
    ["Observed listings",rows.length,"Source snapshot"],
    ["Deadlines not yet passed",up.length,"Based on extracted deadlines"],
    ["PLV research leads",matched.length,"Keyword-based, not qualified"],
    ["Source checked",meta.checked_date,"Not continuous live availability"]
 ].map(x=>'<div class="radar-stat"><small>'+esc(x[0])+'</small><strong>'+esc(x[1])+'</strong><span>'+esc(x[2])+'</span></div>').join("")+'</div>';
 const filter='<div class="radar-controls">'+
  '<label>Business fit<select data-radar="venture">'+options+'</select></label>'+
  '<label>Match classification<select data-radar="type">'+[
    ["all","All classifications"],["direct","Direct signal"],["partner","Partner/subcontract"],["watch","Sector watch"]
  ].map(x=>selectOption(x[0],x[1],model.type)).join("")+'</select></label>'+
  '<label>Sort by<select data-radar="sort">'+[["relevance","Best fit first"],["deadline","Soonest deadline"]].map(x=>selectOption(x[0],x[1],model.sort)).join("")+'</select></label>'+
  '<label class="radar-search">Search tender listings<input type="search" data-radar="query" placeholder="Tender, agency, reference..." value="'+esc(model.query)+'"></label>'+
  '<label class="radar-check"><input type="checkbox" data-radar="includeExpired" '+(model.includeExpired?'checked':'')+'> Include expired deadlines</label></div>';
 const cards=visible.length?visible.map(entryCard).join(""):'<section class="panel"><div class="empty"><strong>No matching listings.</strong>Try a broader category, or open the official portal for newly posted tenders.</div></section>';
 return freshness+brief(rows,meta,stale)+top+filter+
  '<div id="all-tenders" class="radar-section-heading"><h2>All matching listings <span>'+visible.length+'</span></h2><small>Source-verified listing; proposal qualification not assessed</small></div>'+
  '<div class="radar-list">'+cards+'</div>'+
  '<p class="radar-footnote">Matching uses explainable title keywords only and is not a recommendation to bid. No confidential PLV details are stored here. Private bid management activates after D1 and Access setup.</p>';
}
document.addEventListener("change",event=>{
 const el=event.target.closest("[data-radar]");
 if(!el)return;
 const key=el.dataset.radar;
 if(!Object.prototype.hasOwnProperty.call(model,key))return;
 model[key]=key==="includeExpired"?el.checked:String(el.value||"");
 redraw();
});
document.addEventListener("input",event=>{
 const el=event.target.closest('[data-radar="query"]');
 if(!el)return;
 // Avoid destroying typing focus by postponing until user commits search.
 model.query=String(el.value||"").trim().toLowerCase();
});
document.addEventListener("keydown",event=>{
 const el=event.target.closest('[data-radar="query"]');
 if(el&&event.key==="Enter"){event.preventDefault();el.blur();redraw()}
});
window.PLVRadar={screen,setRedraw:fn=>{redraw=fn}};
})();
