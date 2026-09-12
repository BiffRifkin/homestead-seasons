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
let sb=null;
let supabaseLoadPromise=null;
function showAuthError(message){
  const el=document.querySelector('#authError');
  if(!el)return;
  el.textContent=message;
  el.classList.remove('hidden');
}
function loadExternalScript(src){
  return new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(x=>x.src===src);
    if(existing){
      if(window.supabase?.createClient)return resolve();
      existing.addEventListener('load',resolve,{once:true});
      existing.addEventListener('error',()=>reject(new Error('Could not load '+src)),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.async=true;
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Could not load '+src));
    document.head.appendChild(script);
  });
}
async function ensureSupabaseClient(){
  if(sb)return sb;
  if(supabaseLoadPromise)return supabaseLoadPromise;
  supabaseLoadPromise=(async()=>{
    if(!window.supabase?.createClient){
      const sources=[
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
        'https://unpkg.com/@supabase/supabase-js@2'
      ];
      let lastError=null;
      for(const src of sources){
        try{
          await loadExternalScript(src);
          if(window.supabase?.createClient)break;
        }catch(err){lastError=err;}
      }
      if(!window.supabase?.createClient){
        throw lastError||new Error('Cloud login library could not be loaded.');
      }
    }
    sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return sb;
  })();
  try{return await supabaseLoadPromise}
  catch(err){supabaseLoadPromise=null;throw err}
}
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
function normalizePhotoItems(record){
  if(Array.isArray(record?.photos)) return record.photos.filter(p=>p&&(p.url||p.path)).map(p=>typeof p==='string'?{url:p,path:''}:{url:p.url||'',path:p.path||'',id:p.id||''});
  if(record?.photo) return [{url:record.photo,path:record._photoPath||'',id:''}];
  return [];
}
function firstPhotoUrl(record){return normalizePhotoItems(record)[0]?.url||''}
function photoCount(record){return normalizePhotoItems(record).length}
function escapeAttr(s=''){return escapeHtml(s)}
async function loadZoneRows(){if(!currentUser)return;const {data,error}=await sb.from('property_zones').select('id,name,description,sort_order').order('sort_order');if(error)throw error;zoneRows=data||[]}
async function ensureSpecies(record){if(!currentUser||record.kind==='Seasonal/Event')return null;let q=await sb.from('species').select('id,common_name,category').ilike('common_name',record.name).limit(1);if(q.error)throw q.error;if(q.data?.length){const sp=q.data[0];if(sp.category!==record.group){const u=await sb.from('species').update({category:record.group}).eq('id',sp.id);if(u.error)throw u.error}return sp.id}const {data,error}=await sb.from('species').insert({user_id:currentUser.id,common_name:record.name,category:record.group||inferGroup(record)}).select('id').single();if(error)throw error;return data.id}
async function ensureIndividualPlant(record,speciesId,zoneId){if(!currentUser||record.kind!=='Plant'||!record.individualPlant)return null;let q=await sb.from('individual_plants').select('id,name').eq('species_id',speciesId).ilike('name',record.individualPlant).limit(1);if(q.error)throw q.error;if(q.data?.length)return q.data[0].id;const {data,error}=await sb.from('individual_plants').insert({user_id:currentUser.id,species_id:speciesId,name:record.individualPlant,zone_id:zoneId||null}).select('id').single();if(error)throw error;return data.id}
async function cloudUpsertObservation(record,{queueOnFail=true}={}){if(!currentUser){if(queueOnFail)queueOp({type:'upsert',record});return false}if(!navigator.onLine){if(queueOnFail)queueOp({type:'upsert',record});return false}try{syncing=true;setSyncStatus('syncing','Saving…');if(!isUuid(record.id)){const old=record.id;record.id=newUuid();const i=observations.findIndex(o=>String(o.id)===String(old));if(i>=0)observations[i].id=record.id;save()}const zoneId=record.zone===EVENT_ZONE?null:zoneIdFor(record.zone);const speciesId=await ensureSpecies(record);const individualId=await ensureIndividualPlant(record,speciesId,zoneId);const payload={id:record.id,user_id:currentUser.id,observation_type:record.kind,subject_name:record.name,species_id:speciesId,individual_plant_id:individualId,zone_id:zoneId,location_note:record.locationNote||null,observation_date:record.date,observation_time:record.kind==='Seasonal/Event'?null:(record.time||null),quantity:record.kind==='Seasonal/Event'?1:Number(record.count||1),activity_or_stage:record.detail||null,is_milestone:!!record.isMilestone,milestone_type:record.isMilestone?(record.milestoneType||null):null,measurement:record.kind==='Seasonal/Event'&&record.measurement!==''?Number(record.measurement):null,measurement_unit:record.kind==='Seasonal/Event'&&record.measurement!==''?(record.measurementUnit||null):null,start_time:record.kind==='Seasonal/Event'?(record.time||null):null,end_time:record.kind==='Seasonal/Event'?(record.eventEndTime||null):null,notes:record.notes||null,updated_at:new Date().toISOString()};const {error}=await sb.from('observations').upsert(payload,{onConflict:'id'});if(error)throw error;
const wanted=normalizePhotoItems(record);
const currentPhotoRows=await sb.from('observation_photos').select('id,storage_path').eq('observation_id',record.id);if(currentPhotoRows.error)throw currentPhotoRows.error;
const keepPaths=new Set(wanted.map(p=>p.path).filter(Boolean));
const removeRows=(currentPhotoRows.data||[]).filter(r=>!keepPaths.has(r.storage_path));
if(removeRows.length){const paths=removeRows.map(r=>r.storage_path).filter(Boolean);if(paths.length){const rm=await sb.storage.from('observation-photos').remove(paths);if(rm.error)throw rm.error}const ids=removeRows.map(r=>r.id);if(ids.length){const rd=await sb.from('observation_photos').delete().in('id',ids);if(rd.error)throw rd.error}}
const finalPhotos=[];let uploadIndex=0;const newPhotos=wanted.filter(p=>p.url&&p.url.startsWith('data:'));
for(const item of wanted){
  if(item.url&&item.url.startsWith('data:')){uploadIndex++;setSyncStatus('syncing',`Uploading photo ${uploadIndex} of ${newPhotos.length}…`);const path=`${currentUser.id}/${record.id}/${newUuid()}.jpg`;const up=await sb.storage.from('observation-photos').upload(path,dataUrlToBlob(item.url),{contentType:'image/jpeg',upsert:false});if(up.error)throw up.error;const pi=await sb.from('observation_photos').insert({user_id:currentUser.id,observation_id:record.id,storage_path:path}).select('id').single();if(pi.error)throw pi.error;const url=await signedPhotoUrl(path);finalPhotos.push({url,path,id:pi.data?.id||''});
  }else if(item.path){finalPhotos.push(item)}
}
record.photos=finalPhotos;record.photo=finalPhotos[0]?.url||'';record._photoPath=finalPhotos[0]?.path||'';
record._speciesId=speciesId;record._individualPlantId=individualId;pendingOps=pendingOps.filter(x=>!(x.type==='upsert'&&String(x.record?.id)===String(record.id)));cachePending();setSyncStatus('synced','Synced');return true}catch(err){console.error('Cloud save failed',err);if(queueOnFail)queueOp({type:'upsert',record});setSyncStatus(navigator.onLine?'error':'offline',navigator.onLine?'Sync issue':'Offline');toast('Saved on this device; cloud sync will retry');return false}finally{syncing=false}}
async function cloudDeleteObservation(id,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'delete',id});return false}try{setSyncStatus('syncing','Saving…');const pr=await sb.from('observation_photos').select('storage_path').eq('observation_id',id);if(pr.error)throw pr.error;const paths=(pr.data||[]).map(x=>x.storage_path).filter(Boolean);if(paths.length){const rm=await sb.storage.from('observation-photos').remove(paths);if(rm.error)throw rm.error}const d=await sb.from('observations').delete().eq('id',id);if(d.error)throw d.error;pendingOps=pendingOps.filter(x=>!(x.type==='delete'&&String(x.id)===String(id)));cachePending();setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'delete',id});setSyncStatus('error','Sync issue');return false}}
async function cloudRenameSpecies(oldName,newName,newGroup,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'renameSpecies',oldName,newName,newGroup});return false}try{setSyncStatus('syncing','Saving…');const q=await sb.from('species').select('id').ilike('common_name',oldName);if(q.error)throw q.error;for(const sp of q.data||[]){const u=await sb.from('species').update({common_name:newName,category:newGroup}).eq('id',sp.id);if(u.error)throw u.error}const ou=await sb.from('observations').update({subject_name:newName,updated_at:new Date().toISOString()}).eq('subject_name',oldName);if(ou.error)throw ou.error;setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'renameSpecies',oldName,newName,newGroup});setSyncStatus('error','Sync issue');return false}}
async function cloudUpdateLifeProfile(oldName,profile,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'profileUpdate',oldName,profile});return false}try{setSyncStatus('syncing','Saving…');const q=await sb.from('species').select('id').ilike('common_name',oldName);if(q.error)throw q.error;for(const sp of q.data||[]){const u=await sb.from('species').update({common_name:profile.name,category:profile.group,scientific_name:profile.scientificName||null,notes:profile.notes||null}).eq('id',sp.id);if(u.error)throw u.error}if(profile.name!==oldName){const ou=await sb.from('observations').update({subject_name:profile.name,updated_at:new Date().toISOString()}).eq('subject_name',oldName);if(ou.error)throw ou.error}setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'profileUpdate',oldName,profile});setSyncStatus('error','Sync issue');return false}}
async function cloudRenameIndividual(speciesName,oldName,newName,{queueOnFail=true}={}){if(!currentUser||!navigator.onLine){if(queueOnFail)queueOp({type:'renameIndividual',speciesName,oldName,newName});return false}try{setSyncStatus('syncing','Saving…');const sres=await sb.from('species').select('id').ilike('common_name',speciesName).limit(1);if(sres.error)throw sres.error;const sid=sres.data?.[0]?.id;if(sid){const u=await sb.from('individual_plants').update({name:newName}).eq('species_id',sid).eq('name',oldName);if(u.error)throw u.error}setSyncStatus('synced','Synced');return true}catch(err){console.error(err);if(queueOnFail)queueOp({type:'renameIndividual',speciesName,oldName,newName});setSyncStatus('error','Sync issue');return false}}
async function signedPhotoUrl(path){if(!path)return'';const {data,error}=await sb.storage.from('observation-photos').createSignedUrl(path,60*60*24*7);return error?'':(data?.signedUrl||'')}
async function loadCloudObservations(){if(!currentUser)return 0;setSyncStatus('syncing','Loading…');const {data,error}=await sb.from('observations').select('*, property_zones(name), species(category,scientific_name,notes), individual_plants(name), observation_photos(id,storage_path)').order('observation_date',{ascending:false});if(error)throw error;const rows=data||[];const mapped=[];for(const r of rows){const photoItems=[];for(const pr of (r.observation_photos||[])){const url=await signedPhotoUrl(pr.storage_path);if(url)photoItems.push({url,path:pr.storage_path,id:pr.id||''})}mapped.push({id:r.id,kind:r.observation_type,name:r.subject_name,group:r.species?.category||(r.observation_type==='Seasonal/Event'?'Seasonal':r.observation_type==='Plant'?inferPlantGroup(r.subject_name):guessWildlifeGroup(r.subject_name)),date:r.observation_date,time:r.observation_type==='Seasonal/Event'?(r.start_time||''):(r.observation_time||''),eventEndTime:r.end_time||'',zone:r.property_zones?.name||(r.observation_type==='Seasonal/Event'?EVENT_ZONE:'House & Yard'),locationNote:r.location_note||'',detail:r.activity_or_stage||'',count:r.quantity||1,measurement:r.measurement??'',measurementUnit:r.measurement_unit||'',notes:r.notes||'',isMilestone:!!r.is_milestone,milestoneType:r.milestone_type||'',photos:photoItems,photo:photoItems[0]?.url||'',individualPlant:r.individual_plants?.name||'',_scientificName:r.species?.scientific_name||'',_profileNotes:r.species?.notes||'',_speciesId:r.species_id,_individualPlantId:r.individual_plant_id,_photoPath:photoItems[0]?.path||''})}if(rows.length||startupLocalUser===currentUser.id){observations=mapped;save();localStorage.setItem('hs_cloud_user_id',currentUser.id);$('#cloudImportBanner')?.classList.add('hidden')}setSyncStatus('synced','Synced');renderAll();return rows.length}
async function flushPendingOps(){if(!currentUser||!navigator.onLine||!pendingOps.length)return;const ops=[...pendingOps];for(const op of ops){let ok=false;if(op.type==='upsert')ok=await cloudUpsertObservation(op.record,{queueOnFail:false});else if(op.type==='delete')ok=await cloudDeleteObservation(op.id,{queueOnFail:false});else if(op.type==='renameSpecies')ok=await cloudRenameSpecies(op.oldName,op.newName,op.newGroup,{queueOnFail:false});else if(op.type==='renameIndividual')ok=await cloudRenameIndividual(op.speciesName,op.oldName,op.newName,{queueOnFail:false});else if(op.type==='profileUpdate')ok=await cloudUpdateLifeProfile(op.oldName,op.profile,{queueOnFail:false});if(ok){pendingOps=pendingOps.filter(x=>x!==op);cachePending()}}}
async function importLocalToCloud(){const btn=$('#importLocalData');if(btn){btn.disabled=true;btn.textContent='Importing…'}const source=[...(startupLocalObservations||observations)];let done=0;for(const original of source){const rec={...original,id:isUuid(original.id)?original.id:newUuid()};const ok=await cloudUpsertObservation(rec,{queueOnFail:true});if(ok)done++}await loadCloudObservations();localStorage.setItem('hs_cloud_user_id',currentUser.id);$('#cloudImportBanner')?.classList.add('hidden');toast(`${done} observation${done===1?'':'s'} imported to cloud`);if(btn){btn.disabled=false;btn.textContent='Import to Cloud'}}
async function handleSignedIn(user){currentUser=user;$('#authGate').classList.add('hidden');$('#app').classList.remove('hidden');$('#accountEmail').textContent=user.email||'';setSyncStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'Loading…':'Offline');try{await loadZoneRows();await flushPendingOps();const count=await loadCloudObservations();cloudReady=true;if(count===0){const local=JSON.parse(localStorage.getItem('hs_observations')||'null');if(local?.length&&startupLocalUser!==user.id){startupLocalObservations=local;$('#cloudImportText').textContent=`This device has ${local.length} observation${local.length===1?'':'s'} that can be copied into your cloud journal.`;$('#cloudImportBanner').classList.remove('hidden')}else{localStorage.setItem('hs_cloud_user_id',user.id)}}}catch(err){console.error('Cloud load failed',err);setSyncStatus('error','Sync issue');toast('Could not load cloud data. Local records are still available.')}}
async function initAuth(){
  try{
    await ensureSupabaseClient();
    const {data,error}=await sb.auth.getSession();
    if(error)throw error;
    if(data.session?.user)await handleSignedIn(data.session.user);
    else{$('#authGate').classList.remove('hidden');$('#app').classList.add('hidden')}
  }catch(err){
    console.error('Cloud login initialization failed',err);
    $('#authGate').classList.remove('hidden');
    $('#app').classList.add('hidden');
    showAuthError('Unable to load cloud login. Check your connection, then tap Log In to retry.');
  }
}
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
observations=observations.map(o=>({...o,zone:LEGACY_ZONE_MAP[o.zone]||o.zone,locationNote:o.locationNote||"",isMilestone:!!o.isMilestone,milestoneType:o.milestoneType||"",measurement:o.measurement??"",measurementUnit:o.measurementUnit||"",eventEndTime:o.eventEndTime||"",group:o.group||(o.kind==='Plant'?inferPlantGroup(o.name):o.kind==='Wildlife'?guessWildlifeGroup(o.name):'Seasonal'),individualPlant:o.individualPlant||"",_scientificName:o._scientificName||"",_profileNotes:o._profileNotes||"",photos:Array.isArray(o.photos)?o.photos:(o.photo?[{url:o.photo,path:o._photoPath||""}]:[]),photo:o.photo||((Array.isArray(o.photos)&&o.photos[0]?.url)||"")}));
startupLocalObservations=JSON.parse(JSON.stringify(observations));
let currentJournalFilter='All',currentLifeFilter='All',selectedZone=null,editingId=null,currentSeasonTab='calendar';
let photoData=''; let photoItems=[]; const MAX_PHOTOS=8;
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
 const firstPhoto=firstPhotoUrl(o),pc=photoCount(o);
 const thumb=firstPhoto?`<button class="thumb photo-thumb" data-lightbox-url="${escapeAttr(firstPhoto)}" data-lightbox-caption="${escapeAttr(`${o.name} — ${fmtDate(o.date)}`)}"><img src="${escapeAttr(firstPhoto)}" alt="${escapeAttr(o.name)}">${pc>1?`<span class="photo-count">${pc}</span>`:''}</button>`:`<div class="thumb">${icon(o)}</div>`;
 return `<article class="entry">${thumb}<div class="body"><div class="title">${escapeHtml(o.name)} <span class="badge">${escapeHtml(o.kind)}</span>${o.isMilestone?'<span class="milestone-badge">Milestone</span>':''}</div><div class="meta">${fmtDate(o.date)}${timePart} • ${escapeHtml(locationText(o))}${o.count>1&&o.kind!=='Seasonal/Event'?' • '+o.count:''}${measure?' • '+escapeHtml(measure):''}${pc?` • ${pc} photo${pc===1?'':'s'}`:''}</div><div class="note">${escapeHtml(o.detail)}${o.notes?' — '+escapeHtml(o.notes):''}</div><div class="entry-actions"><button class="entry-action edit" data-edit="${o.id}">Edit</button><button class="entry-action delete" data-delete="${o.id}">Delete</button></div></div></article>`
}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function renderLifeHistoryEntry(o){
 const measure=measurementText(o),pc=photoCount(o),fp=firstPhotoUrl(o);
 const locationDetail=o.locationNote?`<div class="life-detail-line"><strong>Location:</strong> ${escapeHtml(o.locationNote)}</div>`:'';
 const notesDetail=o.notes?`<div class="life-detail-line life-notes"><strong>Notes:</strong> ${escapeHtml(o.notes)}</div>`:'';
 const activityDetail=o.detail?`<div class="life-detail-line"><strong>${o.kind==='Plant'?'Stage':'Activity'}:</strong> ${escapeHtml(o.detail)}</div>`:'';
 const individual=o.individualPlant?`<div class="life-detail-line"><strong>Individual:</strong> ${escapeHtml(o.individualPlant)}</div>`:'';
 const thumb=fp?`<button class="thumb photo-thumb" data-lightbox-url="${escapeAttr(fp)}" data-lightbox-caption="${escapeAttr(`${o.name} — ${fmtDate(o.date)}`)}"><img src="${escapeAttr(fp)}" alt="${escapeAttr(o.name)}">${pc>1?`<span class="photo-count">${pc}</span>`:''}</button>`:`<div class="thumb">${icon(o)}</div>`;
 return `<article class="entry life-history-entry">${thumb}<div class="body"><div class="title">${fmtDate(o.date)}${o.isMilestone?' <span class="milestone-badge">Milestone</span>':''}</div><div class="meta">${o.time?escapeHtml(o.time):''}${o.time?' • ':''}${escapeHtml(o.zone)}${o.count>1&&o.kind!=='Seasonal/Event'?' • '+o.count:''}${measure?' • '+escapeHtml(measure):''}${pc?` • ${pc} photo${pc===1?'':'s'}`:''}</div>${individual}${locationDetail}${activityDetail}${notesDetail}<div class="entry-actions"><button class="entry-action edit" data-edit="${o.id}">Edit</button><button class="entry-action delete" data-delete="${o.id}">Delete</button></div></div></article>`
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
 [...observations].filter(o=>o.kind!=='Seasonal/Event').sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||''))).forEach(o=>{
   const key=o.name.trim().toLowerCase();
   if(!map[key])map[key]={name:o.name,kind:o.kind,group:o.group||inferGroup(o),count:0,last:o.date,first:o.date,zones:new Set,photos:0,individuals:new Set,featured:firstPhotoUrl(o),scientificName:o._scientificName||'',profileNotes:o._profileNotes||''};
   const x=map[key];x.count++;x.zones.add(o.zone);x.photos+=photoCount(o);if(o.individualPlant)x.individuals.add(o.individualPlant);
   if(!x.featured&&firstPhotoUrl(o))x.featured=firstPhotoUrl(o);if(!x.scientificName&&o._scientificName)x.scientificName=o._scientificName;if(!x.profileNotes&&o._profileNotes)x.profileNotes=o._profileNotes;
   if(o.date>x.last)x.last=o.date;if(o.date<x.first)x.first=o.date;
 });
 let list=Object.values(map);
 if(currentLifeFilter!=='All')list=list.filter(x=>x.group===currentLifeFilter);
 if(q)list=list.filter(x=>[x.name,x.group,x.scientificName,...x.zones].join(' ').toLowerCase().includes(q));
 list.sort((a,b)=>a.name.localeCompare(b.name));
 $('#lifeSpeciesCount').textContent=Object.keys(map).length;
 $('#lifePhotoCount').textContent=observations.filter(o=>o.kind!=='Seasonal/Event').reduce((n,o)=>n+photoCount(o),0);
 $('#lifeIndividualCount').textContent=new Set(observations.filter(o=>o.kind==='Plant'&&o.individualPlant).map(o=>o.individualPlant.trim().toLowerCase())).size;
 $('#lifeList').innerHTML=list.map(x=>`<button class="life-card" data-life-profile="${escapeAttr(x.name)}">${x.featured?`<div class="life-card-photo"><img src="${escapeAttr(x.featured)}" alt="${escapeAttr(x.name)}"></div>`:`<div class="life-card-thumb">${lifeIcon(x.group,x.kind)}</div>`}<div class="life-card-body"><div class="title">${escapeHtml(x.name)}</div>${x.scientificName?`<div class="life-profile-subtitle"><em>${escapeHtml(x.scientificName)}</em></div>`:''}<div class="meta">${escapeHtml(x.group)} • ${x.count} observation${x.count===1?'':'s'} • ${x.zones.size} zone${x.zones.size===1?'':'s'}</div><div class="life-card-note">First ${fmtDate(x.first)} • Last ${fmtDate(x.last)}${x.photos?` • ${x.photos} photo${x.photos===1?'':'s'}`:''}${x.individuals.size?` • ${x.individuals.size} individual plant${x.individuals.size===1?'':'s'}`:''}</div></div><span class="chevron">›</span></button>`).join('')||'<div class="empty">No matching life records.</div>';
 $$('[data-life-profile]').forEach(b=>b.onclick=()=>openLifeProfile(b.dataset.lifeProfile));
}
function lifeIcon(group,kind){if(group==='Bird')return'🐦';if(group==='Mammal')return'🦌';if(group==='Other Wildlife')return'🦋';if(group==='Tree')return'🌳';if(group==='Shrub')return'🌿';if(group==='Flower')return'🌸';if(group==='Wildflower')return'🌼';return kind==='Plant'?'🌱':'🦋'}
function openLifeProfile(name){
 const items=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===name.toLowerCase()).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
 if(!items.length)return;
 const oldest=[...items].sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')))[0], newest=items[0];
 const zones=[...new Set(items.map(o=>o.zone))],years=[...new Set(items.map(o=>o.date.slice(0,4)))].sort();
 const photos=items.flatMap(o=>normalizePhotoItems(o).map(p=>({...p,observationId:o.id,date:o.date,name:o.name})));
 const milestones=items.filter(o=>o.isMilestone).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
 const scientific=items.find(o=>o._scientificName)?._scientificName||'',profileNotes=items.find(o=>o._profileNotes)?._profileNotes||'';
 const individuals={};items.filter(o=>o.kind==='Plant'&&o.individualPlant).forEach(o=>{const k=o.individualPlant.trim();if(!individuals[k])individuals[k]={name:k,count:0,first:o.date,last:o.date,zones:new Set};const x=individuals[k];x.count++;x.zones.add(o.zone);if(o.date<x.first)x.first=o.date;if(o.date>x.last)x.last=o.date});
 const monthCounts=Array(12).fill(0);items.forEach(o=>monthCounts[new Date(o.date+'T12:00:00').getMonth()]++);const maxMonth=Math.max(1,...monthCounts);const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const zoneCounts={};items.forEach(o=>zoneCounts[o.zone]=(zoneCounts[o.zone]||0)+1);const maxZone=Math.max(1,...Object.values(zoneCounts));
 const peakIndex=monthCounts.indexOf(Math.max(...monthCounts));
 const feature=photos[0]?.url||'';
 $('#lifeProfileEyebrow').textContent=`${newest.group||inferGroup(newest)} • ${newest.kind}`;
 $('#lifeProfileTitle').textContent=newest.name;
 $('#lifeProfileContent').innerHTML=`
   <div class="life-profile-hero ${feature?'has-photo':''}">${feature?`<button class="photo-preview-open life-photo-feature" data-lightbox-url="${escapeAttr(feature)}" data-lightbox-caption="${escapeAttr(`${newest.name} — featured photo`)}"><img src="${escapeAttr(feature)}" alt="${escapeAttr(newest.name)}"></button><span class="life-profile-hero-badge">${photos.length} photo${photos.length===1?'':'s'}</span><div class="life-profile-hero-overlay"><strong>${escapeHtml(newest.name)}</strong>${scientific?`<em>${escapeHtml(scientific)}</em>`:''}</div>`:`<div class="life-profile-empty-hero">${lifeIcon(newest.group||inferGroup(newest),newest.kind)}</div>`}</div>
   <div class="profile-actions"><button class="primary small" data-add-for-species="${escapeAttr(newest.name)}">+ Add Observation</button><button class="secondary small" data-edit-profile="${escapeAttr(newest.name)}">Edit Profile</button></div>
   <div class="life-profile-stats"><div><strong>${items.length}</strong><span>observations</span></div><div><strong>${years.length}</strong><span>years</span></div><div><strong>${zones.length}</strong><span>zones</span></div><div><strong>${milestones.length}</strong><span>milestones</span></div><div><strong>${photos.length}</strong><span>photos</span></div></div>
   <div class="profile-dates card"><div><span>First recorded</span><strong>${fmtDate(oldest.date)}</strong></div><div><span>Most recent</span><strong>${fmtDate(newest.date)}</strong></div></div>
   ${(scientific||profileNotes)?`<section class="profile-section"><div class="section-head"><h3>About</h3></div><div class="profile-about card">${scientific?`<div class="scientific">${escapeHtml(scientific)}</div>`:''}${profileNotes?`<p>${escapeHtml(profileNotes)}</p>`:''}</div></section>`:''}
   <section class="profile-section"><div class="section-head"><h3>Seasonal rhythm</h3><span class="muted">${items.length?`most often recorded in ${months[peakIndex]}`:''}</span></div><div class="season-rhythm">${months.map((m,i)=>`<div class="season-rhythm-row"><span>${m}</span><div class="season-rhythm-track"><div class="season-rhythm-fill" style="width:${(monthCounts[i]/maxMonth)*100}%"></div></div><b>${monthCounts[i]||''}</b></div>`).join('')}</div></section>
   <section class="profile-section"><div class="section-head"><h3>Where you've seen it</h3><span class="muted">${zones.length} zone${zones.length===1?'':'s'}</span></div><div class="zone-activity">${Object.entries(zoneCounts).sort((a,b)=>b[1]-a[1]).map(([z,c])=>`<div class="zone-activity-row"><span>${escapeHtml(z)}</span><div class="zone-activity-track"><div class="zone-activity-fill" style="width:${(c/maxZone)*100}%"></div></div><b>${c}</b></div>`).join('')}</div></section>
   ${Object.keys(individuals).length?`<section class="profile-section"><div class="section-head"><h3>Individual plants</h3><span class="muted">tracked separately</span></div><div class="stack">${Object.values(individuals).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<div class="individual-card"><div><strong>${escapeHtml(x.name)}</strong><div class="meta">${x.count} observation${x.count===1?'':'s'} • ${[...x.zones].map(escapeHtml).join(', ')}</div></div><div class="individual-tools"><div class="individual-dates">${fmtDate(x.first)} → ${fmtDate(x.last)}</div><button class="entry-action edit" data-edit-individual="${escapeAttr(x.name)}" data-species="${escapeAttr(newest.name)}">Edit name</button></div></div>`).join('')}</div></section>`:''}
   ${milestones.length?`<section class="profile-section"><div class="section-head"><h3>Seasonal milestones</h3><span class="muted">${milestones.length}</span></div><div class="milestone-timeline">${milestones.map((o,i)=>`${i===0||milestones[i-1].date.slice(0,4)!==o.date.slice(0,4)?`<div class="milestone-year">${o.date.slice(0,4)}</div>`:''}<div class="profile-milestone"><strong>${escapeHtml(o.milestoneType||o.detail)}</strong><div class="meta">${fmtDate(o.date)} • ${escapeHtml(locationText(o))}</div></div>`).join('')}</div></section>`:''}
   ${photos.length?`<section class="profile-section"><div class="section-head"><h3>Photos</h3><span class="muted">${photos.length}</span></div><div class="photo-grid">${photos.slice(0,24).map(p=>`<button class="photo-tile" data-lightbox-url="${escapeAttr(p.url)}" data-lightbox-caption="${escapeAttr(`${p.name} — ${fmtDate(p.date)}`)}"><img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.name)} photographed ${fmtDate(p.date)}"><span>${fmtDate(p.date)}</span></button>`).join('')}</div></section>`:''}
   <section class="profile-section"><div class="section-head"><h3>Observation history</h3><span class="muted">newest first</span></div><div class="stack">${items.map(renderLifeHistoryEntry).join('')}</div></section>`;
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
let editingLifeProfileName='';
function lifeGroupOptions(kind){return kind==='Plant'?['Tree','Shrub','Flower','Wildflower','Other Plant']:['Bird','Mammal','Other Wildlife']}
function editLifeProfile(name){
 const items=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===name.toLowerCase());if(!items.length)return;
 const sample=items[0],group=sample.group||inferGroup(sample),opts=lifeGroupOptions(sample.kind);
 editingLifeProfileName=sample.name;
 $('#lifeEditName').value=sample.name;$('#lifeEditGroup').innerHTML=opts.map(x=>`<option>${x}</option>`).join('');$('#lifeEditGroup').value=opts.includes(group)?group:opts[0];
 $('#lifeEditScientific').value=items.find(o=>o._scientificName)?._scientificName||'';$('#lifeEditNotes').value=items.find(o=>o._profileNotes)?._profileNotes||'';
 closeLifeProfile();$('#lifeEditBackdrop').classList.remove('hidden');
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
let currentYearReview=null;
function openYearReview(year){
 const obs=observations.filter(o=>o.date.startsWith(year)).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
 if(!obs.length)return;
 currentYearReview=String(year);
 const life=obs.filter(o=>o.kind!=='Seasonal/Event');
 const wildlifeObs=obs.filter(o=>o.kind==='Wildlife');
 const plantObs=obs.filter(o=>o.kind==='Plant');
 const eventObs=obs.filter(o=>o.kind==='Seasonal/Event');
 const uniqueLife=new Set(life.map(o=>o.name.trim().toLowerCase())).size;
 const uniqueWildlife=new Set(wildlifeObs.map(o=>o.name.trim().toLowerCase())).size;
 const uniquePlants=new Set(plantObs.map(o=>o.name.trim().toLowerCase())).size;
 const photos=obs.flatMap(o=>normalizePhotoItems(o).map(p=>({...p,date:o.date,name:o.name,zone:o.zone})));
 const allMilestones=milestoneRecords().filter(o=>o.date.startsWith(year)).sort((a,b)=>a.date.localeCompare(b.date));
 const explicit=allMilestones.filter(o=>!o.derived);
 const zones={};obs.forEach(o=>{if(o.zone&&o.zone!==EVENT_ZONE)zones[o.zone]=(zones[o.zone]||0)+1});
 const topZones=Object.entries(zones).sort((a,b)=>b[1]-a[1]).slice(0,3);
 const lifeCounts={};life.forEach(o=>{const key=o.name.trim();lifeCounts[key]=(lifeCounts[key]||0)+1});
 const topLife=Object.entries(lifeCounts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5);
 const counts=Array(12).fill(0);obs.forEach(o=>counts[new Date(o.date+'T12:00:00').getMonth()]++);
 const maxMonth=Math.max(1,...counts);
 const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const fullMonthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
 const snow=eventObs.filter(o=>/snow/i.test(`${o.name} ${o.detail} ${o.milestoneType||''}`));
 const snowMeasured=snow.filter(o=>o.measurement!==''&&o.measurement!=null&&String(o.measurementUnit).toLowerCase()==='inches');
 const snowTotal=snowMeasured.reduce((n,o)=>n+Number(o.measurement||0),0);
 const rain=eventObs.filter(o=>/rain/i.test(`${o.name} ${o.detail} ${o.milestoneType||''}`));
 const rainMeasured=rain.filter(o=>o.measurement!==''&&o.measurement!=null&&String(o.measurementUnit).toLowerCase()==='inches');
 const rainTotal=rainMeasured.reduce((n,o)=>n+Number(o.measurement||0),0);
 const tempEvents=eventObs.filter(o=>o.measurement!==''&&o.measurement!=null&&['°f','f','fahrenheit'].includes(String(o.measurementUnit||'').toLowerCase()));
 const tempVals=tempEvents.map(o=>Number(o.measurement)).filter(Number.isFinite);
 const frostFreeze=eventObs.filter(o=>/frost|freeze/i.test(`${o.name} ${o.detail} ${o.milestoneType||''}`));
 const storms=eventObs.filter(o=>/storm|thunder|wind|ice/i.test(`${o.name} ${o.detail} ${o.milestoneType||''}`));
 const bloomArrival=explicit.filter(o=>/bloom|flower|arrival|first seen|migration/i.test(`${o.displayMilestone||''} ${o.milestoneType||''} ${o.detail||''}`)).slice(0,10);
 const firstMilestone=explicit[0]||allMilestones[0];
 const lastMilestone=explicit[explicit.length-1]||allMilestones[allMilestones.length-1];
 const first=obs[0],last=obs[obs.length-1];
 const timeline=fullMonthNames.map((month,i)=>{
   const monthObs=obs.filter(o=>new Date(o.date+'T12:00:00').getMonth()===i);
   const monthMilestones=allMilestones.filter(o=>new Date(o.date+'T12:00:00').getMonth()===i).slice(0,3);
   return {month,count:monthObs.length,items:monthMilestones};
 });
 const statCard=(value,label)=>`<div class="review-stat"><strong>${value}</strong><span>${label}</span></div>`;
 const rankList=(items,empty='Nothing recorded yet.')=>items.length?items.map(([name,count],i)=>`<div class="review-rank-row"><span class="review-rank-num">${i+1}</span><div><strong>${escapeHtml(name)}</strong><small>${count} observation${count===1?'':'s'}</small></div></div>`).join(''):`<div class="muted">${empty}</div>`;
 $('#yearReviewTitle').textContent=`${year} Year in Review`;
 $('#yearReviewContent').innerHTML=`
   <div class="review-cover">
     <div class="review-cover-kicker">Homestead Seasons</div>
     <h3>${year} on the Homestead</h3>
     <p>${obs.length} recorded moment${obs.length===1?'':'s'} from ${fmtDate(first.date)} through ${fmtDate(last.date)}.</p>
     <div class="review-cover-line">One homestead. Different stories.</div>
   </div>
   <div class="review-stats review-stats-six">
     ${statCard(obs.length,'observations')}${statCard(uniqueLife,'species / plants')}${statCard(uniqueWildlife,'wildlife species')}${statCard(uniquePlants,'plant species')}${statCard(explicit.length,'milestones')}${statCard(photos.length,'photos')}
   </div>
   <section class="review-section"><h3>What you recorded</h3><div class="review-breakdown"><div><strong>${wildlifeObs.length}</strong><span>wildlife</span></div><div><strong>${plantObs.length}</strong><span>plants</span></div><div><strong>${eventObs.length}</strong><span>weather / events</span></div></div></section>
   <div class="review-two-col">
     <section class="review-section"><h3>Most frequently observed</h3><div class="review-rank-list">${rankList(topLife)}</div></section>
     <section class="review-section"><h3>Most active zones</h3><div class="review-rank-list">${rankList(topZones,'No zoned observations yet.')}</div></section>
   </div>
   <section class="review-section"><h3>Seasonal bookends</h3><div class="review-bookends">
     <div><span>First milestone</span>${firstMilestone?`<strong>${escapeHtml(firstMilestone.name)} — ${escapeHtml(firstMilestone.displayMilestone)}</strong><small>${fmtDate(firstMilestone.date)} • ${escapeHtml(firstMilestone.zone)}</small>`:'<strong>Not yet recorded</strong>'}</div>
     <div><span>Last milestone</span>${lastMilestone?`<strong>${escapeHtml(lastMilestone.name)} — ${escapeHtml(lastMilestone.displayMilestone)}</strong><small>${fmtDate(lastMilestone.date)} • ${escapeHtml(lastMilestone.zone)}</small>`:'<strong>Not yet recorded</strong>'}</div>
   </div></section>
   ${bloomArrival.length?`<section class="review-section"><h3>Bloom & arrival highlights</h3><div class="review-list">${bloomArrival.map(o=>`<div class="review-list-item"><strong>${escapeHtml(o.name)} — ${escapeHtml(o.displayMilestone)}</strong><span>${fmtDate(o.date)} • ${escapeHtml(o.zone)}</span></div>`).join('')}</div></section>`:''}
   <section class="review-section"><h3>Weather at a glance</h3><div class="weather-review-grid">
     <div><strong>${snow.length}</strong><span>snowfall event${snow.length===1?'':'s'}</span><small>${snowMeasured.length?`${snowTotal.toFixed(1).replace(/\.0$/,'')} in recorded snow`:'No snow totals entered'}</small></div>
     <div><strong>${rain.length}</strong><span>rainfall event${rain.length===1?'':'s'}</span><small>${rainMeasured.length?`${rainTotal.toFixed(1).replace(/\.0$/,'')} in recorded rain`:'No rain totals entered'}</small></div>
     <div><strong>${frostFreeze.length}</strong><span>frost / freeze event${frostFreeze.length===1?'':'s'}</span><small>${storms.length} storm / wind / ice event${storms.length===1?'':'s'}</small></div>
     <div><strong>${tempVals.length?`${Math.min(...tempVals)}°–${Math.max(...tempVals)}°`:'—'}</strong><span>recorded temperature range</span><small>${tempVals.length?'from weather observations':'Add measured °F events to track'}</small></div>
   </div></section>
   <section class="review-section"><h3>Activity through the year</h3><div class="month-bars">${counts.map((n,i)=>`<div class="month-bar-row"><span>${monthNames[i]}</span><div class="month-bar-track"><div class="month-bar-fill" style="width:${Math.round(n/maxMonth*100)}%"></div></div><strong>${n}</strong></div>`).join('')}</div></section>
   <section class="review-section"><h3>Month-by-month story</h3><div class="review-month-grid">${timeline.map(m=>`<div class="review-month-card ${m.count?'':'quiet'}"><div class="review-month-head"><strong>${m.month}</strong><span>${m.count} record${m.count===1?'':'s'}</span></div>${m.items.length?m.items.map(o=>`<div class="review-month-item"><b>${escapeHtml(o.name)}</b><small>${fmtDate(o.date)} • ${escapeHtml(o.displayMilestone)}</small></div>`).join(''):'<small class="muted">No seasonal highlights recorded.</small>'}</div>`).join('')}</div></section>
   <section class="review-section"><h3>Seasonal milestones</h3><div class="review-list">${explicit.length?explicit.map(o=>`<div class="review-list-item"><strong>${escapeHtml(o.name)} — ${escapeHtml(o.displayMilestone)}</strong><span>${fmtDate(o.date)} • ${escapeHtml(o.zone)}${measurementText(o)?` • ${escapeHtml(measurementText(o))}`:''}</span></div>`).join(''):'<div class="empty">No marked milestones this year yet.</div>'}</div></section>
   ${photos.length?`<section class="review-section"><h3>Photo highlights</h3><div class="review-photo-grid">${photos.slice(0,12).map(p=>`<button class="review-photo-btn" data-lightbox-url="${escapeAttr(p.url)}" data-lightbox-caption="${escapeAttr(`${p.name} — ${fmtDate(p.date)}`)}"><img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.name)} — ${fmtDate(p.date)}"></button>`).join('')}</div>${photos.length>12?`<div class="milestone-meta" style="margin-top:7px">+ ${photos.length-12} more photos in the Journal</div>`:''}</section>`:''}
   <div class="review-footer">Homestead Seasons • ${year} Year in Review</div>`;
 $('#yearReviewBackdrop').classList.remove('hidden');
}
function closeYearReview(){$('#yearReviewBackdrop').classList.add('hidden')}
function renderZones(){const counts=Object.fromEntries(ZONES.map(z=>[z,0]));observations.forEach(o=>{if(counts[o.zone]!==undefined)counts[o.zone]++});$('#zoneList').innerHTML=ZONES.map(z=>`<button class="zone-card ${selectedZone===z?'selected':''}" data-zone-card="${escapeAttr(z)}"><div class="zone-card-icon">📍</div><div class="zone-card-body"><div class="title">${escapeHtml(z)}</div><div class="zone-description">${escapeHtml(ZONE_INFO[z])}</div><div class="meta">${counts[z]||0} observation${counts[z]===1?'':'s'}</div></div><span class="chevron">›</span></button>`).join('');$$('[data-zone-card]').forEach(b=>b.onclick=()=>showZone(b.dataset.zoneCard));$$('.zone-dot').forEach(b=>{const on=selectedZone===b.dataset.zone;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',on?'true':'false')});if(selectedZone)renderZoneDetail()}
function showZone(z){selectedZone=z;$('#zoneDetail').classList.remove('hidden');renderZones();renderZoneDetail();setTimeout(()=>$('#zoneDetail').scrollIntoView({behavior:'smooth',block:'start'}),0)}
function renderZoneDetail(){
 if(!selectedZone)return;
 $('#zoneDetailTitle').textContent=selectedZone;
 const list=[...observations].filter(o=>o.zone===selectedZone).sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
 const life=list.filter(o=>o.kind!=='Seasonal/Event');
 const speciesMap=new Map();
 life.forEach(o=>{const key=o.name.trim().toLowerCase();if(!speciesMap.has(key))speciesMap.set(key,{name:o.name,kind:o.kind,group:o.group||inferGroup(o),count:0,last:o.date});const x=speciesMap.get(key);x.count++;if(o.date>x.last)x.last=o.date});
 const species=[...speciesMap.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 const photos=list.flatMap(o=>normalizePhotoItems(o).map(p=>({...p,name:o.name,date:o.date})));
 const milestones=list.filter(o=>o.isMilestone).length;
 const latest=list[0];
 $('#zoneSummary').innerHTML=`<div class="zone-summary-stat"><strong>${list.length}</strong><span>observations</span></div><div class="zone-summary-stat"><strong>${species.length}</strong><span>species / plants</span></div><div class="zone-summary-stat"><strong>${photos.length}</strong><span>photos</span></div><div class="zone-summary-stat"><strong>${milestones}</strong><span>milestones</span></div>${latest?`<div class="zone-latest"><span>Most recent</span><strong>${escapeHtml(latest.name)}</strong><small>${fmtDate(latest.date)}${latest.detail?` • ${escapeHtml(latest.detail)}`:''}</small></div>`:`<div class="zone-latest"><span>Most recent</span><strong>No observations yet</strong><small>${escapeHtml(ZONE_INFO[selectedZone]||'')}</small></div>`}`;
 $('#zoneSpeciesCount').textContent=`${species.length} recorded`;
 $('#zoneSpeciesList').innerHTML=species.length?species.slice(0,18).map(x=>`<button class="zone-species-chip" data-zone-species="${escapeAttr(x.name)}"><span>${lifeIcon(x.group,x.kind)}</span><strong>${escapeHtml(x.name)}</strong><small>${x.count}</small></button>`).join(''):'<div class="empty">No wildlife or plants recorded here yet.</div>';
 $('#zonePhotoCount').textContent=`${photos.length}`;
 $('#zonePhotoGrid').innerHTML=photos.slice(0,18).map(p=>`<button class="photo-tile" data-lightbox-url="${escapeAttr(p.url)}" data-lightbox-caption="${escapeAttr(`${p.name} — ${fmtDate(p.date)} — ${selectedZone}`)}"><img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.name)}"><span>${fmtDate(p.date)}</span></button>`).join('');
 $('#zonePhotoSection').classList.toggle('hidden',!photos.length);
 $('#zoneDetailList').innerHTML=list.slice(0,12).map(renderEntry).join('')||'<div class="empty">No observations recorded in this zone yet. Use “Add Observation Here” to start one.</div>';
 $$('[data-zone-species]').forEach(b=>b.onclick=()=>openLifeProfile(b.dataset.zoneSpecies));
}
function renderAll(){renderToday();renderJournal();renderLife();renderSeasons();renderZones()}
function showView(name){$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.nav===name));window.scrollTo({top:0,behavior:'smooth'})}
$$('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));$$('[data-go]').forEach(b=>b.onclick=()=>showView(b.dataset.go));$$('[data-action="add"],#addTop').forEach(b=>b.onclick=()=>openModal());
function resetForm(){
 const f=$('#obsForm');f.reset();photoData='';photoItems=[];renderPhotoPreviews();setPhotoPickerStatus('');$('#kind').value='Wildlife';$('#isMilestone').checked=false;$('#milestoneTypeWrap').classList.add('hidden');$$('.seg').forEach((x,i)=>x.classList.toggle('active',i===0));updateDetailOptions();updateKindFields();updateMilestoneOptions();
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
function openModal(obs=null,presetZone=''){
 resetForm();const now=new Date();editingId=obs?obs.id:null;$('#modalEyebrow').textContent=obs?'Update record':'New record';$('#modalTitle').textContent=obs?'Edit Observation':'Add Observation';$('#saveObsBtn').textContent=obs?'Save Changes':'Save Observation';
 if(obs){
   $('#kind').value=obs.kind;$$('.seg').forEach(x=>x.classList.toggle('active',x.dataset.kind===obs.kind));updateDetailOptions();updateKindFields();
   $('#name').value=obs.name;$('#group').value=obs.group||inferGroup(obs);$('#individualPlant').value=obs.individualPlant||'';$('#date').value=obs.date;$('#time').value=obs.time||'';populateZoneOptions(obs.zone);$('#locationNote').value=obs.locationNote||'';$('#detail').value=obs.detail||'';$('#count').value=obs.count||1;$('#notes').value=obs.notes||'';
   $('#measurement').value=obs.measurement??'';$('#measurementUnit').value=obs.measurementUnit||'inches';$('#eventEndTime').value=obs.eventEndTime||'';
   $('#isMilestone').checked=!!obs.isMilestone;updateMilestoneOptions();$('#milestoneTypeWrap').classList.toggle('hidden',!obs.isMilestone);if(obs.isMilestone&&obs.milestoneType)$('#milestoneType').value=obs.milestoneType;photoItems=normalizePhotoItems(obs).map(p=>({...p}));photoData=photoItems[0]?.url||'';renderPhotoPreviews();
 }else{$('#date').value=now.toISOString().slice(0,10);$('#time').value=now.toTimeString().slice(0,5);if(presetZone){populateZoneOptions(presetZone);$('#zone').value=presetZone}}
 $('#modalBackdrop').classList.remove('hidden')
}
function closeModal(){editingId=null;$('#modalBackdrop').classList.add('hidden')}
$('#closeModal').onclick=closeModal;$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
$('#closeLifeProfile').onclick=closeLifeProfile;$('#lifeBackdrop').addEventListener('click',e=>{if(e.target.id==='lifeBackdrop')closeLifeProfile()});
$('#closeLifeEdit').onclick=()=>$('#lifeEditBackdrop').classList.add('hidden');$('#lifeEditBackdrop').addEventListener('click',e=>{if(e.target.id==='lifeEditBackdrop')$('#lifeEditBackdrop').classList.add('hidden')});$('#lifeEditForm').addEventListener('submit',async e=>{e.preventDefault();const oldName=editingLifeProfileName,newName=$('#lifeEditName').value.trim(),group=$('#lifeEditGroup').value,scientificName=$('#lifeEditScientific').value.trim(),notes=$('#lifeEditNotes').value.trim();if(!newName)return;const items=observations.filter(o=>o.kind!=='Seasonal/Event'&&o.name.toLowerCase()===oldName.toLowerCase());items.forEach(o=>{o.name=newName;o.group=group;o._scientificName=scientificName;o._profileNotes=notes});save();renderAll();$('#lifeEditBackdrop').classList.add('hidden');openLifeProfile(newName);await cloudUpdateLifeProfile(oldName,{name:newName,group,scientificName,notes});toast('Life profile updated')});
$('#closeYearReview').onclick=closeYearReview;$('#yearReviewBackdrop').addEventListener('click',e=>{if(e.target.id==='yearReviewBackdrop')closeYearReview()});$('#printYearReview').onclick=()=>{document.body.classList.add('printing-year-review');window.print();setTimeout(()=>document.body.classList.remove('printing-year-review'),500)};
document.addEventListener('click',async e=>{const lb=e.target.closest('[data-lightbox-url]');if(lb&&!e.target.closest('[data-remove-photo]')){openLightbox(lb.dataset.lightboxUrl,lb.dataset.lightboxCaption||'');return}const yearReview=e.target.closest('[data-year-review]');if(yearReview){openYearReview(yearReview.dataset.yearReview);return}const addSpecies=e.target.closest('[data-add-for-species]');if(addSpecies){addObservationForSpecies(addSpecies.dataset.addForSpecies);return}const editProfile=e.target.closest('[data-edit-profile]');if(editProfile){await editLifeProfile(editProfile.dataset.editProfile);return}const editIndividual=e.target.closest('[data-edit-individual]');if(editIndividual){await editIndividualPlant(editIndividual.dataset.species,editIndividual.dataset.editIndividual);return}const edit=e.target.closest('[data-edit]');if(edit){const obs=observations.find(o=>String(o.id)===String(edit.dataset.edit));if(obs)openModal(obs);return}const del=e.target.closest('[data-delete]');if(del){const obs=observations.find(o=>String(o.id)===String(del.dataset.delete));if(!obs)return;if(confirm(`Delete the observation of ${obs.name} from ${fmtDate(obs.date)}? This cannot be undone.`)){observations=observations.filter(o=>String(o.id)!==String(obs.id));save();renderAll();closeLifeProfile();await cloudDeleteObservation(obs.id);toast('Observation deleted')}return}});
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
function setPhotoPickerStatus(text){const el=$('#photoPickerStatus');if(el){el.textContent=text||'';el.classList.toggle('hidden',!text)}}
function renderPhotoPreviews(){const grid=$('#photoPreviewGrid');if(!grid)return;grid.innerHTML=photoItems.map((p,i)=>`<div class="photo-preview-item"><button type="button" class="photo-preview-open" data-lightbox-url="${escapeAttr(p.url)}" data-lightbox-caption="Photo ${i+1}"><img src="${escapeAttr(p.url)}" alt="Selected photo ${i+1}"></button><button type="button" class="photo-remove" data-remove-photo="${i}" aria-label="Remove photo ${i+1}">×</button><span>${i+1}</span></div>`).join('');$('#photoCountLabel').textContent=`${photoItems.length} / ${MAX_PHOTOS}`;}
function compressPhotoFile(file){return new Promise((resolve,reject)=>{const img=new Image(),r=new FileReader();r.onerror=reject;r.onload=()=>{img.onload=()=>{try{const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.78))}catch(err){reject(err)}};img.onerror=reject;img.src=r.result};r.readAsDataURL(file)})}
async function addPhotoFiles(files){const available=MAX_PHOTOS-photoItems.length;if(available<=0){toast(`Maximum ${MAX_PHOTOS} photos per observation`);return}const list=[...files].filter(f=>f.type.startsWith('image/')).slice(0,available);if(!list.length)return;setPhotoPickerStatus(`Preparing ${list.length} photo${list.length===1?'':'s'}…`);for(let i=0;i<list.length;i++){setPhotoPickerStatus(`Preparing photo ${i+1} of ${list.length}…`);try{const url=await compressPhotoFile(list[i]);photoItems.push({url,path:'',id:''});renderPhotoPreviews()}catch(err){console.error(err);toast('One photo could not be prepared')}}setPhotoPickerStatus('');photoData=photoItems[0]?.url||''}
$('#takePhotoBtn').addEventListener('click',()=>$('#photoCamera').click());
$('#choosePhotosBtn').addEventListener('click',()=>$('#photoLibrary').click());
$('#photoCamera').addEventListener('change',async e=>{await addPhotoFiles(e.target.files);e.target.value=''});
$('#photoLibrary').addEventListener('change',async e=>{await addPhotoFiles(e.target.files);e.target.value=''});
$('#photoPreviewGrid').addEventListener('click',e=>{const rm=e.target.closest('[data-remove-photo]');if(!rm)return;photoItems.splice(Number(rm.dataset.removePhoto),1);photoData=photoItems[0]?.url||'';renderPhotoPreviews()});
$('#obsForm').addEventListener('submit',async e=>{
 e.preventDefault();const kind=$('#kind').value,name=$('#name').value.trim();if(!name)return;const group=kind==='Seasonal/Event'?'Seasonal':$('#group').value;
 const record={id:editingId||(currentUser?newUuid():Date.now()),kind,name,group:kind==='Seasonal/Event'?'Seasonal':$('#group').value,date:$('#date').value,time:$('#time').value,eventEndTime:kind==='Seasonal/Event'?$('#eventEndTime').value:'',zone:$('#zone').value,locationNote:$('#locationNote').value.trim(),detail:$('#detail').value,count:kind==='Seasonal/Event'?1:Number($('#count').value||1),measurement:kind==='Seasonal/Event'?$('#measurement').value:'',measurementUnit:kind==='Seasonal/Event'&&$('#measurement').value!==''?$('#measurementUnit').value:'',notes:$('#notes').value.trim(),isMilestone:$('#isMilestone').checked,milestoneType:$('#isMilestone').checked?$('#milestoneType').value:'',photos:photoItems.map(p=>({...p})),photo:photoItems[0]?.url||'',individualPlant:kind==='Plant'?$('#individualPlant').value.trim():''};
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
['#addZoneObservationTop','#addZoneObservationBottom'].forEach(sel=>{const el=$(sel);if(el)el.onclick=()=>{if(selectedZone)openModal(null,selectedZone)}});
const clearZoneBtn=$('#clearZone');
if(clearZoneBtn){
  clearZoneBtn.textContent='Back to Property';
  clearZoneBtn.setAttribute('aria-label','Back to Property');
  clearZoneBtn.onclick=()=>{selectedZone=null;$('#zoneDetail').classList.add('hidden');renderZones();const propertyView=document.querySelector('[data-view="property"]');const map=propertyView?.querySelector('.property-map-wrap');(map||propertyView)?.scrollIntoView({behavior:'smooth',block:'start'})};
}
function openLightbox(url,caption=''){if(!url)return;$('#lightboxImage').src=url;$('#lightboxCaption').textContent=caption;$('#lightboxBackdrop').classList.remove('hidden')}
function closeLightbox(){$('#lightboxBackdrop').classList.add('hidden');$('#lightboxImage').src=''}
$('#closeLightbox').onclick=closeLightbox;$('#lightboxBackdrop').addEventListener('click',e=>{if(e.target.id==='lightboxBackdrop')closeLightbox()});
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),1800)}
const now=new Date();$('#todayDate').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});$('#greeting').textContent=now.getHours()<12?'Good morning':now.getHours()<18?'Good afternoon':'Good evening';save();renderAll();
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  e.stopPropagation();
  const errorEl=$('#authError');
  errorEl.classList.add('hidden');
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
  const submit=$('#authForm button[type="submit"]');
  if(submit){submit.disabled=true;submit.textContent='Logging In…'}
  try{
    await ensureSupabaseClient();
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(!data.user)throw new Error('Login did not return a user account.');
    await handleSignedIn(data.user);
  }catch(err){
    console.error('Login failed',err);
    errorEl.textContent=err?.message||'Unable to log in. Please check your connection and try again.';
    errorEl.classList.remove('hidden');
  }finally{
    if(submit){submit.disabled=false;submit.textContent='Log In'}
  }
});
$('#syncChip').onclick=()=>$('#accountBackdrop').classList.remove('hidden');$('#closeAccount').onclick=()=>$('#accountBackdrop').classList.add('hidden');$('#accountBackdrop').addEventListener('click',e=>{if(e.target.id==='accountBackdrop')$('#accountBackdrop').classList.add('hidden')});$('#syncNow').onclick=async()=>{await refreshFromCloud();toast('Cloud sync complete')};$('#signOut').onclick=async()=>{await ensureSupabaseClient();await sb.auth.signOut();currentUser=null;$('#accountBackdrop').classList.add('hidden');$('#app').classList.add('hidden');$('#authGate').classList.remove('hidden');setSyncStatus('offline','Cloud')};$('#importLocalData').onclick=importLocalToCloud;$('#dismissImport').onclick=()=>$('#cloudImportBanner').classList.add('hidden');
window.addEventListener('online',()=>{setSyncStatus('syncing','Reconnecting…');refreshFromCloud()});window.addEventListener('offline',()=>setSyncStatus('offline','Offline'));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshFromCloud()});
initAuth();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(reg => reg.update()).catch(() => {});
  });
}
