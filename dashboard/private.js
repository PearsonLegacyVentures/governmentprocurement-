/* Private, Access-authenticated procurement CRM. No localStorage or public demo data. */
(function(){
"use strict";
const esc=value=>String(value==null?"":value).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const state={status:"idle",email:"",error:"",records:{contacts:[],bids:[],tasks:[]},editing:{contacts:null,bids:null,tasks:null},callback:null};
const endpoint=k=>"/api/private/"+k;
async function request(url,options){
  const res=await fetch(url,{credentials:"same-origin",cache:"no-store",...options});
  let data={};
  try{data=await res.json()}catch{}
  if(!res.ok)throw Error(data.error||"Private API returned HTTP "+res.status);
  return data;
}
async function load(callback){
  if(state.status==="loading")return;
  state.callback=callback||state.callback;
  state.status="loading";
  state.error="";
  try{
    const session=await request("/api/private/session");
    state.email=session.email||"";
    const results=await Promise.all(["contacts","bids","tasks"].map(x=>request(endpoint(x))));
    ["contacts","bids","tasks"].forEach((x,i)=>state.records[x]=results[i].records||[]);
    state.status="ready";
  }catch(error){state.status="locked";state.error=error.message||"Private workspace is unavailable."}
  state.callback?.();
}
const label=(name,title,value="",type="text",required=false)=>
  '<label class="private-field"><span>'+esc(title)+'</span><input '+(required?'required ':'')+
  'name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value||"")+'"></label>';
const memo=(name,title,value="",placeholder="")=>
  '<label class="private-field wide"><span>'+esc(title)+'</span><textarea name="'+esc(name)+'" rows="3" placeholder="'+esc(placeholder)+'">'+esc(value||"")+'</textarea></label>';
const select=(name,title,items,value="")=>
  '<label class="private-field"><span>'+esc(title)+'</span><select name="'+esc(name)+'">'+
  items.map(x=>'<option value="'+esc(x)+'"'+(x===value?' selected':'')+'>'+esc(x)+'</option>').join("")+
  '</select></label>';
const ventures=["Tranquilitas","Bahamas AI Solutions","Bahamas Mineral Company","Mel J's Event Rentals","EasyTap",
"ClearKayakPhotos.com","Bahama Breeze Cabanas","Pearson Legacy Ventures","Other"];
function saveForm(collection,html,id){
  return '<form data-private-form="'+collection+'" data-record-id="'+esc(id||"")+'" class="private-form">'+html+
    '<div class="private-form-actions"><button class="private-primary" type="submit">'+(id?"Save changes":"Create record")+
    '</button><button class="private-secondary" type="button" data-private-action="cancel" data-collection="'+collection+'">Cancel</button></div></form>';
}
function bidForm(item){
  const r=item||{};
  let fields=label("title","Tender / opportunity title",r.title,"text",true)+
    label("agency","Government buyer",r.agency)+
    select("venture","Target business",ventures,r.venture||"Other")+
    label("source_url","Official tender URL",r.source_url,"url")+
    label("close_date","Submission deadline",r.close_date,"date")+
    label("estimated_value","Estimated / reported value",r.estimated_value)+
    select("stage","Pipeline stage",["watching","qualifying","pursuing","submitted","won","lost"],r.stage||"watching")+
    select("priority","Priority",["low","medium","high"],r.priority||"medium")+
    label("owner","Responsible person",r.owner);
  const opts=['<option value="">No linked contact</option>'].concat(
    state.records.contacts.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===r.related_contact_id?' selected':'')+'>'+
      esc(c.contact_name+" · "+c.organization)+'</option>')
  ).join("");
  fields+='<label class="private-field"><span>Relationship / supplier contact</span><select name="related_contact_id">'+opts+'</select></label>';
  fields+=memo("win_theme","Win theme / customer outcome",r.win_theme,
    "What measurable government outcome makes our offer compelling?")+
    memo("bid_strategy","Delivery and bid strategy",r.bid_strategy,
    "Scope, capability, bid/no-bid rationale, potential prime and subcontractors")+
    memo("eligibility_notes","Eligibility & compliance",r.eligibility_notes,
    "Business licence, tax standing, references, insurance, registrations and mandatory documents")+
    memo("pricing_notes","Pricing and margin assumptions",r.pricing_notes,
    "Quote inputs, subcontractor costs, transport, contingency and minimum viable margin")+
    memo("competitor_notes","Competitors and positioning",r.competitor_notes,
    "Known historical suppliers, differentiated capabilities; only evidence-backed observations")+
    memo("risks","Risks / conditions",r.risks)+
    memo("next_action","Immediate next action",r.next_action);
  return saveForm("bids",fields,r.id);
}
function contactForm(item){
  const r=item||{};
  const fields=label("contact_name","Contact person (if known)",r.contact_name)+
    label("organization","Organization / company",r.organization)+
    label("role","Position / responsibility",r.role)+
    select("kind","Relationship type",["agency","supplier","prime","consultant","other"],r.kind||"other")+
    label("email","Email",r.email,"email")+label("phone","Phone",r.phone,"tel")+
    label("website","Website",r.website,"url")+
    select("relationship_status","Relationship stage",["new","researching","introduced","engaged","priority"],r.relationship_status||"new")+
    label("last_contacted_on","Last contacted",r.last_contacted_on,"date")+
    memo("next_step","Follow-up action",r.next_step)+memo("notes","Private relationship notes",r.notes);
  return saveForm("contacts",fields,r.id);
}
function taskForm(item){
  const r=item||{};
  const selectOptions=['<option value="">Unlinked task</option>'].concat(state.records.bids.map(
    b=>'<option value="'+esc(b.id)+'"'+(r.opportunity_id===b.id?' selected':'')+'>'+esc(b.title)+'</option>'
  )).join("");
  const fields=label("title","Task",r.title,"text",true)+
    '<label class="private-field"><span>Related bid</span><select name="opportunity_id">'+selectOptions+'</select></label>'+
    label("due_date","Due date",r.due_date,"date")+
    select("status","Progress",["open","in_progress","done"],r.status||"open")+
    label("assigned_to","Assigned to",r.assigned_to)+memo("detail","Instructions or notes",r.detail);
  return saveForm("tasks",fields,r.id);
}
function statusBox(){
  let subtitle=state.status==="loading"?"Verifying Cloudflare Access and private database…":
    state.error||"Private workspace requires Cloudflare Access and D1.";
  return '<section class="panel private-locked"><h2>Private bid workspace</h2><p>'+esc(subtitle)+
    '</p><p>Public award intelligence remains available. Private contacts and strategies cannot be read or edited until the authenticated Cloudflare environment is configured.</p>'+
    '<button class="private-primary" type="button" data-private-action="refresh">Retry secure connection</button></section>';
}
function banner(head,desc,button,collection){
  return '<div class="private-banner"><div><div class="eyebrow">PLV · CONFIDENTIAL WORKSPACE</div><h2>'+esc(head)+'</h2><p>'+esc(desc)+'</p>'+
    '<small>Access account: '+esc(state.email)+'</small></div>'+
    '<button class="private-primary" type="button" data-private-action="new" data-collection="'+esc(collection)+'">+ '+esc(button)+'</button></div>';
}
function card(content){return '<article class="private-card">'+content+'</article>'}
function actionButtons(k,id){
  return '<div class="private-item-actions"><button type="button" class="private-secondary" data-private-action="edit" data-collection="'+k+'" data-id="'+esc(id)+'">Edit</button>'+
    '<button type="button" class="private-archive" data-private-action="archive" data-collection="'+k+'" data-id="'+esc(id)+'">Archive</button></div>';
}
function visibleDate(x){return x||"Not entered"}
function bidList(){
  const rows=state.records.bids.slice().sort((a,b)=>(a.close_date||"9999").localeCompare(b.close_date||"9999"));
  if(!rows.length)return '<div class="empty">No private opportunities yet. Create your first bid record to start tracking.</div>';
  return rows.map(r=>card('<div class="private-item-top"><strong>'+esc(r.title)+'</strong>'+
    '<span class="pill">'+esc(r.stage)+'</span></div>'+
    '<div class="private-item-meta">'+esc(r.venture)+' · '+esc(r.agency||"Buyer not listed")+
    ' · Due '+esc(visibleDate(r.close_date))+' · '+esc(r.priority)+' priority</div>'+
    (r.win_theme?'<p><b>Win theme:</b> '+esc(r.win_theme)+'</p>':"")+
    (r.next_action?'<p><b>Next:</b> '+esc(r.next_action)+'</p>':"")+
    (r.source_url&&r.source_url.startsWith("https://")?'<a class="private-source" href="'+esc(r.source_url)+'" target="_blank" rel="noopener noreferrer">Original tender ↗</a>':"")+
    actionButtons("bids",r.id))).join("");
}
function contactsList(){
  if(!state.records.contacts.length)return '<div class="empty">No contacts yet. Build your list of agencies, prime contractors, suppliers and decision-makers.</div>';
  return state.records.contacts.map(r=>card('<div class="private-item-top"><strong>'+esc(r.contact_name||r.organization)+'</strong><span class="pill">'+esc(r.relationship_status)+'</span></div>'+
    '<div class="private-item-meta">'+esc(r.organization)+' · '+esc(r.role)+' · '+esc(r.kind)+'</div>'+
    (r.email?'<p>Email: <a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a></p>':"")+
    (r.phone?'<p>Phone: '+esc(r.phone)+'</p>':"")+
    (r.next_step?'<p><b>Follow-up:</b> '+esc(r.next_step)+'</p>':"")+
    actionButtons("contacts",r.id))).join("");
}
function taskList(){
  const arr=state.records.tasks.slice().sort((a,b)=>(a.due_date||"9999").localeCompare(b.due_date||"9999"));
  if(!arr.length)return '<div class="empty">No action tasks yet. Add deadlines and assign next steps to a bid.</div>';
  return arr.map(r=>{
    const linked=state.records.bids.find(x=>x.id===r.opportunity_id);
    return card('<div class="private-item-top"><strong>'+esc(r.title)+'</strong><span class="pill">'+esc(r.status)+'</span></div>'+
      '<div class="private-item-meta">Due '+esc(visibleDate(r.due_date))+
      ' · '+esc(r.assigned_to||"Unassigned")+
      (linked?' · '+esc(linked.title):"")+'</div>'+
      (r.detail?'<p>'+esc(r.detail)+'</p>':"")+
      actionButtons("tasks",r.id)
    );
  }).join("");
}
function counts(){
  return '<div class="private-stats">'+
    [['Pipeline',state.records.bids.length],['In pursuit',state.records.bids.filter(x=>["qualifying","pursuing"].includes(x.stage)).length],
     ['Relationship contacts',state.records.contacts.length],['Open actions',state.records.tasks.filter(x=>x.status!=="done").length]]
    .map(([label,n])=>'<div class="metric"><div class="metric-label">'+esc(label)+'</div><div class="metric-value">'+n+'</div></div>').join("")+
    '</div>';
}
function screen(tab,callback){
  state.callback=callback;
  if(state.status==="idle")void load(callback);
  if(state.status!=="ready")return statusBox();
  const section=tab==="bids"?"bids":tab==="contacts"?"contacts":"tasks";
  const item=state.records[section].find(x=>x.id===state.editing[section]);
  const editing=state.editing[section]!==null;
  const heading=section==="bids"?"Bid pipeline":section==="contacts"?"Relationship CRM":"Actions & deadlines";
  const description=section==="bids"?"Private bid/no-bid decisions, delivery plans, pricing and win strategies.":
    section==="contacts"?"Agency relationships, supplier contacts and potential prime contractors.":
    "Execution, ownership and deadline tracking for procurement pursuits.";
  const button=section==="bids"?"Add bid":section==="contacts"?"Add contact":"Add task";
  const form=editing?'<section class="panel private-editor"><h3>'+esc(item?"Edit record":"Create record")+'</h3>'+
    (section==="bids"?bidForm(item):section==="contacts"?contactForm(item):taskForm(item))+'</section>':"";
  const listing=section==="bids"?bidList():section==="contacts"?contactsList():taskList();
  return banner(heading,description,button,section)+counts()+form+
    '<div class="private-list">'+listing+'</div>'+
    (state.error?'<p class="private-error">'+esc(state.error)+'</p>':"");
}
async function mutate(collection,method,data){
  await request(endpoint(collection),{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  await load(state.callback);
}
document.addEventListener("click",async event=>{
  const button=event.target.closest("[data-private-action]");
  if(!button)return;
  const action=button.dataset.privateAction,k=button.dataset.collection,id=button.dataset.id;
  if(action==="refresh"){state.status="idle";void load(state.callback);state.callback?.();return}
  if(action==="new"){state.editing[k]="__new__";state.error="";state.callback?.();return}
  if(action==="cancel"){state.editing[k]=null;state.error="";state.callback?.();return}
  if(action==="edit"){state.editing[k]=id;state.error="";state.callback?.();return}
  if(action==="archive"){
    if(!window.confirm("Archive this private "+(k==="bids"?"bid":k==="contacts"?"contact":"task")+"? You can restore it later through D1."))return;
    button.disabled=true;
    try{await mutate(k,"DELETE",{id});state.editing[k]=null}
    catch(error){state.error=error.message;state.callback?.()}
    finally{button.disabled=false}
  }
});
document.addEventListener("submit",async event=>{
  const form=event.target.closest("form[data-private-form]");
  if(!form)return;
  event.preventDefault();
  const k=form.dataset.privateForm,id=form.dataset.recordId;
  const data=Object.fromEntries(new FormData(form).entries());
  if(id)data.id=id;
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  try{await mutate(k,id?"PATCH":"POST",data);state.editing[k]=null;state.error="";state.callback?.()}
  catch(error){state.error=error.message;state.callback?.()}
  finally{submit.disabled=false}
});
window.PLVPrivate={screen};
})();
