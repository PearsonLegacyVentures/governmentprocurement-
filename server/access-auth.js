/**
 * Verify Cloudflare Access RS256 JWT for each private API request.
 * Access binding settings are Cloudflare environment variables, not source.
 */
export const json=(data,status=200)=>Response.json(data,{
  status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
});
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
const parseSegment=s=>JSON.parse(new TextDecoder().decode(bytes(s)));

export async function accessIdentity(request,env){
  const domain=String(env.ACCESS_TEAM_DOMAIN||"").trim().toLowerCase();
  const audience=String(env.ACCESS_AUD||"").trim();
  const allowed=String(env.ADMIN_EMAILS||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(domain)||!audience||!allowed.length)
    return {ok:false,status:503,error:"Cloudflare Access private workspace is not configured."};
  const jwt=request.headers.get("cf-access-jwt-assertion");
  if(!jwt)return {ok:false,status:401,error:"Cloudflare Access login is required."};
  try{
    const parts=jwt.split(".");
    if(parts.length!==3)throw Error("Malformed JWT");
    const header=parseSegment(parts[0]),claims=parseSegment(parts[1]);
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256"||typeof header.kid!=="string"||
       claims.iss!=="https://"+domain||!Array.isArray(claims.aud)||
       !claims.aud.includes(audience)||claims.type!=="app"||
       typeof claims.exp!=="number"||claims.exp<=now||
       typeof claims.iat!=="number"||claims.iat>now+60||
       (typeof claims.nbf==="number"&&claims.nbf>now+60))throw Error("Invalid claims");
    const email=String(claims.email||"").trim().toLowerCase();
    if(!email||!allowed.includes(email))return {ok:false,status:403,error:"Account not authorized."};
    const response=await fetch("https://"+domain+"/cdn-cgi/access/certs",
      {cf:{cacheEverything:true,cacheTtl:600}});
    if(!response.ok)throw Error("Access certificates unavailable");
    const certs=await response.json();
    const key=(certs.keys||[]).find(k=>k.kid===header.kid&&k.kty==="RSA");
    if(!key)throw Error("Unrecognized signing key");
    const publicKey=await crypto.subtle.importKey("jwk",key,
      {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    const signed=new TextEncoder().encode(parts[0]+"."+parts[1]);
    const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,bytes(parts[2]),signed);
    if(!valid)throw Error("Invalid JWT signature");
    return {ok:true,email};
  }catch{
    return {ok:false,status:401,error:"Invalid or expired Cloudflare Access session."};
  }
}
