const ZONES=["House & Yard","Side Yard","Mid Meadow","Upper Meadow",'West "40"',"West Woods","North Woods","Pond","South Woods"];
const EVENT_ZONE="Whole Property";
const ZONE_INFO={
  "House & Yard":"The house and immediately surrounding maintained lawn and planting areas within the white boundary.",
  "Side Yard":"The lower open grassy area nearest the House & Yard, before the meadow rises toward the upper property.",
  "Mid Meadow":"The middle open meadow between the Upper Meadow and the Side Yard.",
  "Upper Meadow":"The uppermost open meadow near the road, between the trees at the top of the property and the first major tree below.",
  'West "40"':"The large western open-field area used for field, meadow, and open-ground observations.",
  "West Woods":"The substantial wooded area through the west-central and southwest part of the property, above and west of the pond.",
  "North Woods":"The wooded area north and northeast of the house, extending to the property boundary.",
  "Pond":"The pond and its immediate pond-edge habitat.",
  "South Woods":"The wooded area south of the pond, continuing toward the lower end of the property."
};
const LEGACY_ZONE_MAP={
  "Front Drive / Roadside":"House & Yard","West Field":'West "40"',"East Field":"Side Yard","Central Transition":"West Woods",
  "West Tree Line":"West Woods","East Woods Edge":"Side Yard"
};

const SUPABASE_URL='https://tultwekwigfvcorwejgf.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHR3ZWt3aWdmdmNvcndlamdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjY4MTksImV4cCI6MjEwNDgwMjgxOX0.MwTuq8BRvIGNKf8heoFWvyD-80gaPDE6KzkhULY0JAw';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let currentUser=null, zoneRows=[], cloudReady=false, syncing=false;
let startupLocalUser=localStorage.getItem('hs_cloud_user_id')||'';
let pendingOps=JSON.parse(localStorage.getItem('hs_pending_ops')||'[]');
let startupLocalObservations=null;
function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
function newUuid(){return crypto.randomUUID?crypto.randomUUID():('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}
function cachePending(){localStorage.setItem('hs_pending_ops',JSON.stringify(pendingOps))}
function setSyncStatus(state,text){const chip=$('#syncChip'),dot=$('#syncDot'),label=$('#syncText');if(!chip)return;chip.classList.remove('syncing','synced','offline','error');chip.classList.add(state);if(label)label.textContent=text||({syncing:'Saving…',synced:'Synced',offline:'Offline',error:'Sync issue'}[state]||'Cloud')}
function queueOp(op){if(op.type==='upsert')pendingOps=pendingOps.filter(x=>!(x.type==='upsert'&&String(x.record?.id)===String(op.record.id)));if(op.type==='delete')pendingOps=pendingOps.filter(x=>!(x.type==='upsert'&&String(x.record?.id)===String(op.id))&&!(x.type==='delete'&&String(x.id)===String(op.id)));pendingOps.push(op);cachePending();setSyncStatus('offline','Queued')}
function zoneIdFor(name){return zoneRows.find(z=>z.name===name)?.id||null}
function dataUrlToBlob(dataUrl){const [head,data]=dataUrl.split(',');const mime=(head.match(/data:(.*?);/)||[])[1]||'image/jpeg';const bin=atob(data),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:mime})}
async function loadZoneRows(){if(!currentUser)return;const {data,error}=await sb.from('property_zones').select('id,name,description,sort_order').order('sort_order');if(error)throw error;zoneRows=data||[]}
async function ensureSpecies(record){if(!currentUser||record.kind==='Seasonal/Event')return null;let q=await sb.from('species').select('id,common_name,category').ilike('common_name',record.name).limit(1);if(q.error)throw q.error;if(q.data?.length){const sp=q.data[0];if(sp.category!==record.group){const u=await sb.from('species').update({category:record.group}).eq('id',sp.id);if(u.error)throw u.error}return sp.id}const {data,error}=await sb.from('species').insert({user_id:currentUser.id,common_name:record.name,category:record.group||inferGroup(record)}).select('id').single();if(error)throw error;return data.id}
async function ensureIndividualPlant(record,speciesId,zoneId){if(!currentUser||record.kind!=='Plant'||!record.individualPlant)return null;let q=await sb.from('individual_plants').select('id,name').eq('species_id',speciesId).ilike('name',record.individualPlant).limit(1);if(q.error)throw q.error;if(q.data?.length)return q.data[0].id;const {data,error}=await sb.from('individual_plants').insert({user_id:currentUser.id,species_id:speciesId,name:record.individualPlant,zone_id:zoneId||null}).select('id').single();if(error)throw error;return data.id}
async function cloudUpsertObservation(record,{queueOnFail=true}={}){if(!currentUser){if(queueOnFail)queueOp({type:'upsert',record});return false}if(!navigator.onLine){if(queueOnFail)queueOp({type:'upsert',record});return false}try{syncing=true;setSyncStatus('syncing','Saving…');if(!isUuid(record.id)){const old=record.id;record.id=newUuid();const i=observations.findIndex(o=>String(o.id)===String(old));if(i>=0)observations[i].id=record.id;save()}const zoneId=record.zone===EVENT_ZONE?null:zoneIdFor(record.zone);const speciesId=await ensureSpecies(record);const individualId=await ensureIndividualPlant(record,speciesId,zoneId);const payload={id:record.id,user_id:currentUser.id,observation_type:record.kind,subject_name:record.name,species_id:speciesId,individual_plant_id:individualId,zone_id:zoneId,location_note:record.locationNote||null,observation_date:record.date,observation_time:record.kind==='Seasonal/Event'?null:(record.time||null),quantity:record.kind==='Seasonal/Event'?1:Number(record.count||1),activity_or_stage:record.detail||null,is_milestone:!!record.isMilestone,milestone_type:record.isMilestone?(record.milestoneType||null):null,measurement:record.kind==='Seasonal/Event'&&record.measurement!==''?Number(record.measurement):null,measurement_unit:record.kind==='Seasonal/Event'&&record.measurement!==''?(record.measurementUnit||null):null,start_time:record.kind==='Seasonal/Event'?(record.time||null):null,end_time:record.kind==='Seasonal/Event'?(record.eventEndTime||null):null,notes:record.notes||null,updated_at:new Date().toISOString()};const {error}=await sb.from('observations').upsert(payload,{onConflict:'id'});if(error)throw error;
if(record.photo&&record.photo.startsWith('data:')){const path=`${currentUser.id}/${record.id}.jpg`;const up=await sb.storage.from('observation-photos').upload(path,dataUrlToBlob(record.photo),{contentType:'image/jpeg',upsert:true});if(up.error)throw up.error;const existing=await sb.from('observation_photos').select('id').eq('observation_id',record.id).limit(1);if(existing.error)throw existing.error;if(existing.data?.length){const pu=await sb.from('observation_photos').update({storage_path:path}).eq('id',existing.data[0].id);if(pu.error)throw pu.error}else{const pi=await sb.from('observation_photos').insert({user_id:currentUser.id,observation_id:record.id,storage_path:path});if(pi.error)throw pi.error}record._photoPath=path}
record._speciesId=speciesId;record._individualPlantId=individualId;pendingOps=pendingOps.filter(x=>!(x.type==='upsert'&&String(x.record?.id)===String(record.id)));cachePending();setSyncStatus('synced','Synced');return true}catch(err){console.error('Cloud save failed',err);if(queueOnFail)queueOp({type:'upsert',record});setSyncStatus(navigator.onLine?'error':'offline',navigator.onLine?'Sync issue':'Offline');toast('Saved on this device; cloud sync will retry');return false}finally{syncing=false}}
async function cloudDeleteObservation(id,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'delete',id});return false}try{setSyncStatus('syncing','Saving…');const pr=await sb.from('observation_photos').select('storage_path').eq('observation_id',id);if(pr.error)throw pr.error;const paths=(pr.data||[]).map(x=>x.storage_path).filter(Boolean);if(paths.length){const rm=await sb.storage.from('observation-photos').remove(paths);if(rm.error)throw rm.error}const d=await sb.from('observations').delete().eq('id',id);if(d.error)throw d.error;pendingOps=pendingOps.filter(x=>!(x.type==='delete'&&String(x.id)===String(id)));cachePending();setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'delete',id});setSyncStatus('error','Sync issue');return false}}
async function cloudRenameSpecies(oldName,newName,newGroup,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'renameSpecies',oldName,newName,newGroup});return false}try{setSyncStatus('syncing','Saving…');const q=await sb.from('species').select('id').ilike('common_name',oldName);if(q.error)throw q.error;for(const sp of q.data||[]){const u=await sb.from('species').update({common_name:newName,category:newGroup}).eq('id',sp.id);if(u.error)throw u.error}const ou=await sb.from('observations').update({subject_name:newName,updated_at:new Date().toISOString()}).eq('subject_name',oldName);if(ou.error)throw ou.error;setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'renameSpecies',oldName,newName,newGroup});setSyncStatus('error','Sync issue');return false}}
async function cloudRenameIndividual(speciesName,oldName,newName,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'renameIndividual',speciesName,oldName,newName});return false}try{setSyncStatus('syncing','Saving…');const sres=await sb.from('species').select('id').ilike('common_name',speciesName).limit(1);if(sres.error)throw sres.error;const sid=sres.data?.[0]?.id;if(sid){const u=await sb.from('individual_plants').update({name:newName}).eq('species_id',sid).eq('name',oldName);if(u.error)throw u.error}setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'renameIndividual',speciesName,oldName,newName});setSyncStatus('error','Sync issue');return false}}
async function signedPhotoUrl(path){if(!path)return'';const {data,error}=await sb.storage.from('observation-photos').createSignedUrl(path,60*60*24*7);return error?'':(data?.signedUrl||'')}
async function loadCloudObservations(){if(!currentUser)return 0;setSyncStatus('syncing','Loading…');const {data,error}=await sb.from('observations').select('*, property_zones(name), species(category), individual_plants(name), observation_photos(storage_path)').order('observation_date',{ascending:false});if(error)throw error;const rows=data||[];const mapped=[];for(const r of rows){const photoPath=r.observation_photos?.[0]?.storage_path||'';const photo=photoPath?await signedPhotoUrl(photoPath):'';mapped.push({id:r.id,kind:r.observation_type,name:r.subject_name,group:r.species?.category||(r.observation_type==='Seasonal/Event'?'Seasonal':r.observation_type==='Plant'?inferPlantGroup(r.subject_name):guessWildlifeGroup(r.subject_name)),date:r.observation_date,time:r.observation_type==='Seasonal/Event'?(r.start_time||''):(r.observation_time||''),eventEndTime:r.end_time||'',zone:r.property_zones?.name||(r.observation_type==='Seasonal/Event'?EVENT_ZONE:'House & Yard'),locationNote:r.location_note||'',detail:r.activity_or_stage||'',count:r.quantity||1,measurement:r.measurement??'',measurementUnit:r.measurement_unit||'',notes:r.notes||'',isMilestone:!!r.is_milestone,milestoneType:r.milestone_type||'',photo,individualPlant:r.individual_plants?.name||'',_speciesId:r.species_id,_individualPlantId:r.individual_plant_id,_photoPath:photoPath})}if(rows.length||startupLocalUser===currentUser.id){observations=mapped;save();localStorage.setItem('hs_cloud_user_id',currentUser.id);$('#cloudImportBanner')?.classList.add('hidden')}setSyncStatus('synced','Synced');renderAll();return rows.length}
async function flushPendingOps(){if(!currentUser||!navigator.onLine||!pendingOps.length)return;const ops=[...pendingOps];for(const op of ops){let ok=false;if(op.type==='upsert')ok=await cloudUpsertObservation(op.record,{queueOnFail:false});else if(op.type==='delete')ok=await cloudDeleteObservation(op.id,{queueOnFail:false});else if(op.type==='renameSpecies')ok=await cloudRenameSpecies(op.oldName,op.newName,op.newGroup,{queueOnFail:false});else if(op.type==='renameIndividual')ok=await cloudRenameIndividual(op.speciesName,op.oldName,op.newName,{queueOnFail:false});if(ok){pendingOps=pendingOps.filter(x=>x!==op);cachePending()}}}
async function importLocalToCloud(){const btn=$('#importLocalData');if(btn){btn.disabled=true;btn.textContent='Importing…'}const source=[...(startupLocalObservations||observations)];let done=0;for(const original of source){const rec={...original,id:isUuid(original.id)?original.id:newUuid()};const ok=await cloudUpsertObservation(rec,{queueOnFail:true});if(ok)done++}await loadCloudObservations();localStorage.setItem('hs_cloud_user_id',currentUser.id);$('#cloudImportBanner')?.classList.add('hidden');toast(`${done} observation${done===1?'':'s'} imported to cloud`);if(btn){btn.disabled=false;btn.textContent='Import to Cloud'}}
async function handleSignedIn(user){currentUser=user;$('#authGate').classList.add('hidden');$('#app').classList.remove('hidden');$('#accountEmail').textContent=user.email||'';setSyncStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'Loading…':'Offline');try{await loadZoneRows();await flushPendingOps();const count=await loadCloudObservations();cloudReady=true;if(count===0){const local=JSON.parse(localStorage.getItem('hs_observations')||'null');if(local?.length&&startupLocalUser!==user.id){startupLocalObservations=local;$('#cloudImportText').textContent=`This device has ${local.length} observation${local.length===1?'':'s'} that can be copied into your cloud journal.`;$('#cloudImportBanner').classList.remove('hidden')}else{localStorage.setItem('hs_cloud_user_id',user.id)}}}catch(err){console.error('Cloud load failed',err);setSyncStatus('error','Sync issue');toast('Could not load cloud data. Local records are still available.')}}
async function initAuth(){const {data}=await sb.auth.getSession();if(data.session?.user)await handleSignedIn(data.session.user);else{$('#authGate').classList.remove('hidden');$('#app').classList.add('hidden')}}
async function refreshFromCloud(){if(!currentUser||syncing||!navigator.onLine)return;try{await loadZoneRows();await flushPendingOps();await loadCloudObservations()}catch(err){console.error(err);setSyncStatus('error','Sync issue')}}
const seed=[
 {id:1,kind:"Wildlife",name:"Northern Cardinal",group:"Bird",date:"2026-09-11",time:"08:12",zone:"House & Yard",locationNote:"Back porch / woods edge",detail:"Feeding",count:2,notes:"Pair near the back porch and woods edge.",photo:""},
 {id:2,kind:"Plant",name:"Oakleaf Hydrangea",group:"Shrub",date:"2026-09-10",time:"17:30",zone:"House & Yard",locationNote:"",detail:"Fall Color",count:1,notes:"First noticeable burgundy color on the outer leaves.",photo:""},
 {id:3,kind:"Wildlife",name:"White-tailed Deer",group:"Mammal",date:"2026-09-09",time:"19:12",zone:"Side Yard",locationNote:"Near the tree line",detail:"Grazing",count:3,notes:"Three deer moved from the woods toward the open grass.",photo:""},
 {id:4,kind:"Plant",name:"Eastern Redbud",group:"Tree",date:"2026-04-02",time:"09:03",zone:"House & Yard",locationNote:"",detail:"Full Bloom",count:1,notes:"Full bloom after several warm days.",photo:""},
 {id:5,kind:"Seasonal/Event",name:"Fireflies",group:"Seasonal",date:"2026-05-28",time:"20:48",zone:"Upper Meadow",locationNote:"",detail:"First Seen",count:1,notes:"First strong evening display of the year.",photo:""}
];
let observations=JSON.parse(localStorage.getItem('hs_observations')||'null')||seed;
// Migrate any v0.1 records to the finalized property zones without deleting the user's data.
observations=observations.map(o=>({...o,zone:LEGACY_ZONE_MAP[o.zone]||o.zone,locationNote:o.locationNote||"",isMilestone:!!o.isMilestone,milestoneType:o.milestoneType||"",measurement:o.measurement??"",measurementUnit:o.measurementUnit||"",eventEndTime:o.eventEndTime||"",group:o.group||(o.kind==='Plant'?inferPlantGroup(o.name):o.kind==='Wildlife'?guessWildlifeGroup(o.name):'Seasonal'),individualPlant:o.individualPlant||""}));
startupLocalObservations=JSON.parse(JSON.stringify(observations));
let currentJournalFilter='All',currentLifeFilter='All',selectedZone=null,editingId=null,currentSeasonTab='calendar';
let photoData='';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function save(){localStorage.setItem('hs_observations',JSON.stringify(observations))}
function fmtDate(d){return new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
function icon(o){
 if(o.kind==='Plant')return '🌿';
 if(o.kind==='Seasonal/Event'){
   const t=(o.detail||o.name||'').toLowerCase();
   if(/snow/.test(t))return '❄️'; if(/rain/.test(t))return '🌧️'; if(/ice|freeze|frost|frozen/.test(t))return '🧊';
   if(/thunder|storm/.test(t))return '⛈️'; if(/wind/.test(t))return '💨'; if(/warm|temperature|heat/.test(t))return '🌡️'; if(/pond/.test(t))return '💧';
   return '☀️';
 }
 if(o.group==='Bird')return '🐦'; if(o.group==='Mammal')return '🦌'; return '🦋'
}
function measurementText(o){return o.measurement!==''&&o.measurement!=null?`${o.measurement}${o.measurementUnit?` ${o.measurementUnit}`:''}`:''}
function locationText(o){return `${o.zone}${o.locationNote?' • '+o.locationNote:''}`}
function renderEntry(o){
 const measure=measurementText(o);
 const timePart=o.time?` • ${o.time}${o.eventEndTime?`–${o.eventEndTime}`:''}`:'';
 return `<article class="entry"><div class="thumb">${o.photo?`<img src="${o.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:13px">`:icon(o)}</div><div class="body"><div class="title">${escapeHtml(o.name)} <span class="badge">${escapeHtml(o.kind)}</span>${o.isMilestone?'<span class="milestone-badge">Milestone</span>':''}</div><div class="meta">${fmtDate(o.date)}${timePart} • ${escapeHtml(locationText(o))}${o.count>1&&o.kind!=='Seasonal/Event'?' • '+o.count:''}${measure?' • '+escapeHtml(measure):''}</div><div class="note">${escapeHtml(o.detail)}${o.notes?' — '+escapeHtml(o.notes):''}</div><div class="entry-actions"><button class="entry-action edit" data-edit="${o.id}">Edit</button><button class="entry-action delete" data-delete="${o.id}">Delete</button></div></div></article>`
}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function renderLifeHistoryEntry(o){
 const measure=measurementText(o);
 const timePart=o.time?` • ${o.time}${o.eventEndTime?`–${o.eventEndTime}`:''}`:'';
 const locationDetail=o.locationNote?`<div class="life-detail-line"><strong>Location:</strong> ${escapeHtml(o.locationNote)}</div>`:'';
 const notesDetail=o.notes?`<div class="life-detail-line life-notes"><strong>Notes:</strong> ${escapeHtml(o.notes)}</div>`:'';
 const activityDetail=o.detail?`<div class="life-detail-line"><strong>${o.kind==='Plant'?'Stage':'Activity'}:</strong> ${escapeHtml(o.detail)}</div>`:'';
 const individual=o.individualPlant?`<div class="life-detail-line"><strong>Individual:</strong> ${escapeHtml(o.individualPlant)}</div>`:'';
 return `<article class="entry life-history-entry"><div class="thumb">${o.photo?`<img src="${o.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:13px">`:icon(o)}</div><div class="body"><div class="title">${fmtDate(o.date)}${o.isMilestone?' <span class="milestone-badge">Milestone</span>':''}</div><div class="meta">${o.time?escapeHtml(o.time):''}${o.time?' • ':''}${escapeHtml(o.zone)}${o.count>1&&o.kind!=='Seasonal/Event'?' • '+o.count:''}${measure?' • '+escapeHtml(measure):''}</div>${individual}${locationDetail}${activityDetail}${notesDetail}<div class="entry-actions"><button class="entry-action edit" data-edit="${o.id}">Edit</button><button class="entry-action delete" data-delete="${o.id}">Delete</button></div></div></article>`
}
function renderToday(){
 const sorted=[...observations].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 $('#recentList').innerHTML=sorted.slice(0,4).map(renderEntry).join('')||'<div class="empty">No observations yet.</div>';
 const now=new Date(), targetMonth=now.getMonth(), targetDay=now.getDate();
 const prior=sorted.filter(o=>{const d=new Date(o.date+'T12:00:00'); if(d.getFullYear()>=now.getFullYear())return false; const dayOfYear=Math.floor((d-new Date(d.getFullYear(),0,0))/86400000); const target=new Date(d.getFullYear(),targetMonth,targetDay); const targetDOY=Math.floor((target-new Date(d.getFullYear(),0,0))/86400000); return Math.abs(dayOfYear-targetDOY)<=14}).slice(0,4);
 $('#lastYearCard').innerHTML=prior.map(o=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><strong>${escapeHtml(o.name)}</strong>${o.isMilestone?'<span class="milestone-badge">Milestone</span>':''}<div class="meta">${fmtDate(o.date)} • ${escapeHtml(o.milestoneType||o.detail)} • ${escapeHtml(o.zone)}</div></div>`).join('')||'<div class="empty">This section gets better after your first full year of records.</div>'
}
function renderJournal(){const q=$('#journalSearch').value.toLowerCase();let list=[...observations].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));if(currentJournalFilter!=='All')list=list.filter(o=>o.kind===currentJournalFilter);if(q)list=list.filter(o=>[o.name,o.zone,o.locationNote,o.detail,o.milestoneType,o.notes].join(' ').toLowerCase().includes(q));$('#journalList').innerHTML=list.map(renderEntry).join('')||'<div class="empty">No matching observations.</div>'}
function renderLife(){
 const q=$('#lifeSearch').value.toLowerCase().trim();
 const map={};
 observations.filter(o=>o.kind!=='Seasonal/Event').forEach(o=>{
   const key=o.name.trim().toLowerCase();
   if(!map[key])map[key]={name:o.name,kind:o.kind,group:o.group||inferGroup(o),count:0,last:o.date,first:o.date,zones:new Set,photos:0,individuals:new Set};
   const x=map[key];x.count++;x.zones.add(o.zone);if(o.photo)x.photos++;if(o.individualPlant)x.individuals.add(o.individualPlant);
   if(o.date>x.last)x.last=o.date;if(o.date<x.first)x.first=o.date;
 });
 let list=Object.values(map);
 if(currentLifeFilter!=='All')list=list.filter(x=>x.group===currentLifeFilter);
 if(q)list=list.filter(x=>[x.name,x.group,...x.zones].join(' ').toLowerCase().includes(q));
 list.sort((a,b)=>a.name.localeCompare(b.name));
 $('#lifeSpeciesCount').textContent=list.length===Object.keys(map).length?Object.keys(map).length:Object.keys(map).length;
 $('#lifePhotoCount').textContent=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.photo).length;
 $('#lifeIndividualCount').textContent=new Set(observations.filter(o=>o.kind==='Plant'&&o.individualPlant).map(o=>o.individualPlant.trim().toLowerCase())).size;
 $('#lifeList').innerHTML=list.map(x=>`<button class="life-card" data-life-profile="${escapeHtml(x.name)}"><div class="life-card-thumb">${lifeIcon(x.group,x.kind)}</div><div class="life-card-body"><div class="title">${escapeHtml(x.name)}</div><div class="meta">${escapeHtml(x.group)} • ${x.count} observation${x.count===1?'':'s'} • ${x.zones.size} zone${x.zones.size===1?'':'s'}</div><div class="life-card-note">First ${fmtDate(x.first)} • Last ${fmtDate(x.last)}${x.photos?` • ${x.photos} photo${x.photos===1?'':'s'}`:''}${x.individuals.size?` • ${x.individuals.size} individual plant${x.individuals.size===1?'':'s'}`:''}</div></div><span class="chevron">›</span></button>`).join('')||'<div class="empty">No matching life records.</div>';
 $$('[data-life-profile]').forEach(b=>b.onclick=()=>openLifeProfile(b.dataset.lifeProfile));
}
function lifeIcon(group,kind){if(group==='Bird')return'🐦';if(group==='Mammal')return'🦌';if(group==='Other Wildlife')return'🦋';if(group==='Tree')return'🌳';if(group==='Shrub')return'🌿';if(group==='Flower')return'🌸';if(group==='Wildflower')return'🌼';return kind==='Plant'?'🌱':'🦋'}
function openLifeProfile(name){
 const items=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===name.toLowerCase()).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 if(!items.length)return;
 const first=[...items].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0], last=items[0];
 const zones=[...new Set(items.map(o=>o.zone))];
 const photos=items.filter(o=>o.photo);
 const milestones=items.filter(o=>o.isMilestone).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 const individuals={};items.filter(o=>o.kind==='Plant'&&o.individualPlant).forEach(o=>{const k=o.individualPlant.trim();if(!individuals[k])individuals[k]={name:k,count:0,first:o.date,last:o.date,zones:new Set};const x=individuals[k];x.count++;x.zones.add(o.zone);if(o.date<x.first)x.first=o.date;if(o.date>x.last)x.last=o.date});
 $('#lifeProfileEyebrow').textContent=`${first.group||inferGroup(first)} • ${first.kind}`;
 $('#lifeProfileTitle').textContent=first.name;
 $('#lifeProfileContent').innerHTML=`
   <div class="profile-actions"><button class="primary small" data-add-for-species="${escapeHtml(first.name)}">+ Add Observation</button><button class="secondary small" data-edit-profile="${escapeHtml(first.name)}">Edit Profile</button></div>
   <div class="profile-stats">
     <div><strong>${items.length}</strong><span>observations</span></div><div><strong>${zones.length}</strong><span>zones</span></div><div><strong>${milestones.length}</strong><span>milestones</span></div>
   </div>
   <div class="profile-dates card"><div><span>First recorded</span><strong>${fmtDate(first.date)}</strong></div><div><span>Last recorded</span><strong>${fmtDate(last.date)}</strong></div></div>
   <section class="profile-section"><div class="section-head"><h3>Where you've seen it</h3></div><div class="profile-chips">${zones.map(z=>`<span>${escapeHtml(z)}</span>`).join('')}</div></section>
   ${Object.keys(individuals).length?`<section class="profile-section"><div class="section-head"><h3>Individual plants</h3><span class="muted">tracked separately</span></div><div class="stack">${Object.values(individuals).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<div class="individual-card"><div><strong>${escapeHtml(x.name)}</strong><div class="meta">${x.count} observation${x.count===1?'':'s'} • ${[...x.zones].map(escapeHtml).join(', ')}</div></div><div class="individual-tools"><div class="individual-dates">${fmtDate(x.first)} → ${fmtDate(x.last)}</div><button class="entry-action edit" data-edit-individual="${escapeHtml(x.name)}" data-species="${escapeHtml(first.name)}">Edit name</button></div></div>`).join('')}</div></section>`:''}
   ${milestones.length?`<section class="profile-section"><div class="section-head"><h3>Seasonal milestones</h3></div><div class="stack">${milestones.map(o=>`<div class="profile-milestone"><strong>${escapeHtml(o.milestoneType||o.detail)}</strong><div class="meta">${fmtDate(o.date)} • ${escapeHtml(locationText(o))}</div></div>`).join('')}</div></section>`:''}
   ${photos.length?`<section class="profile-section"><div class="section-head"><h3>Photos</h3><span class="muted">${photos.length}</span></div><div class="photo-grid">${photos.slice(0,12).map(o=>`<button class="photo-tile" data-edit="${o.id}" title="Edit observation from ${fmtDate(o.date)}"><img src="${o.photo}" alt="${escapeHtml(o.name)} photographed ${fmtDate(o.date)}"><span>${fmtDate(o.date)}</span></button>`).join('')}</div></section>`:''}
   <section class="profile-section"><div class="section-head"><h3>Observation history</h3><span class="muted">newest first • full notes shown</span></div><div class="stack">${items.map(renderLifeHistoryEntry).join('')}</div></section>`;
 $('#lifeBackdrop').classList.remove('hidden');
}

function addObservationForSpecies(name){
 const sample=observations.find(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===name.toLowerCase());
 if(!sample)return;
 closeLifeProfile();
 openModal();
 setKind(sample.kind);
 $('#name').value=sample.name;
 $('#group').value=sample.group||inferGroup(sample);
 $('#date').value=new Date().toISOString().slice(0,10);
 $('#time').value=new Date().toTimeString().slice(0,5);
 $('#name').focus();
}
async function editLifeProfile(name){
 const items=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===name.toLowerCase());
 if(!items.length)return;
 const oldName=items[0].name;
 const oldGroup=items[0].group||inferGroup(items[0]);
 const newName=prompt('Species or plant name:',oldName);
 if(newName===null)return;
 const trimmed=newName.trim();
 if(!trimmed){alert('The name cannot be blank.');return;}
 const newGroup=prompt('Category (for example Bird, Mammal, Tree, Shrub, Flower, Wildflower, Other Wildlife):',oldGroup);
 if(newGroup===null)return;
 items.forEach(o=>{o.name=trimmed;o.group=newGroup.trim()||oldGroup});
 save();renderAll();closeLifeProfile();openLifeProfile(trimmed);await cloudRenameSpecies(oldName,trimmed,newGroup.trim()||oldGroup);toast('Life profile updated');
}
async function editIndividualPlant(species,individual){
 const newName=prompt('Individual plant name:',individual);
 if(newName===null)return;
 const trimmed=newName.trim();
 if(!trimmed){alert('The individual plant name cannot be blank.');return;}
 observations.forEach(o=>{if(o.kind==='Plant'&&o.name.toLowerCase()===species.toLowerCase()&&o.individualPlant===individual)o.individualPlant=trimmed});
 save();renderAll();closeLifeProfile();openLifeProfile(species);await cloudRenameIndividual(species,individual,trimmed);toast('Individual plant renamed');
}
function closeLifeProfile(){$('#lifeBackdrop').classList.add('hidden')}
function inferGroup(o){if(o.kind==='Plant'){if(/hydrangea|azalea|boxwood/i.test(o.name))return'Shrub';if(/oak|redbud|maple|dogwood/i.test(o.name))return'Tree';return'Flower'}return o.kind==='Wildlife'?'Bird':'Seasonal'}
function milestoneRecords(){
 const explicit=observations.filter(o=>o.isMilestone).map(o=>({...o,displayMilestone:o.milestoneType||o.detail,derived:false}));
 // Every species/plant gets an automatic first-record-of-year marker, unless an explicit first milestone already covers that date/year.
 const groups={};
 observations.forEach(o=>{const y=o.date.slice(0,4),k=`${y}|||${o.name.toLowerCase()}`;if(!groups[k]||o.date<groups[k].date||(o.date===groups[k].date&&(o.time||'')<(groups[k].time||'')))groups[k]=o});
 const derived=Object.values(groups).filter(o=>!explicit.some(e=>e.name.toLowerCase()===o.name.toLowerCase()&&e.date.slice(0,4)===o.date.slice(0,4)&&/first|arrival|arriv|emerg/i.test((e.displayMilestone||'').toLowerCase()))).map(o=>({...o,displayMilestone:'First record of year',derived:true}));
 return [...explicit,...derived].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
}
function renderSeasons(){
 const ms=milestoneRecords(), species=[...new Set(observations.map(o=>o.name))].sort((a,b)=>a.localeCompare(b)), years=[...new Set(observations.map(o=>o.date.slice(0,4)))].sort();
 $('#seasonCount').textContent=ms.filter(x=>!x.derived).length;
 $('#speciesCount').textContent=species.length;
 $('#seasonYearCount').textContent=years.length;
 renderSeasonCalendar(ms);
 renderSeasonSpecies(ms,species);
 renderSeasonYears(ms,years);
}
function renderSeasonCalendar(ms){
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 $('#seasonCalendar').innerHTML=months.map((m,i)=>{const items=ms.filter(o=>new Date(o.date+'T12:00:00').getMonth()===i).sort((a,b)=>a.date.localeCompare(b.date));return `<div class="month-card ${items.length?'':'empty-month'}"><h4>${m}</h4>${items.length?items.slice(0,6).map(o=>`<div class="milestone-row"><div class="milestone-name">${escapeHtml(o.name)}${o.derived?'<span class="first-record">First record</span>':'<span class="milestone-badge">Milestone</span>'}</div><div class="milestone-meta">${fmtDate(o.date)} • ${escapeHtml(o.displayMilestone)} • ${escapeHtml(o.zone)}${measurementText(o)?` • ${escapeHtml(measurementText(o))}`:""}</div></div>`).join(''):'<div class="muted">Nothing recorded yet.</div>'}${items.length>6?`<div class="milestone-meta">+ ${items.length-6} more</div>`:''}</div>`}).join('');
}
function renderSeasonSpecies(ms,species){
 const sel=$('#seasonSpeciesSelect'); const previous=sel.value;
 sel.innerHTML=species.length?species.map(n=>`<option>${escapeHtml(n)}</option>`).join(''):'<option>No records yet</option>';
 if(previous&&species.includes(previous))sel.value=previous;
 const chosen=sel.value; if(!chosen||!species.length){$('#seasonSpeciesHistory').innerHTML='<div class="empty">Add observations to build a seasonal history.</div>';return}
 const records=ms.filter(o=>o.name===chosen); const byYear={};records.forEach(o=>(byYear[o.date.slice(0,4)]??=[]).push(o));
 $('#seasonSpeciesHistory').innerHTML=Object.entries(byYear).sort((a,b)=>b[0].localeCompare(a[0])).map(([year,items])=>`<div class="card history-card"><div class="history-year">${year}</div>${items.map(o=>`<div class="history-line">${fmtDate(o.date)} — <strong>${escapeHtml(o.displayMilestone)}</strong>${o.derived?' <span class="first-record">automatic</span>':''}${o.locationNote?`<div class="milestone-meta">${escapeHtml(o.zone)} • ${escapeHtml(o.locationNote)}</div>`:`<div class="milestone-meta">${escapeHtml(o.zone)}</div>`}</div>`).join('')}</div>`).join('')||'<div class="empty">No seasonal history yet.</div>';
}
function renderSeasonYears(ms,years){
 $('#seasonYearCompare').innerHTML=years.slice().sort((a,b)=>b.localeCompare(a)).map(year=>{
   const obs=observations.filter(o=>o.date.startsWith(year));
   const items=ms.filter(o=>o.date.startsWith(year));
   const explicit=items.filter(o=>!o.derived);
   const snow=obs.filter(o=>o.kind==='Seasonal/Event'&&/snow/i.test(`${o.name} ${o.detail}`));
   const snowMeasured=snow.filter(o=>o.measurement!==''&&o.measurement!=null&&o.measurementUnit==='inches');
   const snowTotal=snowMeasured.reduce((n,o)=>n+Number(o.measurement||0),0);
   const weather=obs.filter(o=>o.kind==='Seasonal/Event');
   return `<div class="card year-card"><div class="year-head"><div class="year-number">${year}</div><div class="year-stat">${obs.length} observations • ${explicit.length} milestones</div></div>
     ${weather.length?`<div class="weather-year-summary"><strong>Weather & seasonal events</strong><div>${weather.length} event${weather.length===1?'':'s'}${snow.length?` • ${snow.length} snowfall${snow.length===1?'':'s'}`:''}${snowMeasured.length?` • ${snowTotal.toFixed(1).replace(/\.0$/,'')} in recorded snow`:''}</div></div>`:''}
     <div class="year-milestones">${explicit.length?explicit.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8).map(o=>`<div class="milestone-row"><div class="milestone-name">${escapeHtml(o.name)}</div><div class="milestone-meta">${fmtDate(o.date)} • ${escapeHtml(o.displayMilestone)}${measurementText(o)?` • ${escapeHtml(measurementText(o))}`:''}</div></div>`).join(''):'<div class="muted">No marked milestones yet. First records are still tracked automatically.</div>'}${explicit.length>8?`<div class="milestone-meta">+ ${explicit.length-8} more milestones</div>`:''}</div><button class="secondary small year-review-btn" data-year-review="${year}">Open Year in Review</button></div>`
 }).join('')||'<div class="empty">Your year-to-year comparison will grow as you add records.</div>';
}
function openYearReview(year){
 const obs=observations.filter(o=>o.date.startsWith(year)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 if(!obs.length)return;
 const life=obs.filter(o=>o.kind!=='Seasonal/Event');
 const uniqueLife=new Set(life.map(o=>o.name.trim().toLowerCase())).size;
 const wildlife=obs.filter(o=>o.kind==='Wildlife').length, plants=obs.filter(o=>o.kind==='Plant').length, events=obs.filter(o=>o.kind==='Seasonal/Event').length;
 const photos=obs.filter(o=>o.photo);
 const explicit=milestoneRecords().filter(o=>o.date.startsWith(year)&&!o.derived);
 const zones={};obs.forEach(o=>{if(o.zone!==EVENT_ZONE)zones[o.zone]=(zones[o.zone]||0)+1});
 const topZone=Object.entries(zones).sort((a,b)=>b[1]-a[1])[0];
 const counts=Array(12).fill(0);obs.forEach(o=>counts[new Date(o.date+'T12:00:00').getMonth()]++);
 const maxMonth=Math.max(1,...counts);
 const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const snow=obs.filter(o=>o.kind==='Seasonal/Event'&&/snow/i.test(`${o.name} ${o.detail}`));
 const snowMeasured=snow.filter(o=>o.measurement!==''&&o.measurement!=null&&o.measurementUnit==='inches');
 const snowTotal=snowMeasured.reduce((n,o)=>n+Number(o.measurement||0),0);
 const first=obs[0],last=obs[obs.length-1];
 const milestones=explicit.slice().sort((a,b)=>a.date.localeCompare(b.date));
 $('#yearReviewTitle').textContent=`${year} Year in Review`;
 $('#yearReviewContent').innerHTML=`
   <div class="review-hero"><h3>${year} on the Homestead</h3><p>${obs.length} recorded moment${obs.length===1?'':'s'} from ${fmtDate(first.date)} through ${fmtDate(last.date)}.</p></div>
   <div class="review-stats"><div class="review-stat"><strong>${obs.length}</strong><span>observations</span></div><div class="review-stat"><strong>${uniqueLife}</strong><span>species / plants</span></div><div class="review-stat"><strong>${explicit.length}</strong><span>milestones</span></div><div class="review-stat"><strong>${photos.length}</strong><span>photos</span></div></div>
   <section class="review-section"><h3>What you recorded</h3><div class="review-breakdown"><div><strong>${wildlife}</strong><span>wildlife</span></div><div><strong>${plants}</strong><span>plants</span></div><div><strong>${events}</strong><span>weather / events</span></div></div></section>
   ${topZone?`<section class="review-section"><h3>Most active zone</h3><div class="review-list-item"><strong>${escapeHtml(topZone[0])}</strong><span>${topZone[1]} observation${topZone[1]===1?'':'s'} recorded there</span></div></section>`:''}
   ${snow.length?`<section class="review-section"><h3>Winter weather</h3><div class="review-list-item"><strong>${snow.length} snowfall${snow.length===1?'':'s'}</strong><span>${snowMeasured.length?`${snowTotal.toFixed(1).replace(/\.0$/,'')} inches of recorded snow`: 'No snowfall amounts entered yet'}</span></div></section>`:''}
   <section class="review-section"><h3>Activity through the year</h3><div class="month-bars">${counts.map((n,i)=>`<div class="month-bar-row"><span>${monthNames[i]}</span><div class="month-bar-track"><div class="month-bar-fill" style="width:${Math.round(n/maxMonth*100)}%"></div></div><strong>${n}</strong></div>`).join('')}</div></section>
   <section class="review-section"><h3>Seasonal milestones</h3><div class="review-list">${milestones.length?milestones.map(o=>`<div class="review-list-item"><strong>${escapeHtml(o.name)} — ${escapeHtml(o.displayMilestone)}</strong><span>${fmtDate(o.date)} • ${escapeHtml(o.zone)}${measurementText(o)?` • ${escapeHtml(measurementText(o))}`:''}</span></div>`).join(''):'<div class="empty">No marked milestones this year yet.</div>'}</div></section>
   ${photos.length?`<section class="review-section"><h3>Photo memories</h3><div class="review-photo-grid">${photos.slice(0,12).map(o=>`<img src="${o.photo}" alt="${escapeHtml(o.name)} — ${fmtDate(o.date)}" title="${escapeHtml(o.name)} — ${fmtDate(o.date)}">`).join('')}</div>${photos.length>12?`<div class="milestone-meta" style="margin-top:7px">+ ${photos.length-12} more photos in the Journal</div>`:''}</section>`:''}`;
 $('#yearReviewBackdrop').classList.remove('hidden');
}
function closeYearReview(){$('#yearReviewBackdrop').classList.add('hidden')}
function renderZones(){const counts=Object.fromEntries(ZONES.map(z=>[z,0]));observations.forEach(o=>{if(counts[o.zone]!==undefined)counts[o.zone]++});$('#zoneList').innerHTML=ZONES.map(z=>`<button class="zone-card ${selectedZone===z?'selected':''}" data-zone-card="${escapeHtml(z)}"><div class="zone-card-icon">📍</div><div class="zone-card-body"><div class="title">${escapeHtml(z)}</div><div class="zone-description">${escapeHtml(ZONE_INFO[z])}</div><div class="meta">${counts[z]||0} observation${counts[z]===1?'':'s'}</div></div><span class="chevron">›</span></button>`).join('');$$('[data-zone-card]').forEach(b=>b.onclick=()=>showZone(b.dataset.zoneCard));if(selectedZone)renderZoneDetail()}
function showZone(z){selectedZone=z;renderZones();renderZoneDetail();$('#zoneDetail').classList.remove('hidden');$('#zoneDetail').scrollIntoView({behavior:'smooth',block:'start'})}
function renderZoneDetail(){if(!selectedZone)return;$('#zoneDetailTitle').textContent=selectedZone;const list=[...observations].filter(o=>o.zone===selectedZone).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));$('#zoneDetailList').innerHTML=list.map(renderEntry).join('')||'<div class="empty">No observations recorded in this zone yet.</div>'}
function renderAll(){renderToday();renderJournal();renderLife();renderSeasons();renderZones()}
function showView(name){$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.nav===name));window.scrollTo({top:0,behavior:'smooth'})}
$$('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));$$('[data-go]').forEach(b=>b.onclick=()=>showView(b.dataset.go));$$('[data-action="add"],#addTop').forEach(b=>b.onclick=()=>openModal());
function resetForm(){
 const f=$('#obsForm');f.reset();photoData='';$('#photoPreview').src='';$('#photoPreview').classList.add('hidden');$('#kind').value='Wildlife';$('#isMilestone').checked=false;$('#milestoneTypeWrap').classList.add('hidden');$$('.seg').forEach((x,i)=>x.classList.toggle('active',i===0));updateDetailOptions();updateKindFields();updateMilestoneOptions();
}
function populateZoneOptions(selected=''){
 const kind=$('#kind').value; const options=kind==='Seasonal/Event'?[EVENT_ZONE,...ZONES]:ZONES;
 $('#zone').innerHTML=options.map(z=>`<option>${escapeHtml(z)}</option>`).join('');
 if(selected&&options.includes(selected))$('#zone').value=selected;
}
function updateKindFields(){
 const kind=$('#kind').value, isEvent=kind==='Seasonal/Event', isPlant=kind==='Plant';
 $('#measurementWrap').classList.toggle('hidden',!isEvent);
 $('#eventEndTimeWrap').classList.toggle('hidden',!isEvent);
 $('#countWrap').classList.toggle('hidden',isEvent);
 $('#groupWrap').classList.toggle('hidden',isEvent);
 $('#individualPlantWrap').classList.toggle('hidden',!isPlant);
 $('#nameLabel').childNodes[0].nodeValue=isPlant?'Plant / species':kind==='Wildlife'?'Name / species':'Event name';
 $('#name').placeholder=isPlant?'e.g. Eastern Redbud':kind==='Wildlife'?'e.g. Northern Cardinal':'e.g. Snowfall';
 $('#timeLabel').childNodes[0].nodeValue=isEvent?'Start time':'Time';
 updateGroupOptions();
 populateZoneOptions($('#zone').value);
}
function updateGroupOptions(){
 const kind=$('#kind').value;let opts=[];
 if(kind==='Wildlife')opts=['Bird','Mammal','Other Wildlife'];
 else if(kind==='Plant')opts=['Tree','Shrub','Flower','Wildflower','Other Plant'];
 else opts=['Seasonal'];
 const current=$('#group').value;$('#group').innerHTML=opts.map(x=>`<option>${x}</option>`).join('');if(opts.includes(current))$('#group').value=current;
}
function openModal(obs=null){
 resetForm();const now=new Date();editingId=obs?obs.id:null;$('#modalEyebrow').textContent=obs?'Update record':'New record';$('#modalTitle').textContent=obs?'Edit Observation':'Add Observation';$('#saveObsBtn').textContent=obs?'Save Changes':'Save Observation';
 if(obs){
   $('#kind').value=obs.kind;$$('.seg').forEach(x=>x.classList.toggle('active',x.dataset.kind===obs.kind));updateDetailOptions();updateKindFields();
   $('#name').value=obs.name;$('#group').value=obs.group||inferGroup(obs);$('#individualPlant').value=obs.individualPlant||'';$('#date').value=obs.date;$('#time').value=obs.time||'';populateZoneOptions(obs.zone);$('#locationNote').value=obs.locationNote||'';$('#detail').value=obs.detail||'';$('#count').value=obs.count||1;$('#notes').value=obs.notes||'';
   $('#measurement').value=obs.measurement??'';$('#measurementUnit').value=obs.measurementUnit||'inches';$('#eventEndTime').value=obs.eventEndTime||'';
   $('#isMilestone').checked=!!obs.isMilestone;updateMilestoneOptions();$('#milestoneTypeWrap').classList.toggle('hidden',!obs.isMilestone);if(obs.isMilestone&&obs.milestoneType)$('#milestoneType').value=obs.milestoneType;photoData=obs.photo||'';if(photoData){$('#photoPreview').src=photoData;$('#photoPreview').classList.remove('hidden')}
 }else{$('#date').value=now.toISOString().slice(0,10);$('#time').value=now.toTimeString().slice(0,5)}
 $('#modalBackdrop').classList.remove('hidden')
}
function closeModal(){editingId=null;$('#modalBackdrop').classList.add('hidden')}
$('#closeModal').onclick=closeModal;$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
$('#closeLifeProfile').onclick=closeLifeProfile;$('#lifeBackdrop').addEventListener('click',e=>{if(e.target.id==='lifeBackdrop')closeLifeProfile()});
$('#closeYearReview').onclick=closeYearReview;$('#yearReviewBackdrop').addEventListener('click',e=>{if(e.target.id==='yearReviewBackdrop')closeYearReview()});$('#printYearReview').onclick=()=>window.print();
document.addEventListener('click',async e=>{const yearReview=e.target.closest('[data-year-review]');if(yearReview){openYearReview(yearReview.dataset.yearReview);return}const addSpecies=e.target.closest('[data-add-for-species]');if(addSpecies){addObservationForSpecies(addSpecies.dataset.addForSpecies);return}const editProfile=e.target.closest('[data-edit-profile]');if(editProfile){await editLifeProfile(editProfile.dataset.editProfile);return}const editIndividual=e.target.closest('[data-edit-individual]');if(editIndividual){await editIndividualPlant(editIndividual.dataset.species,editIndividual.dataset.editIndividual);return}const edit=e.target.closest('[data-edit]');if(edit){const obs=observations.find(o=>String(o.id)===String(edit.dataset.edit));if(obs)openModal(obs);return}const del=e.target.closest('[data-delete]');if(del){const obs=observations.find(o=>String(o.id)===String(del.dataset.delete));if(!obs)return;if(confirm(`Delete the observation of ${obs.name} from ${fmtDate(obs.date)}? This cannot be undone.`)){observations=observations.filter(o=>String(o.id)!==String(obs.id));save();renderAll();closeLifeProfile();await cloudDeleteObservation(obs.id);toast('Observation deleted')}return}});
$$('.seg').forEach(b=>b.onclick=()=>{$$('.seg').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#kind').value=b.dataset.kind;updateDetailOptions();updateKindFields()});
function updateDetailOptions(){
 const kind=$('#kind').value;let opts=[];
 if(kind==='Wildlife')opts=['Seen','Feeding','Grazing','Perched / Singing','Flying','Nesting','Tracks / Sign','First Seen','Young Seen','Migration / Arrival','Migration / Departure'];
 else if(kind==='Plant')opts=['Budding','First Bud','First Leaf','Leafing Out','First Bloom','Blooming','Full Bloom','Fading Blooms','Fruiting','Fall Color','Leaf Drop','Dormant'];
 else opts=['Snowfall','Rainfall','First Frost','Hard Freeze','Ice Storm','Thunderstorm','High Wind','Unusually Warm Day','Drought','Pond Frozen','Pond Thaw','Fireflies / Seasonal Activity','Other'];
 $('#detailLabel').childNodes[0].nodeValue=kind==='Plant'?'Stage':kind==='Wildlife'?'Activity':'Event type';
 const current=$('#detail').value;$('#detail').innerHTML=opts.map(x=>`<option>${x}</option>`).join('');if(opts.includes(current))$('#detail').value=current;
 updateMilestoneOptions();if(kind==='Seasonal/Event')updateEventDefaults();
}
function updateEventDefaults(){
 if($('#kind').value!=='Seasonal/Event')return; const d=$('#detail').value;
 if(!$('#name').value.trim()||['Snowfall','Rainfall','First Frost','Hard Freeze','Ice Storm','Thunderstorm','High Wind','Unusually Warm Day','Drought','Pond Frozen','Pond Thaw','Fireflies / Seasonal Activity','Other'].includes($('#name').value.trim()))$('#name').value=d==='Fireflies / Seasonal Activity'?'Fireflies':d;
 if(d==='Snowfall'||d==='Rainfall'||d==='Ice Storm')$('#measurementUnit').value='inches';
 else if(d==='First Frost'||d==='Hard Freeze'||d==='Unusually Warm Day')$('#measurementUnit').value='°F';
 else if(d==='High Wind'||d==='Thunderstorm')$('#measurementUnit').value='mph';
}
function updateMilestoneOptions(){const kind=$('#kind').value;let opts=[];if(kind==='Plant')opts=['First Bud','First Leaf','First Bloom','Full Bloom','Peak Bloom','Fruiting','First Fall Color','Peak Fall Color','Leaf Drop','Dormancy'];else if(kind==='Wildlife')opts=['First Seen / Arrival','Last Seen / Departure','Nesting','Eggs Seen','Young Seen','Migration Peak','Peak Activity'];else opts=['First Snow of Season','Largest Snowfall','First Frost','First Hard Freeze','First Ice Storm','First Thunderstorm','First Fireflies','Peak Fireflies','Pond Freeze','Pond Thaw','Weather Event','Other'];const current=$('#milestoneType').value;$('#milestoneType').innerHTML=opts.map(x=>`<option>${x}</option>`).join('');if(opts.includes(current))$('#milestoneType').value=current}
populateZoneOptions();
$('#photo').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const img=new Image(),r=new FileReader();r.onload=()=>{img.onload=()=>{const max=900,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);photoData=c.toDataURL('image/jpeg',.72);$('#photoPreview').src=photoData;$('#photoPreview').classList.remove('hidden')};img.src=r.result};r.readAsDataURL(f)});
$('#obsForm').addEventListener('submit',async e=>{
 e.preventDefault();const kind=$('#kind').value,name=$('#name').value.trim();if(!name)return;const group=kind==='Seasonal/Event'?'Seasonal':$('#group').value;
 const record={id:editingId||(currentUser?newUuid():Date.now()),kind,name,group:kind==='Seasonal/Event'?'Seasonal':$('#group').value,date:$('#date').value,time:$('#time').value,eventEndTime:kind==='Seasonal/Event'?$('#eventEndTime').value:'',zone:$('#zone').value,locationNote:$('#locationNote').value.trim(),detail:$('#detail').value,count:kind==='Seasonal/Event'?1:Number($('#count').value||1),measurement:kind==='Seasonal/Event'?$('#measurement').value:'',measurementUnit:kind==='Seasonal/Event'&&$('#measurement').value!==''?$('#measurementUnit').value:'',notes:$('#notes').value.trim(),isMilestone:$('#isMilestone').checked,milestoneType:$('#isMilestone').checked?$('#milestoneType').value:'',photo:photoData,individualPlant:kind==='Plant'?$('#individualPlant').value.trim():''};
 const wasEditing=!!editingId;if(editingId){const i=observations.findIndex(o=>String(o.id)===String(editingId));if(i>=0)observations[i]=record}else observations.push(record);save();resetForm();closeModal();renderAll();await cloudUpsertObservation(record);toast(wasEditing?'Observation updated':'Observation saved')
});
function guessWildlifeGroup(name){if(/deer|fox|rabbit|squirrel|raccoon|bear|opossum|groundhog|coyote|bobcat|skunk|mouse|vole|bat/i.test(name))return'Mammal';if(/cardinal|bluebird|robin|hawk|owl|turkey|crow|wren|sparrow|finch|warbler|woodpecker|hummingbird|goose|duck|heron|bird/i.test(name))return'Bird';return'Other Wildlife'}
function inferPlantGroup(name){if(/hydrangea|azalea|boxwood|holly|viburnum|rhododendron|shrub|bush/i.test(name))return'Shrub';if(/oak|redbud|maple|dogwood|pine|cedar|tree|magnolia|birch|hickory|walnut/i.test(name))return'Tree';if(/black-eyed susan|coneflower|goldenrod|trillium|ironweed|milkweed|wildflower/i.test(name))return'Wildflower';if(/flower|rose|tulip|daffodil|iris|peony|lily|aster/i.test(name))return'Flower';return'Other Plant'}
$('#detail').addEventListener('change',updateEventDefaults);
$('#isMilestone').addEventListener('change',()=>{$('#milestoneTypeWrap').classList.toggle('hidden',!$('#isMilestone').checked);updateMilestoneOptions()});
$('#seasonSpeciesSelect').addEventListener('change',()=>renderSeasonSpecies(milestoneRecords(),[...new Set(observations.map(o=>o.name))].sort((a,b)=>a.localeCompare(b))));
$$('#seasonTabs .season-tab').forEach(b=>b.onclick=()=>{currentSeasonTab=b.dataset.seasonTab;$$('#seasonTabs .season-tab').forEach(x=>x.classList.toggle('active',x===b));$$('.season-panel').forEach(p=>p.classList.toggle('active',p.dataset.seasonPanel===currentSeasonTab))});
$('#journalSearch').oninput=renderJournal;$('#lifeSearch').oninput=renderLife;$$('#journalFilters .chip').forEach(b=>b.onclick=()=>{$$('#journalFilters .chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');currentJournalFilter=b.dataset.filter;renderJournal()});$$('#lifeFilters .chip').forEach(b=>b.onclick=()=>{$$('#lifeFilters .chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');currentLifeFilter=b.dataset.life;renderLife()});
$$('.zone-dot').forEach(b=>b.onclick=()=>showZone(b.dataset.zone));
$('#clearZone').onclick=()=>{selectedZone=null;$('#zoneDetail').classList.add('hidden');renderZones()};
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),1800)}
const now=new Date();$('#todayDate').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});$('#greeting').textContent=now.getHours()<12?'Good morning':now.getHours()<18?'Good afternoon':'Good evening';save();renderAll();
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();$('#authError').classList.add('hidden');const email=$('#authEmail').value.trim(),password=$('#authPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error){$('#authError').textContent=error.message;$('#authError').classList.remove('hidden');return}if(data.user)await handleSignedIn(data.user)});
$('#syncChip').onclick=()=>$('#accountBackdrop').classList.remove('hidden');$('#closeAccount').onclick=()=>$('#accountBackdrop').classList.add('hidden');$('#accountBackdrop').addEventListener('click',e=>{if(e.target.id==='accountBackdrop')$('#accountBackdrop').classList.add('hidden')});$('#syncNow').onclick=async()=>{await refreshFromCloud();toast('Cloud sync complete')};$('#signOut').onclick=async()=>{await sb.auth.signOut();currentUser=null;$('#accountBackdrop').classList.add('hidden');$('#app').classList.add('hidden');$('#authGate').classList.remove('hidden');setSyncStatus('offline','Cloud')};$('#importLocalData').onclick=importLocalToCloud;$('#dismissImport').onclick=()=>$('#cloudImportBanner').classList.add('hidden');
window.addEventListener('online',()=>{setSyncStatus('syncing','Reconnecting…');refreshFromCloud()});window.addEventListener('offline',()=>setSyncStatus('offline','Offline'));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshFromCloud()});
initAuth();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(reg => reg.update()).catch(() => {});
  });
}
