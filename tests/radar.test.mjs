import test from "node:test";
import assert from "node:assert/strict";
import {parseDeadline,matchVentures,normalizeSnapshot,OFFICIAL_PORTAL} from "../scripts/radar.mjs";
test("Bonfire EDT date converts correctly",()=>{
  assert.deepEqual(parseDeadline("Oct 16th 2026, 4:00 PM EDT"),{
    deadline_date_local:"2026-10-16",deadline_time_local:"16:00",timezone:"EDT",deadline_utc:"2026-10-16T20:00:00.000Z"
  });
});
test("EST after daylight savings converts correctly",()=>{
  assert.equal(parseDeadline("Nov 3rd 2026, 5:00 PM EST").deadline_utc,"2026-11-03T22:00:00.000Z");
});
test("reject invalid date and unsupported timezone",()=>{
  assert.equal(parseDeadline("Nov 32nd 2026, 5:00 PM EST"),null);
  assert.equal(parseDeadline("tomorrow"),null);
});
test("hotel venue is a Mel J subcontracting lead, not direct rental scope",()=>{
  const m=matchVentures("HOTEL VENUE FOR NATIONAL SPORTS AWARDS");
  assert.equal(m.find(x=>x.venture==="Mel J's Event Rentals").match_type,"partner");
  assert.ok(!m.some(x=>x.venture==="Tranquilitas"));
});
test("catering alone is only a sector watch for an equipment rental firm",()=>{
  const m=matchVentures("Best of the Best ~ CATERING SERVICES");
  const event=m.find(x=>x.venture==="Mel J's Event Rentals");
  assert.equal(event.match_type,"watch");
  assert.ok(event.score<35);
});
test("hospitality suite requires partnership review, not an assumed direct bid",()=>{
  const m=matchVentures("Best of the Best ~ HOSPITALITY SUITE AND DECOR");
  assert.equal(m.find(x=>x.venture==="Mel J's Event Rentals").match_type,"partner");
});
test("ICT equipment is not direct software opportunity",()=>{
  const m=matchVentures("DICT Emergency ICT Equipment Bulk Order- October 2026");
  assert.equal(m.find(x=>x.venture==="Bahamas AI Solutions").match_type,"partner");
});
test("packing house electrical upgrade is not a direct BMC procurement",()=>{
  const m=matchVentures("Electrical Upgrade of BAIC Nassau Packing House");
  assert.equal(m.find(x=>x.venture==="Bahamas Mineral Company").match_type,"watch");
});
test("no false broad-sector qualification",()=>{
  assert.deepEqual(matchVentures("ROYAL BAHAMAS DEFENCE FORCE -TATICAL ROCKY BOOTS"),[]);
});
test("one verified Bonfire entry and unique ID",()=>{
  const row={url:"https://bahamas.bonfirehub.com/opportunities/257517",title:"HOTEL VENUE FOR NATIONAL SPORTS AWARDS",agency:"Ministry of Youth, Sport & Culture",deadline:"Oct 16th 2026, 4:00 PM EDT",reference:"MoYSC-TEST"};
  const sample={source_url:OFFICIAL_PORTAL,captured_at:"2026-10-13T13:30:00-04:00",opportunities:[row]};
  assert.equal(normalizeSnapshot(sample).opportunities.length,1);
  assert.throws(()=>normalizeSnapshot({...sample,opportunities:[row,row]}),/Duplicate/);
  assert.throws(()=>normalizeSnapshot({...sample,opportunities:[{...row,url:"https://evil.com/opportunities/257517"}]}),/Non-official/);
});
