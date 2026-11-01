'use strict';
const $=s=>document.querySelector(s), cfg=window.MT_CONFIG||{}, key='mt_session_v1';
let session=null,data=null,busy=false,current=null;
try{session=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n).toLocaleString('ar-SA');
const date=d=>d?new Date(d).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}):'—';
const role=r=>data?.me.roles.includes(r), staff=()=>role('admin')||role('attendance')||role('registration');
const labels={new:'إحالة مسبقة',attended:'حضرت / تحت الإجراء',waiting:'قائمة انتظار',paid:'مكتملة السداد'};
const state=r=>r.voided?'ملغاة':r.approved_at?'محتسبة':labels[r.status];
function notice(t){$('#notice').textContent=t;}
function save(){sessionStorage.setItem(key,JSON.stringify(session))}
async function auth(path,body){const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/'+path,{method:'POST',headers:{apikey:cfg.supabaseKey,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error_description||j.msg||'تعذر تسجيل الدخول. تحققي من البيانات.');return j;}
async function rpc(action,payload={}){
 if(!session)throw Error('سجلي الدخول أولًا.');
 if(Date.now()>((session.expires_at||0)*1000-30000)){session=await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});save();}
 const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/mt_api',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const j=await r.json();if(!r.ok)throw Error(j.code==='23505'?'رقم الجوال أو الملف أو الموعد أو الإيصال مستخدم مسبقًا.':j.message||'تعذر حفظ الإجراء.');return j;
}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{notice('');await fn();}catch(e){notice(e.message)}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
async function load(){data=await rpc('load');render();}
function render(){
 $('#login').hidden=true;$('#app').hidden=false;$('#logout').hidden=false;$('#greeting').textContent='أهلًا '+data.me.name;$('#sync').textContent='آخر تحديث: '+date(new Date());$('#closing').textContent='إقفال احتساب السداد: '+data.campaign.close_at;$('#addPanel').hidden=!role('employee');$('#admin').hidden=!role('admin');
 const own=data.referrals.filter(r=>r.employee_id===data.me.id),count=own.filter(r=>r.approved_at&&!r.voided).length,days=Math.min(2,Math.floor(count/5));
 $('#metrics').innerHTML=[['إحالاتي المسجلة',own.length,'مسجلة مسبقًا'],['تسجيلاتي المحتسبة',count,'بعد السداد والاعتماد'],['أيام الإجازة المستحقة',days,'بحد أعلى يومين'],['المتبقي لبلوغ ١٠',Math.max(0,10-count),'تسجيلات مكتملة ومحتسبة']].map(([t,n,s])=>`<article class="metric">${t}<strong>${num(n)}</strong><small>${s}</small></article>`).join('');
 renderRows();
 if(role('admin')){
 $('#balances').innerHTML='<table><thead><tr><th>الموظفة</th><th>الإحالات</th><th>الانتظار</th><th>المحتسبة</th><th>أيام الإجازة</th></tr></thead><tbody>'+data.profiles.filter(p=>p.roles.includes('employee')).map(p=>{const a=data.referrals.filter(r=>r.employee_id===p.id&&!r.voided),n=a.filter(r=>r.approved_at).length;return `<tr><td>${esc(p.name)}</td><td>${num(a.length)}</td><td>${num(a.filter(r=>r.status==='waiting').length)}</td><td>${num(n)}</td><td>${num(Math.min(2,Math.floor(n/5)))}</td></tr>`}).join('')+'</tbody></table>';
 $('#campaignForm [name=close_at]').value=data.campaign.close_at;
 }
}
function filtered(){const q=$('#search').value.trim().toLowerCase(),f=$('#filter').value;return data.referrals.filter(r=>(!q||[r.trainee,r.phone,r.code,r.employee_name].join(' ').toLowerCase().includes(q))&&(!f||(f==='approved'?r.approved_at&&!r.voided:f==='voided'?r.voided:!r.voided&&!r.approved_at&&r.status===f)));}
function renderRows(){$('#rows').innerHTML=filtered().map(r=>`<tr><td>${num(r.code)}</td><td>${esc(r.trainee)}<small dir="ltr">${esc(r.phone)}</small></td><td>${esc(r.employee_name)}</td><td>${date(r.created_at)}</td><td>${r.program?esc(r.program)+' ساعات':'—'}</td><td><span class="badge ${r.approved_at&&!r.voided?'ok':''}">${state(r)}</span></td><td><button data-id="${r.id}">فتح</button></td></tr>`).join('')||'<tr><td colspan="7">لا توجد إحالات مطابقة.</td></tr>';}
function show(id){current=data.referrals.find(r=>r.id===id);const r=current;let html=`<h2>إحالة رقم ${num(r.code)}</h2><p>${esc(r.trainee)} | <bdi>${esc(r.phone)}</bdi><br>صاحبة الإحالة: <b>${esc(r.employee_name)}</b><br>وقت التسجيل: ${date(r.created_at)}<br>الحالة: ${state(r)}</p><p>الحضور: ${date(r.attendance_at)}<br>رقم الملف: ${esc(r.file_no||'—')}<br>موعد أبشر: ${esc(r.appointment||'—')}<br>السداد: ${esc(r.paid_on||'—')} | الإيصال: ${esc(r.payment_ref||'—')}<br>الاعتماد: ${date(r.approved_at)}</p>`;
 if(!r.voided&&!r.attendance_at&&(role('attendance')||role('admin')))html+=`<h3>تأكيد الحضور</h3><form id="attendForm"><label>رقم الملف<input name="file_no" required></label><label>رقم موعد أبشر<input name="appointment" required></label><label class="check"><input type="checkbox" name="confirmed" required>طابقت الاسم والجوال، وأكدت المتقدمة صاحبة الإحالة، ولم يسبق لها التقييم في المدرسة.</label><button class="primary">تأكيد حضورها الآن</button></form>`;
 if(!r.voided&&r.attendance_at&&!r.approved_at&&(role('registration')||role('admin')))html+=`<h3>التسجيل والسداد</h3><form id="registrationForm"><label>البرنامج<select name="program" required><option value="6">٦ ساعات</option><option value="15">١٥ ساعة</option><option value="30">٣٠ ساعة</option><option value="other">غيره</option></select></label><label>الحالة<select name="status"><option value="attended">تحت الإجراء</option><option value="waiting">قائمة انتظار — دون سداد</option><option value="paid">مكتملة التسجيل والسداد</option></select></label><label>تاريخ السداد<input name="paid_on" type="date"></label><label>رقم الإيصال<input name="payment_ref"></label><p>عند اختيار الانتظار، لا يُسجل أي سداد ولا يُحتسب الحافز.</p><button class="primary">حفظ التسجيل</button></form>`;
 if(role('admin')){
 if(r.status==='paid'&&!r.approved_at&&!r.voided)html+='<button id="approve" class="primary">اعتماد الاحتساب بعد التحقق من السداد</button>';
 html+=`<h3>تصحيح إداري موثق</h3><form id="correctForm"><label>الموظفة المحيلة<select name="employee_id">${data.profiles.filter(p=>p.active&&p.roles.includes('employee')).map(p=>`<option value="${p.id}" ${p.id===r.employee_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>سبب التصحيح<input name="reason" required minlength="5"></label><label class="check"><input name="voided" type="checkbox" ${r.voided?'checked':''}>إلغاء الإحالة من الاحتساب</label><p>كل تصحيح يلغي الاعتماد السابق ويتطلب مراجعة واعتمادًا جديدًا.</p><button>حفظ التصحيح</button></form><h3>سجل الإجراءات</h3><button id="audit">عرض السجل</button><div id="auditBody"></div>`;
 }
 $('#detailBody').innerHTML=html;if(!$('#detail').open)$('#detail').showModal();
 if($('#registrationForm')){const f=$('#registrationForm');f.program.value=r.program||'6';f.status.value=r.status==='paid'?'paid':r.status==='waiting'?'waiting':'attended';f.paid_on.value=r.paid_on||'';f.payment_ref.value=r.payment_ref||'';f.onsubmit=e=>submitAction(e,'registration',f)}
 if($('#attendForm'))$('#attendForm').onsubmit=e=>submitAction(e,'attend',$('#attendForm'));
 if($('#correctForm'))$('#correctForm').onsubmit=e=>submitAction(e,'correct',$('#correctForm'));
 if($('#approve'))$('#approve').onclick=()=>run(async()=>{await rpc('approve',{id:r.id});await load();$('#detail').close();notice('تم اعتماد الإحالة وتحديث الرصيد.');});
 if($('#audit'))$('#audit').onclick=()=>run(async()=>{const a=await rpc('audit',{id:r.id});$('#auditBody').innerHTML=a.map(x=>`<div class="audit">${date(x.at)} · ${esc(x.actor_name||x.actor)} · ${esc(({add:'تسجيل إحالة',attend:'تأكيد حضور',registration:'تحديث التسجيل',approve:'اعتماد',correct:'تصحيح إداري'})[x.action]||x.action)}<br>${esc(x.reason||'')}<br>قبل: ${esc(JSON.stringify(x.before_data))}<br>بعد: ${esc(JSON.stringify(x.after_data))}</div>`).join('');});
}
function fields(f){const p=Object.fromEntries(new FormData(f));for(const x of f.querySelectorAll('input[type=checkbox]'))p[x.name]=x.checked;return p;}
function submitAction(e,action,f){e.preventDefault();run(async()=>{await rpc(action,{id:current.id,...fields(f)});await load();$('#detail').close();notice('تم حفظ الإجراء.');});}
$('#loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{if(!cfg.supabaseUrl||!cfg.supabaseKey)throw Error('الصفحة جاهزة، وتحتاج ربط Supabase في config.js قبل الاستخدام.');session=await auth('token?grant_type=password',fields(e.target));save();await load();e.target.reset();});};
$('#addForm').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await rpc('add',fields(e.target));e.target.reset();await load();notice('تم تثبيت الإحالة رقم '+num(r.code)+' باسمك ووقت إرسالها.');});};
$('#logout').onclick=()=>run(async()=>{try{await fetch(cfg.supabaseUrl+'/auth/v1/logout',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+session.access_token}})}finally{session=null;data=null;sessionStorage.removeItem(key);$('#app').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;notice('تم تسجيل الخروج.');}});
$('#refresh').onclick=()=>run(load);$('#search').oninput=renderRows;$('#filter').onchange=renderRows;
$('#rows').onclick=e=>{const b=e.target.closest('[data-id]');if(b)show(b.dataset.id);};$('#closeDialog').onclick=()=>$('#detail').close();
$('#campaignForm').onsubmit=e=>{e.preventDefault();run(async()=>{await rpc('campaign',fields(e.target));await load();notice('تم تحديث تاريخ الإقفال.');});};
$('#export').onclick=()=>{const clean=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['رقم الإحالة','المتقدمة','الجوال','الموظفة','التسجيل المسبق','الحالة','تاريخ السداد'],...filtered().map(r=>[r.code,r.trainee,r.phone,r.employee_name,r.created_at,state(r),r.paid_on])];const blob=new Blob(['\ufeff'+rows.map(r=>r.map(clean).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Min_Tarafik.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
if(session&&cfg.supabaseUrl&&cfg.supabaseKey)run(load);
// الاستعلام الدوري يعرض التعديلات المشتركة دون نقل صلاحيات إلى المتصفح.
setInterval(()=>{if(session&&data&&!busy&&!$('#detail').open&&!document.hidden)run(load)},30000);
