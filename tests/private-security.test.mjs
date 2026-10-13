import test from 'node:test';
import assert from 'node:assert/strict';
import {accessIdentity} from '../server/access-auth.js';
import {onRequest as guard} from '../functions/api/private/_middleware.js';
import {onRequest as records} from '../functions/api/private/[collection].js';

function request(method='GET',headers={}){
  return new Request('https://procurement.example.com/api/private/bids',{method,headers});
}
test('missing Access configuration blocks API',async()=>{
  const result=await accessIdentity(request(),{});
  assert.equal(result.ok,false);
  assert.equal(result.status,503);
});
test('configured Access without signed token blocks API',async()=>{
  const result=await accessIdentity(request(),{
    ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',
    ACCESS_AUD:'aud-test',ADMIN_EMAILS:'private@example.com'
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,401);
});
test('forged unsigned token is denied',async()=>{
  const token='eyJhbGciOiJub25lIiwia2lkIjoiZmFrZSJ9.eyJhdWQiOlsiYXVkLXRlc3QiXX0.signature';
  const result=await accessIdentity(request('GET',{'cf-access-jwt-assertion':token}),{
    ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',
    ACCESS_AUD:'aud-test',ADMIN_EMAILS:'private@example.com'
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,401);
});
test('middleware refuses any private query before it hits database',async()=>{
  let called=false;
  const res=await guard({
    request:request(),env:{PRIVATE_DB:{prepare(){called=true;throw Error('unsafe')}}},
    data:{},next(){called=true;return new Response('unsafe')}
  });
  assert.equal(res.status,503);
  assert.equal(called,false);
  assert.equal(res.headers.get('Cache-Control'),'no-store');
});
test('collection rejects cross-origin writes without touching DB',async()=>{
  let called=false;
  const req=new Request('https://procurement.example.com/api/private/contacts',{
    method:'POST',headers:{'origin':'https://attacker.example','content-type':'application/json'},
    body:JSON.stringify({contact_name:'Fake'})
  });
  const result=await records({request:req,params:{collection:'contacts'},env:{
    PRIVATE_DB:{prepare(){called=true;throw Error('not allowed')}}
  },data:{identity:{email:'verified@example.com'}}});
  assert.equal(result.status,403);
  assert.equal(called,false);
});
