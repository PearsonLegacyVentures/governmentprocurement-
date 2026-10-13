import {accessIdentity,json} from "../../../server/access-auth.js";
export async function onRequest(context){
  const identity=await accessIdentity(context.request,context.env);
  if(!identity.ok)return json({error:identity.error},identity.status);
  if(!context.env.PRIVATE_DB)return json({error:"Cloudflare D1 binding PRIVATE_DB is not configured."},503);
  context.data.identity=identity;
  return context.next();
}
