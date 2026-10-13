/**
 * /api/private/{contacts|bids|tasks}
 * Private CRUD for Cloudflare D1, guarded by directory _middleware.
 * Records are soft-archived; source data is never written to this database.
 */
import {json} from "../../../server/access-auth.js";
const models={
  contacts:{
    table:"contacts",required:["contact_name"],
    max:{contact_name:160,organization:160,role:120,kind:30,email:254,
      phone:80,website:500,relationship_status:40,notes:4000,
      next_step:2000,last_contacted_on:10},
    enums:{kind:["agency","supplier","prime","consultant","other"],
      relationship_status:["new","researching","introduced","engaged","priority"]},
    defaults:{kind:"other",relationship_status:"new"}
  },
  bids:{
    table:"bid_opportunities",required:["title"],
    max:{title:220,agency:180,venture:100,source_url:1000,close_date:10,
      estimated_value:100,stage:30,priority:20,owner:120,win_theme:2000,
      bid_strategy:8000,eligibility_notes:4000,pricing_notes:4000,
      competitor_notes:4000,risks:4000,next_action:2000,related_contact_id:80},
    enums:{stage:["watching","qualifying","pursuing","submitted","won","lost"],
      priority:["low","medium","high"],
      venture:["Tranquilitas","Bahamas AI Solutions","Bahamas Mineral Company",
        "Mel J's Event Rentals","EasyTap","ClearKayakPhotos.com",
        "Bahama Breeze Cabanas","Pearson Legacy Ventures","Other"]},
    defaults:{stage:"watching",priority:"medium",venture:"Other"}
  },
  tasks:{
    table:"bid_tasks",required:["title"],
    max:{opportunity_id:80,title:240,due_date:10,status:40,assigned_to:120,detail:3000},
    enums:{status:["open","in_progress","done"]},
    defaults:{status:"open"}
  }
};
function cleanBody(body,model,create){
  const clean={};
  for(const [field,length] of Object.entries(model.max)){
    if(!Object.prototype.hasOwnProperty.call(body,field))continue;
    if(body[field]!==null&&typeof body[field]!=="string")throw Error(field+" must be text");
    const value=String(body[field]||"").trim();
    if(value.length>length)throw Error(field+" exceeds the length limit");
    if(model.enums?.[field]&&!model.enums[field].includes(value))throw Error("Invalid "+field);
    if(field==="email"&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error("Invalid email");
    if((field==="source_url"||field==="website")&&value){
      let url;
      try{url=new URL(value)}catch{throw Error(field+" must be a valid HTTPS address")}
      if(url.protocol!=="https:"||!url.hostname.includes("."))throw Error(field+" must be a valid HTTPS address");
    }
    if(["close_date","due_date","last_contacted_on"].includes(field)&&value){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z")))
        throw Error(field+" must be YYYY-MM-DD");
    }
    clean[field]=["related_contact_id","opportunity_id"].includes(field)?value||null:value;
  }
  if(create){
    for(const [key,val] of Object.entries(model.defaults)){
      if(!clean[key])clean[key]=val;
    }
  }
  for(const field of model.required){
    if((create||Object.prototype.hasOwnProperty.call(clean,field))&&!clean[field])
      throw Error(field+" is required");
  }
  if(!Object.keys(clean).length)throw Error("No writable fields provided");
  return clean;
}
async function bodyJson(request){
  const length=Number(request.headers.get("content-length")||0);
  if(length>38000)throw Error("Request body exceeds size limit");
  const payload=await request.text();
  if(payload.length>38000)throw Error("Request body exceeds size limit");
  const parsed=JSON.parse(payload);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("Expected JSON object");
  return parsed;
}
const validId=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||""));
export async function onRequest(context){
  const model=models[String(context.params.collection||"")];
  if(!model)return json({error:"Unknown private collection"},404);
  const {request}=context;
  const db=context.env.PRIVATE_DB;
  if(request.method==="GET"){
    try{
      const order=model.table==="bid_tasks"?"due_date ASC, updated_at DESC":"updated_at DESC";
      const sql="SELECT * FROM "+model.table+" WHERE archived_at IS NULL ORDER BY "+order+" LIMIT 500";
      const result=await db.prepare(sql).all();
      return json({records:result.results||[]});
    }catch{
      return json({error:"D1 is unavailable or migration is incomplete."},503);
    }
  }
  if(!["POST","PATCH","DELETE"].includes(request.method))
    return new Response("Method not allowed",{status:405,headers:{Allow:"GET, POST, PATCH, DELETE","Cache-Control":"no-store"}});
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return json({error:"Same-origin request required"},403);
  let body;
  try{body=await bodyJson(request)}catch(error){return json({error:error.message||"Invalid JSON"},400)}
  if(request.method==="DELETE"){
    if(!validId(body.id))return json({error:"Invalid ID"},400);
    try{
      const now=new Date().toISOString();
      const sql="UPDATE "+model.table+" SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL";
      const result=await db.prepare(sql).bind(now,now,body.id).run();
      return result.meta?.changes?json({ok:true}):json({error:"Record not found"},404);
    }catch{return json({error:"Unable to archive record"},503)}
  }
  let input;
  try{input=cleanBody(body,model,request.method==="POST")}
  catch(error){return json({error:error.message},400)}
  try{
    const now=new Date().toISOString();
    if(request.method==="POST"){
      const id=crypto.randomUUID();
      const values={id,...input,created_by:context.data.identity.email,created_at:now,updated_at:now};
      const cols=Object.keys(values);
      const sql="INSERT INTO "+model.table+" ("+cols.join(",")+") VALUES ("+cols.map(()=>"?").join(",")+")";
      await db.prepare(sql).bind(...Object.values(values)).run();
      return json({ok:true,id},201);
    }
    if(!validId(body.id))return json({error:"Invalid ID"},400);
    input.updated_at=now;
    const fields=Object.keys(input);
    const sql="UPDATE "+model.table+" SET "+fields.map(k=>k+"=?").join(",")+" WHERE id=? AND archived_at IS NULL";
    const result=await db.prepare(sql).bind(...Object.values(input),body.id).run();
    return result.meta?.changes?json({ok:true,id:body.id}):json({error:"Record not found"},404);
  }catch(error){
    if(String(error).includes("FOREIGN KEY"))return json({error:"Linked contact or bid does not exist"},400);
    return json({error:"Unable to save record; confirm D1 schema and binding."},503);
  }
}
