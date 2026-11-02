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
 const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/mt_api',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const j=await r.json();if(!r.ok)throw Error(j.code==='23505'?'رقم الجوال أو الهوية أو الفاتورة مستخدم مسبقًا.':j.message||'تعذر حفظ الإجراء.');return j;
}
async function run(fn){if(busy)return;busy=true;const priorButtons=Array.from(document.querySelectorAll('button')).map(b=>[b,b.disabled]);priorButtons.forEach(([b])=>b.disabled=true);try{notice('');await fn();}catch(e){notice(e.message)}finally{busy=false;priorButtons.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled})}}
async function load(){data=await rpc('load');render();}
function render(){
 $('#login').hidden=true;$('#app').hidden=false;$('#logout').hidden=false;$('#greeting').textContent='أهلًا '+data.me.name;$('#sync').textContent='آخر تحديث: '+date(new Date());$('#closing').textContent='إقفال احتساب السداد: '+data.campaign.close_at;$('#addPanel').hidden=!role('employee')||earnedCount(data.me.id)>=10;$('#admin').hidden=!role('admin');
 const own=data.referrals.filter(r=>r.employee_id===data.me.id),count=own.filter(r=>r.approved_at&&!r.voided).length,days=Math.min(2,Math.floor(count/5));
 $('#metrics').innerHTML=[['إحالاتي المسجلة',own.length,'مسجلة مسبقًا'],['تسجيلاتي المحتسبة',count,'بعد السداد والاعتماد'],['أيام الإجازة المتبقية',Math.max(0,days-(data.me.leave_used||0)),'المستحق '+num(days)+' · المستخدم '+num(data.me.leave_used||0)],[count>=10?'المشاركة مكتملة':'المتبقي لبلوغ ١٠',Math.max(0,10-count),count>=10?'اكتملت ١٠ إحالات معتمدة':'تسجيلات مكتملة ومحتسبة']].map(([t,n,s])=>`<article class="metric">${t}<strong>${num(n)}</strong><small>${s}</small></article>`).join('');
 renderRows();
 setupViews();
 if(role('admin')){
 renderBalances();
 scheduleRewardMail();
 $('#campaignForm [name=close_at]').value=data.campaign.close_at;
 }
}

let balanceView='active',mailBusy=false,lastMailCheck=0;
function earnedCount(id){return data.referrals.filter(r=>r.employee_id===id&&!r.voided&&r.approved_at).length;}
function eligibleBalance(p){return p.active&&!p.deleted_at&&p.roles.includes('employee');}
function renderBalances(){
 const profiles=data.profiles.filter(eligibleBalance).filter(p=>balanceView==='all'||(balanceView==='complete'?earnedCount(p.id)>=10:earnedCount(p.id)<10));
 $('#balances').innerHTML=`<label>عرض المشاركات<select id="balanceFilter"><option value="active">المشاركة فعالة</option><option value="complete">مكتملة: ١٠ إحالات</option><option value="all">الفعالات والمكتملات</option></select></label><p>اكتمال المشاركة يوقف إضافة إحالات جديدة، ولا يوقف حساب الدخول. الحسابات المحذوفة والموقوفة مستبعدة من الأرصدة.</p><button id="retryRewardMail" type="button">معالجة إشعارات الرصيد المعلقة</button><p id="rewardMailStatus" role="status"></p><table><thead><tr><th>الموظفة</th><th>المشاركة</th><th>المحتسبة</th><th>المستحق</th><th>المستخدم</th><th>المتبقي</th><th>الاستنفاذ</th></tr></thead><tbody>${profiles.map(p=>{
 const n=earnedCount(p.id),earned=Math.min(2,Math.floor(n/5)),used=p.leave_used||0,left=Math.max(0,earned-used);
 return `<tr><td>${esc(p.name)}<small dir="ltr">${esc(p.email||'')}</small></td><td>${n>=10?'مكتملة: ١٠ إحالات':'فعالة'}</td><td>${num(n)}</td><td>${num(earned)}</td><td><select data-use-leave="${p.id}" aria-label="الأيام المستخدمة للموظفة ${esc(p.name)}">${Array.from({length:Math.max(earned,used)+1},(_,i)=>`<option value="${i}" ${i===used?'selected':''} ${i>earned?'disabled':''}>${num(i)}</option>`).join('')}</select><button data-save-leave="${p.id}">حفظ</button></td><td>${num(left)}</td><td>${used>earned?'يلزم مراجعة: المستخدم أكبر من الاستحقاق':earned===0?'لا يوجد رصيد':left===0?'تم الاستنفاذ':used?'مستنفذ جزئيًا':'لم يُستنفذ'}</td></tr>`;
 }).join('')||'<tr><td colspan="7">لا توجد مشاركات في هذا العرض.</td></tr>'}</tbody></table>`;
 $('#balanceFilter').value=balanceView;$('#balanceFilter').onchange=e=>{balanceView=e.target.value;renderBalances();};
 $('#balances').onclick=e=>{const b=e.target.closest('[data-save-leave]');if(!b)return;run(async()=>{const id=b.dataset.saveLeave,days=$('#balances').querySelector(`[data-use-leave="${id}"]`).value;await rpc('leave_used',{employee_id:id,days});await load();notice('تم حفظ الأيام المستخدمة والمتبقية.');});};
 $('#retryRewardMail').onclick=()=>processRewardMail(true);
}
async function processRewardMail(manual=false){
 if(mailBusy||!session||!role('admin'))return;mailBusy=true;lastMailCheck=Date.now();
 try{const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/functions/v1/reward-notifications',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});const j=await r.json();if(!r.ok)throw Error(j.error||'تعذر إرسال إشعارات الرصيد.');if($('#rewardMailStatus'))$('#rewardMailStatus').textContent=j.message+(j.sent?' عدد الرسائل المقبولة: '+num(j.sent):'');}
 catch(e){if(manual&&$('#rewardMailStatus'))$('#rewardMailStatus').textContent=e.message;}
 finally{mailBusy=false;}
}
function scheduleRewardMail(){if(Date.now()-lastMailCheck>60000)setTimeout(()=>processRewardMail(),0);}

function filtered(){const q=$('#search').value.trim().toLowerCase(),f=$('#filter').value;return data.referrals.filter(r=>(!q||[r.trainee,r.identity_name,staff()?r.national_id:'',r.phone,r.code,r.employee_name].join(' ').toLowerCase().includes(q))&&(!f||(f==='unpaid'?r.attendance_at&&r.status!=='paid'&&!r.voided:f==='unchecked'?r.attendance_at&&r.status!=='paid'&&!r.voided&&!r.payment_checked_at:f==='approved'?r.approved_at&&!r.voided:f==='voided'?r.voided:!r.voided&&!r.approved_at&&r.status===f)));}
function renderRows(){$('#rows').innerHTML=filtered().map(r=>`<tr><td>${num(r.code)}</td><td>${esc(r.trainee)}<small dir="ltr">${esc(r.phone)}</small></td><td>${esc(r.employee_name)}</td><td>${date(r.created_at)}</td><td>${r.program?esc(r.program)+' ساعات':'لم يُحدد بعد'}</td><td><span class="badge ${r.approved_at&&!r.voided?'ok':''}">${state(r)}</span></td><td><button data-id="${r.id}">فتح</button></td></tr>`).join('')||'<tr><td colspan="7">لا توجد إحالات مطابقة.</td></tr>';}
function show(id){current=data.referrals.find(r=>r.id===id);const r=current;let html=`<h2>إحالة رقم ${num(r.code)}</h2><p>${esc(r.trainee)} | <bdi>${esc(r.phone)}</bdi><br>صاحبة الإحالة: <b>${esc(r.employee_name)}</b><br>وقت التسجيل: ${date(r.created_at)}<br>الحالة: ${state(r)}</p><div class="audit">الحضور: ${r.attendance_at?date(r.attendance_at):'لم يُؤكد بعد'}<br>الاسم حسب الهوية: ${esc(r.identity_name||'يُسجل عند الحضور')}<br>${staff()?`رقم الهوية: <bdi>${esc(r.national_id||'لم يُسجل بعد')}</bdi><br>`:''}البرنامج: ${r.program?esc(r.program)+' ساعات':'لم يُحدد بعد'}<br>السداد: ${r.paid_on?esc(r.paid_on):'لم يُوثق بعد'}<br>الفاتورة: ${esc(r.payment_ref||'لم يُسجل بعد')}<br>الاعتماد: ${r.approved_at?date(r.approved_at):r.status==='paid'?'بانتظار مراجعة الإدارة':'بعد اكتمال التسجيل والسداد'}</div>`;
 if(staff()&&r.attendance_at){html+=`<h3>متابعة السداد في نظام الفواتير</h3><p>${r.payment_checked_at?'آخر تحقق: '+esc(date(r.payment_checked_at))+' · '+esc(data.profiles.find(p=>p.id===r.payment_checked_by)?.name||'المختصة'):'لم يُسجل تحقق من السداد بعد.'}</p>${r.national_id?'<button id="copyIdentity" type="button">نسخ الهوية للبحث في نظام الفواتير</button>':'<p>رقم الهوية غير موثق لهذه الإحالة القديمة؛ ابحثي بالجوال في نظامكم.</p>'}${!r.voided&&r.status!=='paid'&&(role('admin')||role('registration'))?'<p>بعد البحث في النظام الآخر: إن كانت الفاتورة مسددة، وثقيها في نموذج التسجيل أدناه. وإلا سجلي التحقق:</p><button id="checkUnpaid" type="button">تم التحقق ولم تسدد</button>':''}`;}
 if(!r.voided&&!r.attendance_at&&(role('attendance')||role('admin')))html+=`<h3>تأكيد الحضور</h3><form id="attendForm"><p>ابحثي بالجوال المسجل في الإحالة وطابقيه مع بيانات موعد أبشر، ثم أدخلي بيانات صاحبة الموعد حسب الهوية. اختلاف إملاء الاسم وحده لا يمنع التأكيد.</p><label>الاسم حسب الهوية<input name="identity_name" required minlength="3" maxlength="160"></label><label>رقم هوية المتقدمة أو الإقامة<input name="national_id" inputmode="numeric" dir="ltr" required pattern="[0-9٠-٩]{10}" minlength="10" maxlength="10"></label><label class="check"><input type="checkbox" name="confirmed" required>طابقت الجوال مع موعد أبشر وتحققت من هوية صاحبة الموعد، وأكدت المتقدمة الموظفة المحيلة، ولم يسبق لها التقييم في المدرسة.</label><button class="primary">تأكيد حضورها الآن</button></form>`;
 if(!r.voided&&r.attendance_at&&!r.approved_at&&(role('registration')||role('admin')))html+=`<h3>التسجيل والسداد</h3><form id="registrationForm"><label>البرنامج<select name="program" required><option value="6">٦ ساعات</option><option value="15">١٥ ساعة</option><option value="30">٣٠ ساعة</option><option value="other">غيره</option></select></label><label>الحالة<select name="status"><option value="attended">تحت الإجراء</option><option value="waiting">قائمة انتظار — دون سداد</option><option value="paid">مكتملة التسجيل والسداد</option></select></label><label>تاريخ السداد<input name="paid_on" type="date"></label><label>رقم الفاتورة<input name="payment_ref"></label><p>عند اختيار الانتظار، لا يُسجل أي سداد ولا يُحتسب الحافز.</p><button class="primary">حفظ التسجيل</button></form>`;
 if(role('admin')){
 if(r.status==='paid'&&!r.approved_at&&!r.voided)html+='<button id="approve" class="primary">اعتماد الاحتساب بعد التحقق من السداد</button>';
 html+=`<h3>تصحيح إداري موثق</h3><form id="correctForm"><label>الموظفة المحيلة<select name="employee_id">${data.profiles.filter(p=>p.active&&p.roles.includes('employee')).map(p=>`<option value="${p.id}" ${p.id===r.employee_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>سبب التصحيح<input name="reason" required minlength="5"></label><label class="check"><input name="voided" type="checkbox" ${r.voided?'checked':''}>إلغاء الإحالة من الاحتساب</label><p>كل تصحيح يلغي الاعتماد السابق ويتطلب مراجعة واعتمادًا جديدًا.</p><button>حفظ التصحيح</button></form><h3>سجل الإجراءات</h3><button id="audit">عرض السجل</button><div id="auditBody"></div>`;
 }
 $('#detailBody').innerHTML=html;if(!$('#detail').open)$('#detail').showModal();
 if($('#copyIdentity'))$('#copyIdentity').onclick=async()=>{try{await navigator.clipboard.writeText(r.national_id);$('#copyIdentity').textContent='تم نسخ الهوية';}catch{$('#copyIdentity').outerHTML='<p>تعذر النسخ التلقائي. حددي رقم الهوية الظاهر أعلاه وانسخيه.</p>';}};
 if($('#checkUnpaid'))$('#checkUnpaid').onclick=()=>run(async()=>{await rpc('check_payment',{id:r.id});await load();show(r.id);notice('تم تسجيل التحقق: لم تسدد حتى وقت المراجعة.');});
 if($('#registrationForm')){const f=$('#registrationForm');f.program.value=r.program||'6';f.status.value=r.status==='paid'?'paid':r.status==='waiting'?'waiting':'attended';f.paid_on.value=r.paid_on||'';f.payment_ref.value=r.payment_ref||'';f.onsubmit=e=>submitAction(e,'registration',f)}
 if($('#attendForm'))$('#attendForm').onsubmit=e=>submitAction(e,'attend',$('#attendForm'));
 if($('#correctForm'))$('#correctForm').onsubmit=e=>submitAction(e,'correct',$('#correctForm'));
 if($('#approve'))$('#approve').onclick=()=>run(async()=>{await rpc('approve',{id:r.id});await load();$('#detail').close();notice('تم اعتماد الإحالة وتحديث الرصيد.');await processRewardMail(true);});
 if($('#audit'))$('#audit').onclick=()=>run(async()=>{const a=await rpc('audit',{id:r.id});$('#auditBody').innerHTML=a.map(renderAudit).join('')||'<p>لم تُسجل إجراءات بعد.</p>';});
}

const auditFields={payment_checked_at:'وقت التحقق من السداد',payment_checked_by:'مختصة متابعة السداد',trainee:'اسم المتقدمة في الإحالة',phone:'الجوال',identity_name:'الاسم حسب الهوية',national_id:'رقم الهوية أو الإقامة',employee_id:'الموظفة المحيلة',attendance_at:'وقت تأكيد الحضور',attended_by:'مؤكدة الحضور',program:'البرنامج',status:'الحالة',registered_by:'مسؤولة التسجيل',paid_on:'تاريخ السداد',payment_ref:'رقم الفاتورة',approved_at:'وقت الاعتماد',approved_by:'مسؤولة الاعتماد',voided:'إلغاء الإحالة',consent:'موافقة المتقدمة',created_at:'وقت تسجيل الإحالة'};
function auditValue(k,v){
 if(v===null||v===undefined||v==='')return 'غير مسجل';
 if(k==='status')return labels[v]||'غير محدد';
 if(k==='program')return v==='other'?'برنامج آخر':num(v)+' ساعات';
 if(k==='voided'||k==='consent')return v?'نعم':'لا';
 if(['employee_id','attended_by','registered_by','approved_by','payment_checked_by'].includes(k))return data.profiles.find(p=>p.id===v)?.name||'حساب سابق';
 if(k.endsWith('_at'))return date(v);
 return String(v);
}
function renderAudit(x){
 const before=x.before_data||{},after=x.after_data||{};
 const changed=Object.entries(auditFields).filter(([k])=>JSON.stringify(before[k]??null)!==JSON.stringify(after[k]??null));
 const title=({add:'تسجيل إحالة',attend:'تأكيد الحضور',registration:'تحديث التسجيل والسداد',check_payment:'التحقق من السداد: لم تسدد',approve:'اعتماد الاحتساب',correct:'تصحيح إداري'})[x.action]||'تحديث البيانات';
 return `<article class="audit" style="overflow-wrap:anywhere"><b>${esc(title)}</b><br><small>${esc(date(x.at))} · ${esc(x.actor_name||'حساب سابق')}</small>${x.reason?`<p>السبب: ${esc(x.reason)}</p>`:''}${changed.length?`<table style="width:100%;table-layout:fixed;white-space:normal"><thead><tr><th>البيان</th><th>قبل</th><th>بعد</th></tr></thead><tbody>${changed.map(([k,label])=>`<tr><td>${esc(label)}</td><td>${esc(auditValue(k,before[k]))}</td><td>${esc(auditValue(k,after[k]))}</td></tr>`).join('')}</tbody></table>`:'<p>لا توجد تغييرات في الحقول المعروضة.</p>'}</article>`;
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

// الاستعلام الدوري يعرض التعديلات المشتركة دون نقل صلاحيات إلى المتصفح.
setInterval(()=>{if(session&&data&&!busy&&!$('#detail').open&&!document.hidden&&activeView!=='team')run(load)},30000);

// استعادة كلمة المرور: رموز الرابط لا تحفظ في الملفات أو السجل المحلي.
let recoveryToken=null;
const hashParams=new URLSearchParams(location.hash.slice(1));
const queryParams=new URLSearchParams(location.search);
const tokenHash=queryParams.get('token_hash');
const linkType=tokenHash?queryParams.get('type'):hashParams.get('type');
const recovering=['recovery','invite'].includes(linkType);
function authError(j){
 if(j.error_code==='over_email_send_rate_limit'||j.code==='over_email_send_rate_limit')return 'وصل إرسال البريد إلى الحد المسموح. انتظري ثم أعيدي المحاولة، أو راجعي إعداد SMTP في Supabase.';
 return j.error_description||j.msg||j.message||'تعذر إكمال الطلب. أعيدي المحاولة.';
}
$('#forgot').onclick=()=>run(async()=>{
 const email=$('#loginForm [name=email]').value.trim();
 if(!email||!$('#loginForm [name=email]').checkValidity())throw Error('اكتبي بريد حساب المبادرة في خانة البريد أولًا.');
 if(!cfg.supabaseUrl||!cfg.supabaseKey)throw Error('يلزم إكمال إعداد الاتصال أولًا.');
 const redirect=location.origin+location.pathname;
 const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/recover?redirect_to='+encodeURIComponent(redirect),{method:'POST',headers:{apikey:cfg.supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({email})});
 const j=await r.json();if(!r.ok)throw Error(authError(j));
 notice('إذا كان البريد مرتبطًا بحساب، ستصلك رسالة استعادة. افتحي أحدث رسالة وتحققي من البريد غير المرغوب فيه.');
});
$('#recoveryForm').onsubmit=e=>{e.preventDefault();run(async()=>{
 const f=e.target,password=f.new_password.value;
 if(password!==f.confirm_password.value)throw Error('كلمتا المرور غير متطابقتين.');
 if(password.length<8)throw Error('استخدمي ٨ أحرف على الأقل.');
 if(!recoveryToken)throw Error('رابط الاستعادة غير صالح. اطلبي رسالة جديدة.');
 const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/user',{method:'PUT',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+recoveryToken,'Content-Type':'application/json'},body:JSON.stringify({password})});
 const j=await r.json();if(!r.ok)throw Error(authError(j));
 try{await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/logout',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+recoveryToken}})}catch{}
 recoveryToken=null;session=null;data=null;sessionStorage.removeItem(key);f.reset();$('#recovery').hidden=true;$('#login').hidden=false;
 notice('تم تغيير كلمة المرور. سجّلي الدخول الآن بالبريد وكلمة المرور الجديدة.');
});};
async function initialize(){
 if(recovering){
  let token=hashParams.get('access_token');
  history.replaceState(null,'',location.pathname);
  if(tokenHash){
   // رابط البريد على دومين الموقع نفسه: نتحقق من الرمز هنا بدل رابط supabase.co
   const v=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/verify',{method:'POST',headers:{apikey:cfg.supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({type:linkType,token_hash:tokenHash})});
   const vj=await v.json().catch(()=>({}));
   if(!v.ok||!vj.access_token){$('#login').hidden=false;throw Error('رابط التعيين منتهي أو سبق استخدامه. اطلبي رسالة جديدة.');}
   token=vj.access_token;
  }
  session=null;data=null;sessionStorage.removeItem(key);$('#login').hidden=true;$('#app').hidden=true;$('#logout').hidden=true;
  if(!token){$('#login').hidden=false;throw Error('رابط الاستعادة غير مكتمل. اطلبي رسالة جديدة.');}
  const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+token}});
  if(!r.ok){$('#login').hidden=false;throw Error('رابط الاستعادة منتهي أو غير صالح. اطلبي رسالة جديدة.');}
  recoveryToken=token;$('#recovery').hidden=false;notice('تم التحقق من الرابط. عيّني كلمة مرور جديدة.');
 }else if(hashParams.has('error')){
  history.replaceState(null,'',location.pathname+location.search);throw Error('رابط الاستعادة غير صالح أو سبق استخدامه. اطلبي رسالة جديدة.');
 }else if(session&&cfg.supabaseUrl&&cfg.supabaseKey)await load();
}


let activeView='overview',staffRows=[];
const roleNames={employee:'مشاركة في المبادرة',attendance:'تأكيد الحضور',registration:'التسجيل والسداد',admin:'إدارة واعتماد'};
function setupViews(){
 document.querySelectorAll('.adminOnly').forEach(x=>x.hidden=!role('admin'));
 if(!role('admin')&&['team','settings'].includes(activeView))activeView='overview';
 document.querySelectorAll('[data-screen]').forEach(x=>x.hidden=x.dataset.screen!==activeView);
 document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x.dataset.view===activeView));
}
async function switchView(view){activeView=view;setupViews();if(view==='team')await reloadStaff();}
async function staffApi(action,payload={}){
 if(!session)throw Error('سجلي الدخول أولًا.');
 if(Date.now()>((session.expires_at||0)*1000-30000)){session=await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});save();}
 let response;try{response=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+'/functions/v1/manage-staff',{method:'POST',headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});}catch{throw Error('تعذر الاتصال بإدارة المنسوبات. تحققي من نشر وظيفة manage-staff في Supabase.');}
 const j=await response.json();if(!response.ok)throw Error(j.error||'يلزم تفعيل وظيفة إدارة المنسوبات وملف التحديث في Supabase.');return j;
}
async function reloadStaff(){
 try{const j=await staffApi('list');staffRows=j.profiles;renderStaff();}catch(e){$('#staffList').innerHTML='<div class="emptyState"><h3>إدارة المنسوبات تحتاج التفعيل</h3><p>'+esc(e.message)+'</p><small>اتبعي خطوات ملف تفعيل الإدارة المرفق مع التحديث.</small></div>';throw e;}
}
function renderStaff(){
 const q=$('#staffSearch').value.trim().toLowerCase();
 $('#staffSummary').innerHTML=`<span><b>${num(staffRows.length)}</b> منسوبة</span><span><b>${num(staffRows.filter(p=>p.active).length)}</b> حساب فعّال</span><span><b>${num(staffRows.filter(p=>!p.active).length)}</b> حساب موقوف</span>`;
 $('#staffList').innerHTML=staffRows.filter(p=>(p.name+' '+(p.email||'')).toLowerCase().includes(q)).map(p=>`<article class="staffCard"><div class="staffTop"><div class="avatar">${esc(p.name.slice(0,1))}</div><span class="badge ${p.active?'ok':''}">${p.active?'فعّال':'موقوف'}</span></div><h3>${esc(p.name)}</h3><p class="staffEmail" dir="ltr">${esc(p.email||'البريد غير مسجل')}</p><div class="roleChips">${p.roles.map(r=>'<span>'+esc(roleNames[r]||r)+'</span>').join('')}</div><small>${p.invited_at?'آخر إرسال: '+date(p.invited_at):'لم يرسل رابط تعيين من لوحة الإدارة بعد'}</small><div class="staffActions"><button data-edit-staff="${p.id}">تعديل بيانات الحساب</button><button class="danger" data-delete-staff="${p.id}">حذف الحساب</button><button data-send-staff="${p.id}" ${p.active?'':'disabled'}>إرسال رابط التعيين</button></div></article>`).join('')||'<div class="emptyState">لا توجد منسوبات مطابقات للبحث.</div>';
}
function staffDialog(id){
 const p=staffRows.find(x=>x.id===id),editing=!!p;
 $('#detailBody').innerHTML=`<h2>${editing?'تعديل بيانات الحساب':'إضافة موظفة جديدة'}</h2><p>${editing?'عدّلي الاسم وبريد الدخول والصلاحيات وحالة الحساب. تغيير البريد لا يرسل رسالة تلقائيًا؛ استخدمي إرسال رابط التعيين بعد الحفظ.':'أضيفي بياناتها، وسيصلها رابط لتعيين كلمة المرور بنفسها.'}</p><form id="staffForm"><label>اسم الموظفة<input name="name" minlength="2" maxlength="120" required value="${esc(p?.name||'')}"></label><label>البريد الإلكتروني — اسم الدخول<input name="email" type="email" dir="ltr" required  value="${esc(p?.email||'')}"></label><fieldset class="roleOptions"><legend>صلاحيات الحساب</legend>${Object.entries(roleNames).map(([r,n])=>`<label class="roleOption"><input type="checkbox" name="staff_role" value="${r}" ${(p?p.roles.includes(r):r==='employee')?'checked':''}><span><b>${n}</b><small>${{employee:'إضافة إحالاتها ومتابعة رصيدها فقط',attendance:'مطابقة الإحالات وتأكيد الحضور دون تغيير المحيلة',registration:'تحديث البرنامج وحالة السداد دون تغيير المحيلة',admin:'جميع الإحالات والاعتماد وإدارة حسابات المنسوبات'}[r]}</small></span></label>`).join('')}</fieldset>${editing?`<label class="check"><input type="checkbox" name="active" ${p.active?'checked':''}>الحساب فعّال</label><p>إيقاف الحساب يمنع الوصول للبيانات ويحافظ على سجل الإحالات.</p>`:''}<button class="primary">${editing?'حفظ التعديلات':'إضافة الحساب وإرسال رابط التعيين'}</button></form>`;
 if(!$('#detail').open)$('#detail').showModal();
 $('#staffForm').onsubmit=e=>{e.preventDefault();run(async()=>{
  const f=e.target,roles=Array.from(f.querySelectorAll('[name=staff_role]:checked')).map(x=>x.value);
  if(!roles.length)throw Error('اختاري صلاحية واحدة على الأقل.');
  const j=await staffApi(editing?'update':'invite',{id:p?.id,name:f.elements.name.value,email:f.elements.email.value,roles,active:editing?f.elements.active.checked:true});
  $('#detail').close();await load();await reloadStaff();notice(j.message||'تم الحفظ.');
 });};
}
$('.appNav').onclick=e=>{const b=e.target.closest('[data-view]');if(b)run(()=>switchView(b.dataset.view));};
$('#addStaff').onclick=()=>staffDialog();$('#reloadStaff').onclick=()=>run(reloadStaff);$('#staffSearch').oninput=renderStaff;
$('#staffList').onclick=e=>{const edit=e.target.closest('[data-edit-staff]'),send=e.target.closest('[data-send-staff]');if(edit)staffDialog(edit.dataset.editStaff);const del=e.target.closest('[data-delete-staff]');if(del)run(async()=>{const p=staffRows.find(x=>x.id===del.dataset.deleteStaff);if(!confirm('حذف حساب '+p.name+'؟ سيُمنع الدخول وتحذف من عرض الأرصدة، وتبقى الإحالات للأرشفة.'))return;const j=await staffApi('delete',{id:p.id});await reloadStaff();await load();notice(j.message);});if(send)run(async()=>{const j=await staffApi('resend',{id:send.dataset.sendStaff});await reloadStaff();notice(j.message);});};
run(initialize);
