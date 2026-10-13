import {json} from "../../../server/access-auth.js";
export async function onRequestGet(context){
  try{
    const tables=await context.env.PRIVATE_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contacts','bid_opportunities','bid_tasks')"
    ).all();
    if((tables.results||[]).length!==3)
      return json({error:"D1 is connected, but migration 0001_initial.sql has not been applied."},503);
    return json({email:context.data.identity.email,ready:true});
  }catch{
    return json({error:"Private database unavailable. Check D1 migration."},503);
  }
}
