const $=s=>document.querySelector(s), app=$('#app');
const labels={
  pending:'待审批', approved:'已通过', rejected:'不通过', returned:'退回修改', supplement_required:'待补充材料', reported:'突发报备'
};
let state={
  me:null, balances:[], policies:[], page:'home', requests:[], filter:'all', unread:0, notificationTimer:null
};
function employeePolicyVisible(p){
  if(p.application_required===false)return false;
  if(p.leave_type==='陪产假')return state.me?.gender==='男';
  if(p.leave_type==='产假'||p.leave_type==='奖励假')return state.me?.gender==='女';
  return true
}
async function api(url, opt={}){
  let r=await fetch(url, {headers:{'Content-Type':'application/json'}, ...opt});
  let d=await r.json();
  if(!r.ok)throw Error(d.error||d.detail||'操作失败');
  return d
}
function toast(msg, bad=false){
  let t=$('#toast');
  t.textContent=msg;
  t.style.cssText=`position:fixed;right:22px;top:20px;z-index:20;background:${bad?'#c63d44':'#16865b'};color:white;padding:12px 18px;border-radius:9px`;
  setTimeout(()=>t.style.display='none', 2600);
  t.style.display='block'
}
function login(){
  app.innerHTML=`<section class="login-shell"><div class="brand-panel"><div class="brand-mark">OA · 请假系统</div><div><h1>让每一次休假<br>清楚、有序、可追踪</h1><p>统一提交请假、材料补交、突发报备与审批记录。</p></div><small>内部系统 · 请妥善保管账号信息</small></div><div class="login-panel"><div class="auth-card"><h2>欢迎使用请假系统</h2><div class="auth-tabs"><button class="active" data-tab="login">账号登录</button><button data-tab="register">新员工注册</button></div><form id="auth"><div id="extra"></div><div class="field"><label>账号</label><input name="username" required placeholder="请输入账号"></div><div class="field"><label>密码</label><input name="password" type="password" required placeholder="请输入密码"></div><button class="btn btn-primary full">登录</button></form><p class="hint">演示员工：employee / 123456<br>演示审批员：approver / 123456</p></div></div></section>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');let reg=b.dataset.tab==='register';$('#extra').innerHTML=reg?`<div class="two"><div class="field"><label>姓名</label><input name="name" required></div><div class="field"><label>性别</label><select name="gender"><option>女</option><option>男</option><option>其他</option></select></div></div><div class="two"><div class="field"><label>年龄</label><input name="age" type="number"></div><div class="field"><label>本单位工龄</label><input name="unit_years" type="number" step="0.5"></div></div><div class="field"><label>连续工龄</label><input name="continuous_years" type="number" step="0.5"></div>`:'';$('#auth button').textContent=reg?'注册账号':'登录';$('#auth').dataset.mode=reg?'register':'login'});
  $('#auth').onsubmit=async e=>{
    e.preventDefault();
    let data=Object.fromEntries(new FormData(e.target));
    try{
      if(e.target.dataset.mode==='register'){
        await api('/api/register', {method:'POST', body:JSON.stringify(data)});
        toast('注册成功，请登录');
        document.querySelector('[data-tab=login]').click()
      }else{
        await api('/api/login', {method:'POST', body:JSON.stringify(data)});
        boot()
      }
    }catch(x){
      toast(x.message, true)
    }
  };
}
async function boot(){
  try{
    let [d, p, n]=await Promise.all([api('/api/me'), api('/api/policies'), api('/api/notifications/unread-count')]);
    state.me=d.user;
    state.policies=p.policies;
    state.unread=n.unread;
    state.balances=d.balances.filter(x=>state.policies.some(y=>y.leave_type===x.leave_type&&employeePolicyVisible(y)));
    shell();
    const requestId=new URLSearchParams(location.search).get('request');
    if(requestId){
      await showDetailOnly(Number(requestId));
    }else{
      navigate(state.me.role==='approver'?'admin':'home');
    }
    clearInterval(state.notificationTimer);
    state.notificationTimer=setInterval(refreshNotificationBadge, 30000)
  }catch{
    login()
  }
}
function shell(){
  let admin=state.me.role==='approver';
  app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="logo">OA 请假系统</div><nav class="nav">${admin?`<button data-page="admin">请假审批</button><button data-page="adjustments">返岗与续假</button><button data-page="history">历史记录</button>`:`<button data-page="home">工作台</button><button data-page="apply">发起请假</button><button data-page="records">我的申请</button><button data-page="guide">操作说明</button><button data-page="profile">个人信息</button>`}<button data-page="notifications" class="notification-nav"><span>消息通知</span><span id="notificationBadge" class="notification-badge ${state.unread?'':'hidden'}">${state.unread>99?'99+':state.unread}</span></button></nav><div class="user-mini"><div class="avatar">${state.me.name[0]}</div><div>${state.me.name}<br><small>${admin?'审批员':'普通员工'}</small></div><button class="mini-logout" id="logoutMini" type="button">退出登录</button></div></aside><section class="content"><header class="topbar"><h2 id="title"></h2><div><span>${state.me.name}</span>　<button class="btn btn-danger" id="logout">退出</button></div></header><div class="page" id="page"></div></section></div>`;
  document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>navigate(x.dataset.page));
  $('#logout').onclick=async()=>{
    clearInterval(state.notificationTimer);
    await api('/api/logout', {method:'POST'});
    login()
  };
  $("#logoutMini").onclick=$("#logout").onclick
}
async function switchToEmployeeAccount(){
  try{await api('/api/switch-employee',{method:'POST',body:'{}'});location.reload();}catch(e){toast(e.message,true)}
}

async function navigate(page){
  state.page=page;
  document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active', x.dataset.page===page));
  let titles={
    home:'员工工作台', apply:'发起请假', records:'我的请假记录', guide:'操作流程说明', profile:'个人中心', admin:'请假审批', adjustments:'返岗与续假审批', history:'历史请假记录', notifications:'消息通知',ai:'AI 助手'
  };
  $('#title').textContent=titles[page];
  if(page==='home')home();
  if(page==='apply')applyPage();
  if(page==='records')await records();
  if(page==='guide')guide();
  if(page==='profile')profile();
  if(page==='admin'||page==='history')await admin(page);
  if(page==='adjustments')await adjustmentAdmin();
  if(page==='notifications')await notificationsPage();if(page==='ai')aiPage()
}
function setNotificationBadge(count){
  state.unread=count;
  let badge=$('#notificationBadge');
  if(!badge)return;
  badge.textContent=count>99?'99+':count;
  badge.classList.toggle('hidden', !count)
}
async function refreshNotificationBadge(){
  try{
    let d=await api('/api/notifications/unread-count');
    setNotificationBadge(d.unread)
  }catch{

  }
}
async function readRequestNotifications(requestId){
  try{
    await api('/api/notifications/read', {method:'POST', body:JSON.stringify({request_id:Number(requestId)})});
    await refreshNotificationBadge()
  }catch{

  }
}
async function notificationsPage(){
  try{
    let d=await api('/api/notifications'), items=d.notifications;
    $('#page').innerHTML=`<div class="hero"><h2>最新请假消息</h2><div>${state.me.role==='approver'?'查看员工新申请、重新提交和返岗续假手续。':'查看请假审批结果、退回原因和补交材料提醒。'}</div></div><div class="card"><div class="toolbar"><h3>${items.length} 条消息</h3>${d.unread?'<button class="btn btn-ghost" id="readAll">全部标为已读</button>':'<span class="hint">暂无未读消息</span>'}</div><div class="notification-list">${items.map(n=>`<button class="notification-item ${n.is_read?'':'unread'}" data-id="${n.id}" data-request="${n.request_id||0}"><span class="notification-dot"></span><span><strong>${textSafe(n.title)}</strong><small>${textSafe(n.message)}</small><time>${n.created_at}</time></span></button>`).join('')||'<div class="notice">暂无消息通知</div>'}</div></div>`;
    $('#readAll')?.addEventListener('click', async()=>{await api('/api/notifications/read', {method:'POST', body:'{}'});setNotificationBadge(0);document.querySelectorAll('.notification-item').forEach(x=>x.classList.remove('unread'));$('#readAll')?.remove()});
    document.querySelectorAll('.notification-item').forEach(item=>item.onclick=async()=>{await api('/api/notifications/read', {method:'POST', body:JSON.stringify({id:Number(item.dataset.id)})});item.classList.remove('unread');await refreshNotificationBadge();let rid=Number(item.dataset.request);if(rid)state.me.role==='approver'?adminDetail(rid, 'notifications'):employeeDetail(rid, 'notifications')})
  }catch(e){
    toast(e.message, true)
  }
}
function home(){
  let total=state.balances.reduce((s, x)=>s+x.remaining_days, 0);
  $('#page').innerHTML=`<div class="hero"><h2>${greeting()}，${state.me.name}</h2><div>今天也要合理安排工作与休息。</div></div><div class="grid"><div class="card span4"><div class="hint">可用假期总计</div><div class="metric">${total} <small>天</small></div></div><div class="card span4"><div class="hint">审批承诺</div><div class="metric">1 <small>个工作日</small></div></div><div class="card span4"><div class="hint">材料复杂申请</div><div class="metric">≤ 2 <small>个工作日</small></div></div><div class="card span12"><div class="toolbar"><h3>假期余额</h3><button class="btn btn-primary" onclick="navigate('apply')">＋ 发起请假</button></div><div class="balance-grid">${state.balances.map(x=>`<div class="balance"><span>${x.leave_type}</span><strong>${x.remaining_days} 天</strong></div>`).join('')}</div></div><div class="card span7"><h3>温馨提醒</h3><div class="notice">客观原因无法同步提交证明材料时，请勾选“待补交”，并填写预计补交说明。</div><div class="notice">突发情况可先报备，应在休假结束后 1 个工作日内补办；确有障碍，最迟在障碍消除后 3 个工作日内完成。</div></div><div class="card span5"><h3>快捷入口</h3><button class="btn btn-primary full" onclick="navigate('records')">查询个人请假记录</button><br><br><button class="btn btn-ghost full" onclick="navigate('profile')">访问个人信息</button></div></div>`
}
function greeting(){
  let h=new Date().getHours();
  return h<11?'上午好':h<18?'下午好':'晚上好'
}
function applyPageLegacy(){
  $('#page').innerHTML=`<div class="grid"><form class="card span7" id="leaveForm"><h3>填写请假申请</h3><div class="two"><div class="field"><label>请假类型</label><select name="leave_type" required>${state.balances.map(x=>`<option>${x.leave_type}</option>`).join('')}</select></div><div class="field"><label>请假天数</label><input name="days" type="number" min="0.5" step="0.5" required></div></div><div class="two"><div class="field"><label>开始时间</label><input name="start_time" type="datetime-local" required></div><div class="field"><label>结束时间</label><input name="end_time" type="datetime-local" required></div></div><div class="field"><label>请假事由</label><textarea name="reason" placeholder="请简要说明"></textarea></div><label><input type="checkbox" name="pending_material"> 证明材料待补交</label><div class="field"><label>材料说明 / 预计补交时间</label><input name="material_note" placeholder="如：返岗后 1 个工作日内补交"></div><label><input type="checkbox" name="emergency_report"> 突发情况报备（暂无法第一时间办理正式请假）</label><div class="field"><label>报备原因</label><textarea name="emergency_reason" placeholder="如属突发报备，请说明客观情况"></textarea></div><button class="btn btn-primary">提交申请</button></form><div class="card span5"><h3>连续 / 分批请假</h3><p>同一段连续休假包含不同类型时，请分别提交相邻时间段的申请；同一类型需要分批使用时，也可建立多条申请。</p><div class="notice">系统会分别生成申请单号，审批状态和材料状态可独立追踪。</div><h3>提前申请规则</h3><p class="hint">各类假期的最少提前天数将在下一阶段补充。当前版本仅记录申请时间，不阻止提交。</p></div></div>`;
  $('#leaveForm').onsubmit=async e=>{
    e.preventDefault();
    let d=Object.fromEntries(new FormData(e.target));
    d.pending_material=!!e.target.pending_material.checked;
    d.emergency_report=!!e.target.emergency_report.checked;
    try{
      let r=await api('/api/requests', {method:'POST', body:JSON.stringify(d)});
      toast(`已提交 ${r.request_no}`);
      navigate('records')
    }catch(x){
      toast(x.message, true)
    }
  }
}
async function records(){
  let d=await api('/api/requests');
  state.requests=d.requests;
  $('#page').innerHTML=`<div class="card"><div class="toolbar"><h3>我的全部申请</h3><button class="btn btn-primary" onclick="navigate('apply')">＋ 新申请</button></div>${table(d.requests,false)}</div>`
}
function fmtDays(value){
  return Number(value||0).toLocaleString('zh-CN', {maximumFractionDigits:2})
}
function balanceDecision(x, compact=false){
  if(x.available_balance===undefined)return'';
  let pending=x.pending_occupied>0?`<span>其他待审占用 <strong>${fmtDays(x.pending_occupied)} 天</strong></span>`:'';
  return `<div class="balance-decision ${x.balance_sufficient?'':'insufficient'} ${compact?'compact':''}"><span>${x.leave_type}可用 <strong>${fmtDays(x.available_balance)} 天</strong></span>${pending}<span class="balance-arrow">→</span><span>本次 <strong>${fmtDays(x.days)} 天</strong></span><span class="balance-arrow">→</span><span>批准后 <strong>${fmtDays(x.balance_after_approval)} 天</strong></span>${x.balance_sufficient?'':'<em>余额不足</em>'}</div>`
}
function table(items, adminMode){
  return `<div class="table-wrap"><table><thead><tr>${adminMode?'<th>申请人</th>':''}<th>申请单</th><th>类型 / 时间</th><th>${adminMode?"天数 / 余额判断":"天数"}</th><th>材料</th><th>状态</th><th>提交时间</th>${adminMode?'<th>处理</th>':'<th>审批留言</th>'}</tr></thead><tbody>${items.map(x=>`<tr>${adminMode?`<td><strong>${x.name}</strong><br><span class="hint">${x.emergency_report?'突发报备':'普通申请'}</span></td>`:''}<td>${x.request_no}${x.review_round>1?`<br><span class="badge">第 ${x.review_round} 次审批</span>`:''}</td><td><strong>${x.leave_type}</strong><br><span class="hint">${x.start_time}<br>至 ${x.end_time}</span></td><td>${x.days}${adminMode&&['pending','reported','supplement_required'].includes(x.status)?balanceDecision(x,true):''}</td><td>${x.material_status==='complete'?'已提交':'待补交'}${adminMode?(x.timely?`<br><span class="badge approved">按时申请</span>`:(x.emergency_report?`<br><span class="badge pending">未按时 · 已报备</span>`:`<br><span class="badge returned">未按时 · 未报备</span>`)):""}</td><td><span class="badge ${x.status}">${labels[x.status]||x.status}</span>${x.overdue?'<br><span class="overdue">● 已超出处理时限</span>':''}</td><td>${x.submitted_at}</td>${adminMode?`<td><div class="actions"><button class="action-view" onclick="adminDetail(${x.id})">查看详情</button><button class="action-approve" onclick="action(${x.id},'approve')">通过</button><button class="action-return" onclick="openReturnModal(${x.id})">打回</button>${x.material_status!=='complete'?`<button class="action-remind" onclick="action(${x.id},'remind')">提醒补交</button>`:''}</div></td>`:`<td>${x.approver_comment||'—'}</td>`}</tr>`).join('')||'<tr><td colspan="9">暂无记录</td></tr>'}</tbody></table></div>`
}
function guide(){
  $('#page').innerHTML=`<div class="grid"><div class="card span7"><h3>标准请假流程</h3><ol class="flow"><li><strong>发起申请</strong><br><span class="hint">选择类型、时间与天数，填写事由。</span></li><li><strong>提交材料</strong><br><span class="hint">无法同步提供时勾选“待补交”。</span></li><li><strong>审批处理</strong><br><span class="hint">通常 1 个工作日，连续或复杂申请原则上不超过 2 个工作日。</span></li><li><strong>查看结果</strong><br><span class="hint">在“我的申请”查看审批状态与留言。</span></li></ol></div><div class="card span5"><h3>突发情况</h3><p>先选择“突发情况报备”提交记录。休假结束后 1 个工作日内补办审批手续。</p><p>确有客观障碍的，应说明原因，并在障碍消除后最迟不超过 3 个工作日完成补办。</p><h3>退回与补充</h3><p>审批员会留言说明原因或材料要求。修改或补充后将进入二次审批，历史轨迹会保留。</p></div></div>`
}
async function delegationPage(){
  $('#title').textContent='审批代理';
  $('#subtitle').textContent='设置请假期间的审批代理人';
  let d;
  try{d=await api('/api/approval-delegation')}catch(e){toast(e.message,true);return}
  const delegates=d.delegates||[], current=d.current||null, incoming=d.incoming||[], delegatedRequests=d.delegated_requests||[];
  const opts=delegates.map(x=>`<option value="${x.id}">${textSafe(x.name)} · ${textSafe(x.username)}</option>`).join('');
  const statusMap={pending_accept:'待代理人确认',active:'已生效',rejected:'已拒绝'};
  const statusCls={pending_accept:'pending',active:'approved',rejected:'returned'};
  const currentStatus=current?statusMap[current.status]||current.status:'无';
  const currentCls=current?statusCls[current.status]||'':'';
  const incomingHtml=incoming.length?incoming.map(x=>`<div class="ai-req-item"><div class="ai-req-info"><strong>${textSafe(x.approver_name)}</strong> · ${textSafe(x.approver_username)}<br><span class="hint">${x.start_date} 至 ${x.end_date}</span><br><span class="hint">${textSafe(x.reason||'')}</span></div><div><button type="button" class="btn btn-primary ai-delegation-accept" data-id="${x.id}">接受</button><button type="button" class="btn btn-ghost ai-delegation-reject" data-id="${x.id}">拒绝</button></div></div>`).join(''):'<div class="hint">暂无待确认的委托</div>';
  const delegatedHtml=delegatedRequests.length?delegatedRequests.map(x=>`<div class="ai-req-item"><div class="ai-req-info"><strong>${textSafe(x.request_no)}</strong> · ${textSafe(x.leave_type)} · ${textSafe(x.name)}<br><span class="hint">${x.start_time} 至 ${x.end_time} · ${x.days} 天</span></div><div><span class="badge ${x.status}">${labels[x.status]||x.status}</span></div></div>`).join(''):'<div class="hint">当前代理范围内暂无待审批请假</div>';
  $('#page').innerHTML=`<div class="grid"><div class="card span7"><h3>代理设置</h3><form id="delegationForm"><div class="two"><div class="field"><label>代理人</label><select name="delegate_approver_id" required>${opts}</select></div><div class="field"><label>生效开始日期</label><input name="start_date" type="date" required></div></div><div class="two"><div class="field"><label>生效结束日期</label><input name="end_date" type="date" required></div><div class="field"><label>委托原因</label><input name="reason" placeholder="如：本人休假期间"></div></div><div id="delegationError" class="hidden"></div><button class="btn btn-primary">保存委托</button><button type="button" class="btn btn-ghost" id="clearDelegation">清除当前委托</button></form></div><div class="card span5"><h3>当前委托状态</h3>${current?`<p><strong>${textSafe(current.delegate_name)}</strong> <span class="badge ${currentCls}">${currentStatus}</span><br><span class="hint">${current.start_date} 至 ${current.end_date}</span><br>${textSafe(current.reason||'')}</p>`:'<p class="hint">暂无委托</p>'}</div><div class="card span12"><h3>收到的代理请求</h3>${incomingHtml}</div><div class="card span12"><h3>代理收到的请假</h3>${delegatedHtml}</div></div>`;
  if(current){
    const form=$('#delegationForm');
    form.delegate_approver_id.value=current.delegate_approver_id;
    form.start_date.value=current.start_date;
    form.end_date.value=current.end_date;
    form.reason.value=current.reason||'';
  }
  $('#delegationForm').onsubmit=async e=>{
    e.preventDefault();
    const data=Object.fromEntries(new FormData(e.target));
    data.delegate_approver_id=Number(data.delegate_approver_id);
    const err=$('#delegationError');
    err.className='hidden';
    try{await api('/api/approval-delegation',{method:'POST',body:JSON.stringify(data)});toast('委托已提交，等待代理人确认');delegationPage()}catch(x){err.className='notice rule-warning';err.textContent=x.message}
  };
  $('#clearDelegation').onclick=async()=>{
    try{await api('/api/approval-delegation',{method:'POST',body:JSON.stringify({delegate_approver_id:0,start_date:'2000-01-01',end_date:'2000-01-01',reason:''})});toast('已清除委托');delegationPage()}catch(x){toast(x.message,true)}
  };
  document.querySelectorAll('.ai-delegation-accept').forEach(b=>b.onclick=async()=>{
    try{await api('/api/approval-delegation/respond',{method:'POST',body:JSON.stringify({delegation_id:Number(b.dataset.id),action:'accept'})});toast('已接受委托');delegationPage()}catch(x){toast(x.message,true)}
  });
  document.querySelectorAll('.ai-delegation-reject').forEach(b=>b.onclick=async()=>{
    try{await api('/api/approval-delegation/respond',{method:'POST',body:JSON.stringify({delegation_id:Number(b.dataset.id),action:'reject'})});toast('已拒绝委托');delegationPage()}catch(x){toast(x.message,true)}
  });
}

function profile(){
  $('#page').innerHTML=`<div class="grid"><div class="card span5"><h3>个人基础信息</h3><p><span class="hint">姓名</span><br><strong>${state.me.name}</strong></p><p><span class="hint">性别 / 年龄</span><br><strong>${state.me.gender||'—'} / ${state.me.age||'—'} 岁</strong></p><p><span class="hint">本单位工龄</span><br><strong>${state.me.unit_years} 年</strong></p><p><span class="hint">连续工龄</span><br><strong>${state.me.continuous_years} 年</strong></p></div><div class="card span7"><h3>所有类型假期余额</h3><div class="balance-grid">${state.balances.map(x=>`<div class="balance"><span>${x.leave_type}</span><strong>${x.remaining_days} 天</strong></div>`).join('')}</div></div></div>`
}
async function admin(page){
  let d=await api('/api/admin/requests'), items=d.requests;
  if(page==='admin')items=items.filter(x=>['pending', 'reported', 'supplement_required'].includes(x.status));
  $('#page').innerHTML=`<div class="hero"><h2>${page==='admin'?'待处理申请':'全量审批档案'}</h2><div>${page==='admin'?'按最新提交排序；单击任意请假条可查看完整信息。':'包含待审批、已审批、退回修改、材料补交与二次审批；单击记录可进入详情。'}</div></div><div class="card"><div class="toolbar"><h3>${items.length} 条记录</h3><span class="hint">审批应在 1 个工作日内完成，复杂申请原则上不超过 2 个工作日</span></div>${table(items,true)}</div>`;
  document.querySelectorAll('#page tbody tr').forEach((row, i)=>{if(!items[i])return;row.classList.add('clickable-row');row.title='点击查看完整请假申请';row.onclick=e=>{if(e.target.closest('button,a,input,select,textarea'))return;adminDetail(items[i].id)}})
}
function action(id, type){
  if(type==='approve'){
    approvalConfirmDialog('确认通过申请', '通过后，该请假申请将正式生效，并按规则扣减相应假期余额。', ()=>submitRequestAction(id, type, '通过'));
    return
  }let names={
    reject:'不同意原因', return:'退回修改原因', supplement:'需要补充的材料及期限', remind:'补交提醒及截止时间'
  }, comment=prompt(names[type]||'处理说明');
  if(comment===null||!comment)return;
  submitRequestAction(id, type, comment)
}
function submitRequestAction(id, type, comment){
  api(`/api/admin/requests/${id}/action`, {method:'POST', body:JSON.stringify({action:type, comment})}).then(()=>{toast('处理完成');finishDetailOrNavigate()}).catch(x=>toast(x.message, true))
}

function approvalConfirmDialog(title, message, onConfirm){
  const layer=document.createElement('div');
  layer.className='modal';
  layer.innerHTML=`<div class="modal-card approval-confirm"><div class="approval-confirm-icon">✓</div><h3>${title}</h3><p>${message}</p><div class="notice">请确认申请信息、材料和假期余额均已核对无误。</div><div class="approval-confirm-actions"><button type="button" class="btn btn-ghost" id="cancelApproval">取消</button><button type="button" class="btn action-approve" id="confirmApproval">确认通过</button></div></div>`;
  document.body.appendChild(layer);
  let close=()=>layer.remove();
  layer.querySelector('#cancelApproval').onclick=close;
  layer.onclick=e=>{
    if(e.target===layer)close()
  };
  layer.querySelector('#confirmApproval').onclick=()=>{
    close();
    onConfirm()
  }
}
function applyPage(){
  const opts=state.policies.filter(employeePolicyVisible).map(p=>`<option value="${p.leave_type}" ${aiPrefill&&aiPrefill.leave_type===p.leave_type?'selected':''}>${p.leave_type}（${p.unit}）</option>`).join('');
  $('#page').innerHTML=`<div class="grid"><form class="card span7" id="leaveForm"><h3>填写请假申请</h3>
  <div class="two"><div class="field"><label>请假类型</label><select name="leave_type" id="leaveType" required>${opts}</select></div><div class="field"><label>系统计算天数</label><input id="calcDays" readonly placeholder="选择日期后自动计算"></div></div>
  <div id="policyHint" class="notice"></div><div id="timingStatus" class="hidden"></div><div id="principleStatus" class="hidden"></div>
  <div class="two"><div class="field"><label>开始日期</label><input name="start_time" id="startTime" type="date" required></div><div class="field"><label>结束日期</label><input name="end_time" id="endTime" type="date" required></div></div>
  <div id="reasonMaterialSection" class="reason-material-section"><div class="field"><label>请假事由与证明材料</label><textarea name="reason" id="leaveReason" required placeholder="请说明具体事由"></textarea><div class="reason-upload-row"><label class="image-upload-button" for="materialImages"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3"/></svg><span>上传证明图片</span></label><input id="materialImages" class="hidden-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><span class="hint">支持 JPG、PNG、WebP、GIF，单张不超过 8MB</span></div><div id="materialImageStatus" class="upload-status"></div></div>
  <label><input type="checkbox" name="pending_material"> 证明材料待补交</label><div class="field"><label>材料说明 / 预计补交时间</label><input name="material_note" placeholder="如：返岗后 1 个工作日内补交"></div></div>
  <div class="field"><label>关联申请单号</label><input name="related_request_no" placeholder="路程假须填写关联的婚假或丧假单号"></div>
  <label><input type="checkbox" name="exception_requested"> 不符合原则性要求，申请特殊审批</label><br>
  <label><input type="checkbox" name="emergency_report"> 突发情况报备</label><div class="field"><label>报备原因</label><textarea name="emergency_reason" placeholder="如属突发报备，请说明客观情况"></textarea></div>
  <div id="formError" class="hidden"></div><button class="btn btn-primary">提交申请</button></form>
  <div class="card span5"><h3>计算口径</h3><p><strong>工作日</strong>：排除周六、周日及已配置的法定节假日；调休工作日计入。</p><p><strong>自然日</strong>：包含休息日与法定节假日，按连续日历天计算。</p><div class="notice">年度法定节假日及调休日期需由管理员按国务院当年通知录入。</div><h3>连续 / 分批请假</h3><p>不同类型连续休假请分别提交相邻日期的申请。系统会校验提前时限、单次天数、累计额度、申请次数、关联单号和连续安排。</p></div></div>`;
  const updatePolicy=()=>{
    let p=state.policies.find(x=>x.leave_type===$('#leaveType').value), exempt=p.reason_required===false;
    $('#policyHint').innerHTML=`<strong>${p.unit}计算 · ${p.limit}</strong><br>申请时限：${p.timing}<br>材料提示：${p.material}`;
    $('#reasonMaterialSection').classList.toggle('hidden', exempt);
    $('#leaveReason').required=!exempt;
    if(exempt){
      let form=$('#leaveForm');
      $('#leaveReason').value='';
      form.pending_material.checked=false;
      form.material_note.value='';
      $('#materialImages').value='';
      $('#materialImageStatus').textContent=''
    }
  };
  let currentWarnings=[];
  const calculate=async()=>{
    if(!$('#startTime').value||!$('#endTime').value)return;
    try{
      let r=await api('/api/calculate-days', {method:'POST', body:JSON.stringify({leave_type:$('#leaveType').value, start_time:$('#startTime').value, end_time:$('#endTime').value})});
      $('#calcDays').value=`${r.days} 天（${r.unit}）`;
      let box=$('#timingStatus');
      box.className=r.timely?'notice':'notice rule-warning';
      box.innerHTML=r.advance_required===null?`该假期无统一提前天数要求。`:(r.timely?`✓ 符合时限：需提前 ${r.advance_required} 个工作日，当前提前 ${r.advance_actual} 个工作日。`:`⚠ 未按标准时限：需提前 ${r.advance_required} 个工作日，当前仅提前 ${r.advance_actual} 个工作日。请调整日期；如属突发/紧急情况，请勾选下方“突发情况报备”并说明原因。`);
      currentWarnings=r.principle_warnings||[];
      let rules=$('#principleStatus');
      rules.className=currentWarnings.length?'notice rule-warning':'notice';
      rules.innerHTML=currentWarnings.length?`<strong>⚠ 不符合原则性要求</strong><ul>${currentWarnings.map(x=>`<li>${x}</li>`).join('')}</ul><span>请修改申请；确有特殊情况时，勾选“申请特殊审批”并在事由中说明。</span>`:'✓ 当前天数、累计额度和申请次数符合一般标准。'
    }catch(x){
      $('#calcDays').value='';
      toast(x.message, true)
    }
  };
  $('#leaveType').onchange=()=>{
    updatePolicy();
    calculate()
  };
  $('#startTime').onchange=calculate;
  $('#endTime').onchange=calculate;
  if(aiPrefill){
    if(aiPrefill.start_date){$('#startTime').value=aiPrefill.start_date}
    if(aiPrefill.end_date){$('#endTime').value=aiPrefill.end_date}
    if(aiPrefill.reason){$('#leaveReason').value=aiPrefill.reason}
    const form=$('#leaveForm');
    if(aiPrefill.pending_material){form.pending_material.checked=true}
    if(aiPrefill.material_note){form.material_note.value=aiPrefill.material_note}
    if(aiPrefill.emergency_report){form.emergency_report.checked=true}
    if(aiPrefill.emergency_reason){form.emergency_reason.value=aiPrefill.emergency_reason}
    aiPrefill=null;
  }
  updatePolicy();
  calculate();
  $('#leaveForm').onsubmit=async e=>{
    e.preventDefault();
    let d=Object.fromEntries(new FormData(e.target));
    d.pending_material=!!e.target.pending_material.checked;
    d.exception_requested=!!e.target.exception_requested.checked;
    d.emergency_report=!!e.target.emergency_report.checked;
    let error=$('#formError');
    if(currentWarnings.length&&!d.exception_requested){
      error.className='notice rule-warning';
      error.innerHTML=`<strong>申请暂不能提交：</strong>${currentWarnings.join('；')}。请修改申请，或勾选特殊审批并说明原因。`;
      error.scrollIntoView({behavior:'smooth', block:'center'});
      return
    }try{
      d.attachment_tokens=await uploadSelectedImages($('#materialImages'), $('#materialImageStatus'));
      let r=await api('/api/requests', {method:'POST', body:JSON.stringify(d)});
      toast(`已提交 ${r.request_no}`);
      navigate('records')
    }catch(x){
      error.className='notice rule-warning';
      error.textContent=x.message;
      error.scrollIntoView({behavior:'smooth', block:'center'})
    }
  }
}

function guide(){
  const rows=state.policies.map(p=>`<tr><td><strong>${p.leave_type}</strong></td><td>${p.unit}</td><td>${p.limit}</td><td>${p.proof?'需要/待补交':'按实际情况'}</td></tr>`).join('');
  $('#page').innerHTML=`<div class="grid"><div class="card span12"><h3>休假类型与计算规则</h3><div class="table-wrap"><table><thead><tr><th>假期类型</th><th>计算单位</th><th>额度与限制</th><th>材料</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="card span7"><h3>年休假规则</h3><p>累计工作满 1 年不满 10 年：5 个工作日；满 10 年不满 20 年：10 个工作日；满 20 年及以上：15 个工作日。</p><p>新入职当年按“年度应休天数 × 当年实际工作月数 ÷ 12”折算，不足 1 天部分舍去。</p><p>病假达到法定工龄档位的 2／3／4 个月，或事假累计达到 20 天且单位未扣发工资，经依法核实后可取消当年未休年假；已休部分不追溯。</p></div>
  <div class="card span5"><h3>病假与医疗期</h3><p>法定病假按自然日连续计算，工作日、休息日和法定节假日均计入，并统一纳入医疗期。</p><div class="notice">你的当前医疗期参考值：<strong>${state.me.medical_period_months||'—'} 个月</strong></div><p class="hint">同一或医学相关疾病原则上合并计算；医学关联性以合法医疗机构诊断意见为依据。</p></div>
  <div class="card span12"><h3>申请与审批流程</h3><ol class="flow"><li><strong>选择类型和日期</strong><br><span class="hint">系统按工作日或自然日自动计算。</span></li><li><strong>提交或标记待补交材料</strong></li><li><strong>审批员处理</strong><br><span class="hint">通常 1 个工作日，复杂申请原则上不超过 2 个工作日。</span></li><li><strong>查看结果并按留言修改或补充</strong></li></ol></div>
  <div class="card span4"><h3>提前返岗 / 销假</h3><p>员工提前返岗时，应于返岗当日或返岗前确认实际休假结束时间并提交审批。</p><p class="hint">未办理但实际返岗的，由公司结合考勤、工作安排等事实综合认定。</p></div><div class="card span4"><h3>续假</h3><p>确需延长休假的，必须在原批准假期届满前申请，并按原假期类型补充材料；审批通过后方可继续休假。</p><p class="hint">未经批准擅自延长的，视为未请假缺勤。</p></div><div class="card span4"><h3>病假复工</h3><p>病假返岗时，公司可结合岗位风险依法、合理要求复工证明或健康评估，以保障健康与生产安全。</p></div></div>`
}

function profile(){
  $('#page').innerHTML=`<div class="grid"><div class="card span5"><h3>个人基础信息</h3><p><span class="hint">姓名</span><br><strong>${state.me.name}</strong></p><p><span class="hint">性别 / 年龄</span><br><strong>${state.me.gender||'—'} / ${state.me.age||'—'} 岁</strong></p><p><span class="hint">本单位工龄</span><br><strong>${state.me.unit_years} 年</strong></p><p><span class="hint">连续工龄</span><br><strong>${state.me.continuous_years} 年</strong></p><p><span class="hint">法定年休假额度</span><br><strong>${state.me.annual_leave_entitlement} 个工作日</strong></p><p><span class="hint">医疗期参考</span><br><strong>${state.me.medical_period_months} 个月</strong></p></div><div class="card span7"><h3>所有类型假期余额 / 管理额度</h3><div class="balance-grid">${state.balances.filter(x=>state.policies.some(p=>p.leave_type===x.leave_type)).map(x=>`<div class="balance"><span>${x.leave_type}</span><strong>${x.remaining_days} 天</strong></div>`).join('')}</div><p class="hint">法定病假显示的是医疗期管理参考天数，并非当然可一次性请休的假期余额。</p></div></div>`
}

async function adminDetail(id, returnPage=state.page){
  await readRequestNotifications(id);
  try{
    const d=await api(`/api/admin/requests/${id}`), x=d.request, adminMode=true;
    $('#title').textContent='请假申请详情';
    $('#page').innerHTML=`<div class="toolbar"><button class="btn btn-ghost" id="backAdmin">← 返回列表</button><span class="hint">申请单 ${x.request_no}</span></div>
    <div class="grid"><div class="card span8"><div class="toolbar"><div><h3>${x.name} · ${x.leave_type}</h3><span class="badge ${x.status}">${labels[x.status]||x.status}</span> ${x.overdue?'<span class="overdue">● 已超出处理时限</span>':''}</div><div class="actions"><button class="action-approve" onclick="action(${x.id},'approve')">通过</button><button class="action-return" onclick="openReturnModal(${x.id})">打回</button></div></div>
    ${['pending','reported','supplement_required'].includes(x.status)?`<h3 style="margin-top:22px">本次假种余额</h3>${balanceDecision(x)}`:''}<table><tbody><tr><th>申请单号</th><td>${x.request_no}</td><th>审批轮次</th><td>第 ${x.review_round} 次</td></tr><tr><th>开始时间</th><td>${x.start_time}</td><th>结束时间</th><td>${x.end_time}</td></tr><tr><th>计算天数</th><td>${x.days} 天</td><th>计算口径</th><td>${x.policy_unit||state.policies.find(p=>p.leave_type===x.leave_type)?.unit||'—'}</td></tr><tr><th>提交时间</th><td>${x.submitted_at}</td><th>处理期限</th><td>${x.deadline_at||'—'}</td></tr><tr><th>规定提前时间</th><td>${x.advance_required===null?'无统一要求':x.advance_required+' 个工作日'}</td><th>实际提前时间</th><td>${x.advance_actual} 个工作日</td></tr><tr><th>是否按时申请</th><td>${x.timely?'✓ 是':'⚠ 否'}</td><th>未按时是否报备</th><td>${x.timely?'无需报备':(x.emergency_report?'✓ 已报备':'⚠ 未报备')}</td></tr></tbody></table>
    <div class="notice ${x.timely?'':'rule-warning'}"><strong>申请时限：</strong>${x.timing_rule}<br><strong>材料要求：</strong>${x.material_rule}</div>
    <h3 style="margin-top:22px">申请事由</h3><div class="notice">${x.reason||'未填写'}</div>
    <h3>材料与特殊情况</h3><table><tbody><tr><th>材料状态</th><td>${x.material_status==='complete'?'已提交':'待补交'}${adminMode?(x.timely?`<br><span class="badge approved">按时申请</span>`:(x.emergency_report?`<br><span class="badge pending">未按时 · 已报备</span>`:`<br><span class="badge returned">未按时 · 未报备</span>`)):""}</td><th>材料说明</th><td>${x.material_note||'—'}</td></tr><tr><th>突发报备</th><td>${x.emergency_report?'是':'否'}</td><th>报备原因</th><td>${x.emergency_reason||'—'}</td></tr><tr><th>特殊审批</th><td>${x.exception_requested?'是':'否'}</td><th>关联申请单</th><td>${x.related_request_no||'—'}</td></tr></tbody></table>${attachmentGallery(d.attachments)}
    ${x.approver_comment?`<h3 style="margin-top:22px">当前审批留言</h3><div class="notice">${x.approver_comment}</div>`:''}</div>
    <div class="card span4"><h3>员工基础信息</h3><p><span class="hint">姓名 / 账号</span><br><strong>${x.name}</strong> / ${x.username}</p><p><span class="hint">性别 / 年龄</span><br><strong>${x.gender||'—'} / ${x.age||'—'} 岁</strong></p><p><span class="hint">本单位工龄</span><br><strong>${x.unit_years} 年</strong></p><p><span class="hint">连续工龄</span><br><strong>${x.continuous_years} 年</strong></p><h3>审批轨迹</h3>${d.logs.length?d.logs.map(l=>`<div class="notice"><strong>${l.approver_name}</strong> · 第 ${l.round} 次<br>${({approve:'通过',reject:'不通过',return:'退回修改',supplement:'要求材料',remind:'提醒补交'})[l.action]||l.action}<br><span class="hint">${l.comment||'无留言'}<br>${l.created_at}</span></div>`).join(''):'<p class="hint">暂无审批操作记录</p>'}</div></div>`;
    $('#backAdmin').textContent=returnPage==='notifications'?'← 返回消息通知':'← 返回列表';
    $('#backAdmin').onclick=()=>navigate(returnPage);
  }catch(e){
    toast(e.message, true)
  }
}

function openReturnModal(id){
  const layer=document.createElement('div');
  layer.className='modal';
  layer.innerHTML=`<div class="modal-card"><div class="toolbar"><h3>打回请假申请</h3><button class="btn btn-ghost" id="closeReturn">关闭</button></div>
  <div class="field"><label>处理方式</label><select id="returnType"><option value="return">退回修改</option><option value="supplement">要求补充材料</option><option value="reject">不通过</option></select></div>
  <div class="field"><label id="returnLabel">退回原因（选填）</label><textarea id="returnComment" placeholder="说明需要修改的内容，便于员工重新提交"></textarea></div>
  <div class="notice" id="returnHelp">申请将退回员工修改，重新提交后进入二次审批。</div><div id="returnError" class="hidden"></div>
  <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn btn-ghost" id="cancelReturn">取消</button><button class="btn btn-danger" id="confirmReturn">确认打回</button></div></div>`;
  document.body.appendChild(layer);
  const close=()=>layer.remove(), select=layer.querySelector('#returnType'), label=layer.querySelector('#returnLabel'), comment=layer.querySelector('#returnComment'), help=layer.querySelector('#returnHelp');
  select.onchange=()=>{
    const material=select.value==='supplement', reject=select.value==='reject';
    label.textContent=material?'缺失材料说明（选填）':reject?'不通过缘由（必填）':'退回原因（选填）';
    comment.placeholder=material?'说明缺少的证明材料、格式或补交期限':reject?'请说明不通过的具体原因':'说明需要修改的内容，便于员工重新提交';
    help.textContent=material?'申请将进入待补充材料状态，员工补交后进入二次审批。':reject?'申请将被标记为不通过，员工可在申请详情中查看缘由。':'申请将退回员工修改，重新提交后进入二次审批。'
  };
  layer.querySelector('#closeReturn').onclick=close;
  layer.querySelector('#cancelReturn').onclick=close;
  layer.onclick=e=>{
    if(e.target===layer)close()
  };
  layer.querySelector('#confirmReturn').onclick=async()=>{
    let reason=comment.value.trim(), error=layer.querySelector('#returnError');
    if(select.value==='reject'&&!reason){
      error.className='notice rule-warning';
      error.textContent='选择“不通过”时必须填写具体缘由。';
      comment.focus();
      return
    }try{
      await api(`/api/admin/requests/${id}/action`, {method:'POST', body:JSON.stringify({action:select.value, comment:reason})});
      close();
      toast(select.value==='supplement'?'已要求补充材料':select.value==='reject'?'已设为不通过':'已退回修改');
      finishDetailOrNavigate()
    }catch(e){
      error.className='notice rule-warning';
      error.textContent=e.message
    }
  };
}

async function records(){
  let d=await api('/api/requests');
  state.requests=d.requests;
  $('#page').innerHTML=`<div class="card"><div class="toolbar"><h3>我的全部申请</h3><button class="btn btn-primary" onclick="navigate('apply')">＋ 新申请</button></div>${table(d.requests,false)}</div>`;
  document.querySelectorAll('#page tbody tr').forEach((row, i)=>{if(d.requests[i]){row.classList.add('clickable-row');row.title='点击查看完整申请';row.onclick=()=>employeeDetail(d.requests[i].id)}})
}

async function employeeDetail(id, returnPage='records'){
  await readRequestNotifications(id);
  try{
    const d=await api(`/api/requests/${id}`), x=d.request, pendingAdjustment=d.adjustments?.some(a=>a.status==='pending');
    $('#title').textContent='我的申请详情';
    $('#page').innerHTML=`<div class="toolbar"><button class="btn btn-ghost" id="backMine">← 返回我的申请</button><span class="hint">${x.request_no}</span></div><div class="grid">
    <div class="card span8"><div class="toolbar"><div><h3>${x.leave_type}</h3><span class="badge ${x.status}">${labels[x.status]||x.status}</span></div><div class="actions">${x.can_modify?`<button class="action-edit-request" id="editMine">修改申请&nbsp;&nbsp;&nbsp;仅限一次</button>`:''}${x.status==='approved'&&!pendingAdjustment?`<button class="action-return-work" id="returnWork">提前返岗 / 销假</button><button class="action-extend-leave" id="extendLeave">申请续假</button>`:pendingAdjustment?'<span class="badge pending">返岗/续假手续审批中</span>':''}</div></div>
    <table><tbody><tr><th>开始时间</th><td>${x.start_time}</td><th>结束时间</th><td>${x.end_time}</td></tr><tr><th>请假天数</th><td>${x.days} 天</td><th>计算口径</th><td>${x.policy_unit||'—'}</td></tr><tr><th>提交时间</th><td>${x.submitted_at}</td><th>审批轮次</th><td>第 ${x.review_round} 次</td></tr><tr><th>是否按时</th><td>${x.timely?'✓ 按时':'⚠ 未按时'}</td><th>突发报备</th><td>${x.emergency_report?'已报备':'否'}</td></tr></tbody></table>
    <h3 style="margin-top:22px">申请事由</h3><div class="notice">${x.reason||'—'}</div><h3>材料信息</h3><div class="notice">状态：${x.material_status==='complete'?'已提交':'待补交'}<br>说明：${x.material_note||'—'}</div>${attachmentGallery(d.attachments)}${x.approver_comment?`<h3>审批留言</h3><div class="notice rule-warning">${x.approver_comment}</div>`:''}</div>
    <div class="card span4"><h3>申请规则</h3><p>${x.timing_rule}</p><p>${x.material_rule}</p><h3>审批轨迹</h3>${d.logs.length?d.logs.map(l=>`<div class="notice"><strong>${l.approver_name}</strong> · 第 ${l.round} 次<br>${({approve:'通过',reject:'不通过',return:'退回修改',supplement:'要求材料',remind:'提醒补交'})[l.action]||l.action}<br><span class="hint">${l.comment||'无留言'} · ${l.created_at}</span></div>`).join(''):'<p class="hint">暂无审批记录</p>'}<h3>返岗 / 续假记录</h3>${d.adjustments?.length?d.adjustments.map(a=>`<div class="notice"><strong>${a.adjustment_type==='return'?'提前返岗 / 销假':'续假'}</strong> · ${labels[a.status]||a.status}<br><span class="hint">目标时间：${a.proposed_time}<br>${a.reason}${a.approver_comment?'<br>审批留言：'+a.approver_comment:''}</span></div>`).join(''):'<p class="hint">暂无记录</p>'}</div></div>`;
    $('#backMine').textContent=returnPage==='notifications'?'← 返回消息通知':'← 返回我的申请';
    $('#backMine').onclick=()=>navigate(returnPage);
    if(x.can_modify)$('#editMine').onclick=()=>editRequest(x);
    if(x.status==='approved'&&!pendingAdjustment){
      $('#returnWork').onclick=()=>adjustmentDialog(x, 'return');
      $('#extendLeave').onclick=()=>adjustmentDialog(x, 'extension')
    }
  }catch(e){
    toast(e.message, true)
  }
}

function editRequest(x){
  const layer=document.createElement('div');
  layer.className='modal';
  const opts=state.policies.filter(employeePolicyVisible).map(p=>`<option ${p.leave_type===x.leave_type?'selected':''}>${p.leave_type}</option>`).join('');
  layer.innerHTML=`<form class="modal-card" id="editRequestForm"><div class="toolbar"><h3>修改申请&nbsp;&nbsp;&nbsp;仅限一次</h3><button type="button" class="btn btn-ghost" id="closeEdit">关闭</button></div><div class="notice">保存后将进入第 ${x.review_round+1} 次审批，且不能再次修改。</div>
  <div class="field"><label>假期类型</label><select name="leave_type">${opts}</select></div><div class="two"><div class="field"><label>开始日期</label><input name="start_time" type="date" value="${x.start_time.slice(0,10)}" required></div><div class="field"><label>结束日期</label><input name="end_time" type="date" value="${x.end_time.slice(0,10)}" required></div></div><div class="field"><label>请假事由</label><textarea name="reason" required>${x.reason||''}</textarea></div><div class="field"><label>关联申请单号</label><input name="related_request_no" value="${x.related_request_no||''}"></div><label><input type="checkbox" name="pending_material" ${x.material_status==='complete'?'':'checked'}> 材料待补交</label><div class="field"><label>补充证明图片</label><input id="editMaterialImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><div id="editImageStatus" class="upload-status"></div></div><div class="field"><label>材料说明</label><input name="material_note" value="${x.material_note||''}"></div><label><input type="checkbox" name="exception_requested" ${x.exception_requested?'checked':''}> 申请特殊审批</label><br><label><input type="checkbox" name="emergency_report" ${x.emergency_report?'checked':''}> 突发情况报备</label><div class="field"><label>报备原因</label><textarea name="emergency_reason">${x.emergency_reason||''}</textarea></div><div id="editError" class="hidden"></div><button class="btn btn-primary full">保存修改并重新提交</button></form>`;
  document.body.appendChild(layer);
  layer.querySelector('#closeEdit').onclick=()=>layer.remove();
  layer.onclick=e=>{
    if(e.target===layer)layer.remove()
  };
  layer.querySelector('#editRequestForm').onsubmit=async e=>{
    e.preventDefault();
    let v=Object.fromEntries(new FormData(e.target));
    v.pending_material=!!e.target.pending_material.checked;
    v.exception_requested=!!e.target.exception_requested.checked;
    v.emergency_report=!!e.target.emergency_report.checked;
    try{
      v.attachment_tokens=await uploadSelectedImages(layer.querySelector('#editMaterialImages'), layer.querySelector('#editImageStatus'));
      let r=await api(`/api/requests/${x.id}/update`, {method:'POST', body:JSON.stringify(v)});
      layer.remove();
      toast(`修改成功，进入第 ${r.review_round} 次审批`);
      employeeDetail(x.id)
    }catch(err){
      let box=layer.querySelector('#editError');
      box.className='notice rule-warning';
      box.textContent=err.message
    }
  }
}

function adjustmentDialog(x, type){
  const isReturn=type==='return', layer=document.createElement('div');
  layer.className='modal';
  let policy=state.policies.find(p=>p.leave_type===x.leave_type);
  layer.innerHTML=`<form class="modal-card" id="adjustmentForm"><div class="toolbar"><h3>${isReturn?'提前返岗 / 销假':'申请续假'}</h3><button type="button" class="btn btn-ghost" id="closeAdjustment">关闭</button></div>
  <div class="notice">${isReturn?'应于返岗当日或返岗前办理，确认实际休假结束时间。':'必须在原批准假期届满前提出，经审批通过后方可继续休假。'}</div>
  ${x.leave_type==='法定病假'&&isReturn?'<div class="notice">病假返岗时，公司可依法、合理要求复工证明或健康评估，请按岗位要求准备材料。</div>':''}
  <div class="field"><label>${isReturn?'实际返岗时间':'续假至'}</label><input name="proposed_time" type="datetime-local" required></div><div class="field"><label>${isReturn?'提前返岗原因':'续假原因'}</label><textarea name="reason" required placeholder="请如实说明原因"></textarea></div>
  <label><input type="checkbox" name="pending_material"> 相关证明材料待补交</label><div class="field"><label>导入证明图片</label><input id="adjustmentImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><div id="adjustmentImageStatus" class="upload-status"></div></div><div class="field"><label>材料说明</label><textarea name="material_note" placeholder="${isReturn&&x.leave_type==='法定病假'?'复工证明或健康评估说明':isReturn?'返岗确认材料说明':'按 '+x.leave_type+' 要求补充证明材料'}"></textarea></div><div id="adjustmentError" class="hidden"></div><button class="btn btn-primary full">提交${isReturn?'销假':'续假'}审批</button></form>`;
  document.body.appendChild(layer);
  const close=()=>layer.remove();
  layer.querySelector('#closeAdjustment').onclick=close;
  layer.onclick=e=>{
    if(e.target===layer)close()
  };
  layer.querySelector('#adjustmentForm').onsubmit=async e=>{
    e.preventDefault();
    let v=Object.fromEntries(new FormData(e.target));
    v.adjustment_type=type;
    v.pending_material=!!e.target.pending_material.checked;
    try{
      v.attachment_tokens=await uploadSelectedImages(layer.querySelector('#adjustmentImages'), layer.querySelector('#adjustmentImageStatus'));
      await api(`/api/requests/${x.id}/adjustments`, {method:'POST', body:JSON.stringify(v)});
      close();
      toast(`${isReturn?'销假':'续假'}手续已提交审批`);
      employeeDetail(x.id)
    }catch(err){
      let box=layer.querySelector('#adjustmentError');
      box.className='notice rule-warning';
      box.textContent=err.message
    }
  }
}

async function adjustmentAdmin(){
  try{
    let d=await api('/api/admin/adjustments');
    let items=d.adjustments;
    $('#page').innerHTML=`<div class="hero"><h2>返岗、销假与续假审批</h2><div>审批流程与请假审批一致；待处理手续按提交时间排序。</div></div><div class="card"><div class="toolbar"><h3>${items.length} 条手续</h3><span class="hint">原则上1个工作日内处理</span></div><div class="table-wrap"><table><thead><tr><th>员工</th><th>原申请</th><th>手续类型</th><th>目标时间</th><th>原因 / 材料</th><th>状态</th><th>操作</th></tr></thead><tbody>${items.map(a=>`<tr><td><strong>${a.name}</strong><br>${a.username}</td><td>${a.request_no}<br><span class="hint">${a.leave_type}<br>${a.start_time} 至 ${a.end_time}</span></td><td><strong>${a.adjustment_type==='return'?'提前返岗 / 销假':'续假'}</strong></td><td>${a.proposed_time}</td><td>${a.reason}<br><span class="hint">材料：${a.material_status==='complete'?'已提交':'待补交'}<br>${a.material_note||''}</span></td><td><span class="badge ${a.status}">${labels[a.status]||a.status}</span>${a.overdue?'<br><span class="overdue">● 已超时</span>':''}${a.approver_comment?'<br>'+a.approver_comment:''}</td><td>${a.status==='pending'?`<div class="actions"><button class="action-approve" onclick="adjustmentAction(${a.id},'approve')">通过</button><button class="action-return" onclick="adjustmentReturnModal(${a.id})">打回</button></div>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">暂无返岗或续假手续</td></tr>'}</tbody></table></div></div>`
  }catch(e){
    toast(e.message, true)
  }
}

async function adjustmentAction(id, action, comment='', confirmed=false){
  if(action==='approve'&&!confirmed){
    approvalConfirmDialog('确认通过返岗 / 续假手续', '通过后将更新原请假结束时间、实际休假天数及对应假期余额。', ()=>adjustmentAction(id, action, '通过', true));
    return
  }try{
    await api(`/api/admin/adjustments/${id}/action`, {method:'POST', body:JSON.stringify({action, comment})});
    toast('处理完成');
    adjustmentAdmin()
  }catch(e){
    toast(e.message, true)
  }
}
function adjustmentReturnModal(id){
  const layer=document.createElement('div');
  layer.className='modal';
  layer.innerHTML=`<div class="modal-card"><div class="toolbar"><h3>打回手续</h3><button class="btn btn-ghost" id="closeAdjReturn">关闭</button></div><div class="field"><label>处理方式</label><select id="adjReturnType"><option value="return">退回修改</option><option value="supplement">要求补充材料</option><option value="reject">不通过</option></select></div><div class="field"><label id="adjReturnLabel">说明（选填）</label><textarea id="adjReturnComment" placeholder="填写退回原因、缺失材料或补交期限"></textarea></div><div id="adjReturnError" class="hidden"></div><button class="btn btn-danger full" id="confirmAdjReturn">确认打回</button></div>`;
  document.body.appendChild(layer);
  let close=()=>layer.remove(), select=layer.querySelector('#adjReturnType'), comment=layer.querySelector('#adjReturnComment');
  select.onchange=()=>{
    let reject=select.value==='reject';
    layer.querySelector('#adjReturnLabel').textContent=reject?'不通过缘由（必填）':'说明（选填）';
    comment.placeholder=reject?'请说明不通过的具体原因':'填写退回原因、缺失材料或补交期限'
  };
  layer.querySelector('#closeAdjReturn').onclick=close;
  layer.onclick=e=>{
    if(e.target===layer)close()
  };
  layer.querySelector('#confirmAdjReturn').onclick=()=>{
    let type=select.value, reason=comment.value.trim(), error=layer.querySelector('#adjReturnError');
    if(type==='reject'&&!reason){
      error.className='notice rule-warning';
      error.textContent='选择“不通过”时必须填写具体缘由。';
      comment.focus();
      return
    }close();
    adjustmentAction(id, type, reason)
  }
}

if(false){
  // 旧版登录记忆实现保留为迁移参考，不再执行。
const LOGIN_MEMORY_KEY='oaLeaveRememberedAccountsV1';
function rememberedAccounts(){
    try{
      return JSON.parse(localStorage.getItem(LOGIN_MEMORY_KEY)||'[]')
    }catch{
      return []
    }
  }
function saveRemembered(accounts){
    localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(accounts.slice(0, 8)))
  }
function similarity(a, b){
    a=a.toLowerCase();
    b=b.toLowerCase();
    if(!a||!b)return 0;
    if(a.includes(b)||b.includes(a))return .85;
    let m=a.length, n=b.length, d=Array.from({length:m+1}, (_, i)=>[i]);
    for(let j=1;j<=n;j++)d[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return 1-d[m][n]/Math.max(m, n)
  }
function setupLoginMemory(){
  const form=$('#auth');
    if(!form||form.dataset.memoryReady)return;
    form.dataset.memoryReady='1';
  const username=form.elements.username, password=form.elements.password, submit=form.querySelector('button[type="submit"],button:not([type])');
    username.autocomplete='username';
    password.autocomplete='current-password';
  const area=document.createElement('div');
    area.innerHTML=`<div id="accountSuggestions" class="account-suggestions hidden"></div><label class="remember-line"><input type="checkbox" id="rememberLogin" checked> 记住账号和密码（仅此浏览器）</label><div id="credentialNotice" class="hidden"></div>`;
    submit.before(area);
  const suggestions=area.querySelector('#accountSuggestions'), notice=area.querySelector('#credentialNotice'), remember=area.querySelector('#rememberLogin');
    let autofilled=false;
  const showNotice=(text, bad=false)=>{
      notice.className=bad?'credential-notice bad':'credential-notice';
      notice.textContent=text
    };
  const choose=account=>{
      username.value=account.username;
      suggestions.className='account-suggestions hidden';
      if(account.stale||!account.password){
        password.value='';
        autofilled=false;
        showNotice('该账号保存的密码可能已发生变更，请重新输入密码。', true);
        password.focus()
      }else{
        password.value=account.password;
        autofilled=true;
        showNotice(`已自动填入 ${account.username} 的已保存密码。`)
      }
    };
  const render=()=>{
      let value=username.value.trim(), accounts=rememberedAccounts();
      if(!value){
        suggestions.className='account-suggestions hidden';
        notice.className='hidden';
        password.value='';
        autofilled=false;
        return
      }let exact=accounts.find(x=>x.username.toLowerCase()===value.toLowerCase());
      if(exact){
        choose(exact);
        return
      }let matches=accounts.map(x=>({...x, score:similarity(value, x.username)})).filter(x=>x.score>=.25).sort((a, b)=>b.score-a.score).slice(0, 5);
      suggestions.innerHTML=matches.map(x=>`<button type="button" data-account="${x.username}"><span>${x.username}</span><small>${x.stale?'密码需更新':Math.round(x.score*100)+'% 相似'}</small></button>`).join('');
      suggestions.className=matches.length?'account-suggestions':'account-suggestions hidden';
      suggestions.querySelectorAll('button').forEach(b=>b.onclick=()=>choose(accounts.find(x=>x.username===b.dataset.account)))
    };
  username.addEventListener('input', render);
    username.addEventListener('focus', render);
    password.addEventListener('input', ()=>{if(autofilled&&password.value!==rememberedAccounts().find(x=>x.username===username.value)?.password)autofilled=false});
  form.onsubmit=async e=>{
      e.preventDefault();
      if(form.dataset.mode==='register'){
        let data=Object.fromEntries(new FormData(form));
        try{
          await api('/api/register', {method:'POST', body:JSON.stringify(data)});
          toast('注册成功，请登录');
          document.querySelector('[data-tab=login]').click()
        }catch(x){
          toast(x.message, true)
        }return
      }let data=Object.fromEntries(new FormData(form));
      try{
        await api('/api/login', {method:'POST', body:JSON.stringify(data)});
        let accounts=rememberedAccounts().filter(x=>x.username!==data.username);
        if(remember.checked)accounts.unshift({username:data.username, password:data.password, stale:false, lastUsed:Date.now()});
        else localStorage.removeItem(LOGIN_MEMORY_KEY);
        saveRemembered(accounts);
        await boot()
      }catch(x){
        let accounts=rememberedAccounts(), saved=accounts.find(a=>a.username===data.username);
        if(saved&&saved.password===data.password){
          saved.password='';
          saved.stale=true;
          saveRemembered(accounts);
          password.value='';
          autofilled=false;
          showNotice('保存的密码验证失败，密码可能已发生变更，请重新输入新密码。', true);
          password.focus()
        }else showNotice(x.message, true)
      }
    };
}

new MutationObserver(()=>setupLoginMemory()).observe(app, {childList:true, subtree:true});
}

const LOGIN_MEMORY_KEY='oa.leave.login-memory.v1';
function loginMemory(){
  try{
    let v=JSON.parse(localStorage.getItem(LOGIN_MEMORY_KEY)||'[]');
    return Array.isArray(v)?v:[]
  }catch{
    return[]
  }
}
function saveLoginMemory(account){
  let all=loginMemory().filter(x=>x.username!==account.username);
  all.unshift({...account, lastUsed:Date.now()});
  localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(all.slice(0, 8)))
}
function forgetLoginMemory(username){
  localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(loginMemory().filter(x=>x.username!==username)))
}
function textSafe(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function eyeClosedIcon(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5.2 9 5.2a14.6 14.6 0 0 1-2.3 2.8M6.2 6.2C4.2 7.5 3 9.2 3 9.2S6.5 15 12 15a9 9 0 0 0 3-.5"/></svg>`}
function eyeOpenIcon(){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-5.5 9-5.5S21 12 21 12s-3.5 5.5-9 5.5S3 12 3 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>`}
function accountSimilarity(a,b){a=a.toLowerCase();b=b.toLowerCase();if(!a)return .45;if(a===b)return 1;if(b.startsWith(a))return .92-a.length*.001;if(b.includes(a))return .82;let m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return 1-d[m][n]/Math.max(m,n)}

function login(){
  app.innerHTML=`<section class="login-shell"><div class="brand-panel"><div class="brand-mark">OA · 请假系统</div><div><h1>让每一次休假<br>清楚、有序、可追踪</h1><p>统一提交请假、材料补交、突发报备与审批记录。</p></div><small>内部系统 · 请妥善保管账号信息</small></div><div class="login-panel"><div class="auth-card"><h2>欢迎使用请假系统</h2><div class="auth-tabs"><button class="active" data-tab="login">账号登录</button><button data-tab="register">新员工注册</button></div><form id="auth" data-mode="login"><div id="extra"></div><div class="field account-field"><label>账号</label><input name="username" autocomplete="username" required placeholder="请输入账号"><div id="accountSuggestions" class="account-suggestions hidden"></div></div><div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"><div id="passwordNotice" class="hint"></div></div><label class="remember-check"><input type="checkbox" name="remember" checked> 在此设备记住账号和密码</label><div id="loginError" class="hidden"></div><button class="btn btn-primary full">登录</button></form><p class="hint">仅在个人或受信任设备启用密码记忆。演示员工：employee / 123456<br>演示审批员：approver / 123456</p></div></div></section>`;
  const form=$('#auth'),userInput=form.username,passInput=form.password,suggestions=$('#accountSuggestions'),notice=$('#passwordNotice');let selectedMemory=null;attachPasswordToggles(form);
  const renderSuggestions=()=>{if(form.dataset.mode!=='login')return;let q=userInput.value.trim(),memory=loginMemory(),exact=q&&memory.find(x=>x.username.toLowerCase()===q.toLowerCase());if(exact){selectedMemory=exact;passInput.value=exact.stale?'':exact.password;notice.textContent=exact.stale?'密码已修改，请输入一次修改后的新密码；登录成功后将重新建立记忆。':'已识别历史账号并自动填入上次成功登录的密码';suggestions.classList.add('hidden');return}let matches=memory.map(x=>({...x,score:accountSimilarity(q,x.username)})).filter(x=>!q||x.score>=.34).sort((a,b)=>b.score-a.score||b.lastUsed-a.lastUsed).slice(0,5);if(!matches.length){suggestions.classList.add('hidden');return}suggestions.innerHTML=matches.map(x=>`<button type="button" data-account="${textSafe(x.username)}"><span class="avatar">${textSafe(x.username[0]?.toUpperCase())}</span><span><strong>${textSafe(x.username)}</strong><small>${x.stale?'密码已修改 · 需要重新输入':(x.role==='approver'?'审批员账号':'员工账号')+' · 已记忆'}</small></span><span class="suggest-remove" data-remove="${textSafe(x.username)}" title="清除此账号">×</span></button>`).join('');suggestions.classList.remove('hidden');suggestions.querySelectorAll('[data-account]').forEach(b=>b.onclick=e=>{if(e.target.dataset.remove)return;chooseRemembered(loginMemory().find(x=>x.username===b.dataset.account))});suggestions.querySelectorAll('[data-remove]').forEach(b=>b.onclick=e=>{e.stopPropagation();forgetLoginMemory(b.dataset.remove);if(selectedMemory?.username===b.dataset.remove){selectedMemory=null;passInput.value='';notice.textContent=''}renderSuggestions()})};
  const chooseRemembered=item=>{if(!item)return;selectedMemory=item;userInput.value=item.username;passInput.value=item.stale?'':item.password;notice.textContent=item.stale?'密码已修改，请输入一次新密码以重新建立登录记忆。':'已自动填入此账号上次成功登录的密码';suggestions.classList.add('hidden');requestAnimationFrame(()=>passInput.focus())};
  suggestions.onpointerdown=e=>{e.preventDefault();e.stopPropagation();let remove=e.target.closest('[data-remove]');if(remove){let username=remove.dataset.remove;forgetLoginMemory(username);if(selectedMemory?.username===username){selectedMemory=null;passInput.value='';notice.textContent=''}renderSuggestions();return}let button=e.target.closest('[data-account]');if(button)chooseRemembered(loginMemory().find(x=>x.username===button.dataset.account))};
  userInput.oninput=()=>{selectedMemory=null;passInput.value='';notice.textContent='';renderSuggestions()};userInput.onfocus=renderSuggestions;userInput.onkeydown=e=>{if((e.key==='Enter'||e.key==='ArrowDown')&&!suggestions.classList.contains('hidden')){let first=suggestions.querySelector('[data-account]');if(first){e.preventDefault();chooseRemembered(loginMemory().find(x=>x.username===first.dataset.account))}}};
  document.onpointerdown=e=>{if(!e.target.closest('.account-field'))suggestions.classList.add('hidden')};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');let reg=b.dataset.tab==='register';form.dataset.mode=reg?'register':'login';$('#extra').innerHTML=reg?`<div class="two"><div class="field"><label>姓名</label><input name="name" required></div><div class="field"><label>性别</label><select name="gender"><option>女</option><option>男</option><option>其他</option></select></div></div><div class="two"><div class="field"><label>年龄</label><input name="age" type="number"></div><div class="field"><label>本单位工龄</label><input name="unit_years" type="number" step="0.5"></div></div><div class="field"><label>连续工龄</label><input name="continuous_years" type="number" step="0.5"></div>`:'';form.querySelector('button[type="submit"],button.btn-primary').textContent=reg?'注册账号':'登录';suggestions.classList.add('hidden')});
  form.onsubmit=async e=>{e.preventDefault();let data=Object.fromEntries(new FormData(form)),error=$('#loginError');error.className='hidden';if(form.dataset.mode==='register'){try{await api('/api/register',{method:'POST',body:JSON.stringify(data)});toast('注册成功，请登录');document.querySelector('[data-tab=login]').click()}catch(x){error.className='notice rule-warning';error.textContent=x.message}return}try{let result=await api('/api/login',{method:'POST',body:JSON.stringify(data)});if(form.remember.checked)saveLoginMemory({username:data.username,password:data.password,role:result.role});else forgetLoginMemory(data.username);boot()}catch(x){error.className='notice rule-warning';if(selectedMemory&&selectedMemory.username===data.username&&selectedMemory.password===data.password){error.innerHTML='<strong>此账号的密码可能已经发生变更。</strong><br>请重新输入新密码；登录成功后，系统会自动更新该账号的记忆密码。';passInput.value='';passInput.focus();notice.textContent='记忆密码已失效，请输入当前密码'}else error.textContent=x.message}}
}

function profile(){
  const savedCredential=loginMemory().find(x=>x.username===state.me.username);
  const hasSavedPassword=!!savedCredential?.password&&!savedCredential?.stale;
  $('#page').innerHTML=`<div class="grid"><div class="card span5"><h3>个人基础信息</h3><p><span class="hint">姓名</span><br><strong>${state.me.name}</strong></p><p><span class="hint">性别 / 年龄</span><br><strong>${state.me.gender||'—'} / ${state.me.age||'—'} 岁</strong></p><p><span class="hint">本单位工龄</span><br><strong>${state.me.unit_years} 年</strong></p><p><span class="hint">连续工龄</span><br><strong>${state.me.continuous_years} 年</strong></p><p><span class="hint">法定年休假额度</span><br><strong>${state.me.annual_leave_entitlement} 个工作日</strong></p><p><span class="hint">医疗期参考</span><br><strong>${state.me.medical_period_months} 个月</strong></p></div>
  <div class="card span7"><h3>账号与密码</h3><div class="account-security"><div><span class="hint">登录账号</span><strong>${textSafe(state.me.username)}</strong></div><div><span class="hint">账号类型</span><strong>${state.me.role==='approver'?'审批员':'普通员工'}</strong></div><div><span class="hint">本设备记忆密码</span><div class="saved-password"><strong id="savedPassword">${hasSavedPassword?'••••••••':(savedCredential?.stale?'等待下次登录重新记忆':'未在此设备保存')}</strong>${hasSavedPassword?`<button type="button" id="viewSavedPassword" class="password-toggle" aria-label="查看密码" title="查看密码">${eyeClosedIcon()}</button>`:''}</div></div></div><div class="notice">服务器不保存可读取的密码明文。修改密码后，本设备会清除旧密码；下次手动输入新密码登录成功后才重新记忆。</div><button class="btn btn-danger" id="changePassword">修改密码</button></div>
  <div class="card span12"><h3>所有类型假期余额 / 管理额度</h3><div class="balance-grid">${state.balances.filter(x=>state.policies.some(p=>p.leave_type===x.leave_type)).map(x=>`<div class="balance"><span>${x.leave_type}</span><strong>${x.remaining_days} 天</strong></div>`).join('')}</div><p class="hint">法定病假显示的是医疗期管理参考天数，并非当然可一次性请休的假期余额。</p></div></div>`;
  $('#changePassword').onclick=changePasswordDialog;if(hasSavedPassword){let visible=false;$('#viewSavedPassword').onclick=()=>{visible=!visible;$('#savedPassword').textContent=visible?savedCredential.password:'••••••••';$('#viewSavedPassword').innerHTML=visible?eyeOpenIcon():eyeClosedIcon();$('#viewSavedPassword').title=visible?'遮挡密码':'查看密码';$('#viewSavedPassword').setAttribute('aria-label',visible?'遮挡密码':'查看密码')}};
}

function changePasswordDialog(){
  const layer=document.createElement('div');layer.className='modal';layer.innerHTML=`<form class="modal-card" id="passwordForm"><div class="toolbar"><h3>修改登录密码</h3><button type="button" class="btn btn-ghost" id="closePassword">关闭</button></div><div class="field"><label>当前密码</label><input name="current_password" type="password" autocomplete="current-password" required></div><div class="field"><label>新密码</label><input name="new_password" type="password" autocomplete="new-password" minlength="6" required><span class="hint">至少6个字符，不能与当前密码相同</span></div><div class="field"><label>确认新密码</label><input name="confirm_password" type="password" autocomplete="new-password" minlength="6" required></div><div id="passwordError" class="hidden"></div><button class="btn btn-primary full">确认修改</button></form>`;document.body.appendChild(layer);
  attachPasswordToggles(layer);const close=()=>layer.remove();layer.querySelector('#closePassword').onclick=close;layer.onclick=e=>{if(e.target===layer)close()};layer.querySelector('#passwordForm').onsubmit=async e=>{e.preventDefault();let v=Object.fromEntries(new FormData(e.target)),error=layer.querySelector('#passwordError');if(v.new_password!==v.confirm_password){error.className='notice rule-warning';error.textContent='两次输入的新密码不一致';return}try{await api('/api/change-password',{method:'POST',body:JSON.stringify(v)});let remembered=loginMemory().find(x=>x.username===state.me.username);if(remembered)saveLoginMemory({...remembered,password:'',stale:true});close();toast('密码修改成功；下次登录需手动输入一次新密码，成功后将重新记忆')}catch(err){error.className='notice rule-warning';error.textContent=err.message}}
}

function attachmentGallery(items=[]){if(!items.length)return'<p class="hint">尚未上传证明图片</p>';return`<div class="attachment-gallery">${items.map(x=>`<a href="${x.url}" target="_blank" rel="noopener" title="打开 ${textSafe(x.original_name)}"><img src="${x.url}" alt="${textSafe(x.original_name)}"><span>${textSafe(x.original_name)}</span></a>`).join('')}</div>`}
async function uploadSelectedImages(input,status){const files=[...(input?.files||[])];if(!files.length)return[];const allowed=['image/jpeg','image/png','image/webp','image/gif'];for(const file of files){if(!allowed.includes(file.type))throw Error(`${file.name} 不是支持的图片格式`);if(file.size>8*1024*1024)throw Error(`${file.name} 超过8MB`)}if(status)status.textContent=`正在上传 0 / ${files.length}`;let done=0,tokens=[];for(const file of files){let data=await new Promise((resolve,reject)=>{let reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(`无法读取 ${file.name}`));reader.readAsDataURL(file)});let result=await api('/api/upload',{method:'POST',body:JSON.stringify({filename:file.name,mime_type:file.type,data})});tokens.push(result.token);done++;if(status)status.textContent=`已上传 ${done} / ${files.length}：${files.slice(0,done).map(x=>x.name).join('、')}`}return tokens}

function attachPasswordToggles(root=document){root.querySelectorAll('input[type="password"]').forEach(input=>{if(input.parentElement.classList.contains('password-input-wrap'))return;let wrap=document.createElement('div');wrap.className='password-input-wrap';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);let button=document.createElement('button');button.type='button';button.className='password-toggle';button.innerHTML=eyeClosedIcon();button.title='查看密码';button.setAttribute('aria-label','查看密码');button.onclick=()=>{let visible=input.type==='text';input.type=visible?'password':'text';button.innerHTML=visible?eyeClosedIcon():eyeOpenIcon();button.title=visible?'查看密码':'遮挡密码';button.setAttribute('aria-label',button.title)};wrap.appendChild(button)})}

// 2026 HR SaaS 界面层：保留现有业务逻辑，重组关键信息层级。
function shell(){let admin=state.me.role==='approver';app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="logo"><span class="logo-symbol">OA</span><span>请假系统</span></div><nav class="nav">${admin?`<span class="nav-group">审批工作</span><button data-page="admin">待办审批</button><button data-page="adjustments">返岗与续假</button><button data-page="history">审批记录</button><button data-page="delegation">审批代理</button><span class="nav-group">管理</span><button data-page="hr">假期管理</button>`:`<span class="nav-group">我的工作台</span><button data-page="home">工作台</button><button data-page="apply">发起请假</button><button data-page="profile">我的假期余额</button><button data-page="records">我的请假记录</button><button data-page="guide">制度与流程</button>`}<button data-page="notifications" class="notification-nav"><span>消息通知</span><span id="notificationBadge" class="notification-badge ${state.unread?'':'hidden'}">${state.unread>99?'99+':state.unread}</span></button></nav><div class="user-mini"><div class="avatar">${state.me.name[0]}</div><div><strong>${state.me.name}</strong><br><small>${admin?'审批员':'员工'} · ${state.me.department||'综合管理部'}</small></div>${admin&&state.me.linked_employee_id?`<button class="mini-switch" id="switchEmployee" type="button">切换员工账号</button>`:(!admin&&state.me.linked_approver_id?`<button class="mini-switch" id="switchEmployee" type="button">切换审批账号</button>`:'')}<button class="mini-logout" id="logoutMini" type="button">退出登录</button></div></aside><section class="content"><header class="topbar"><div><h2 id="title"></h2><span class="topbar-subtitle" id="subtitle"></span></div><button class="btn btn-danger" id="logout">退出</button></header><main class="page" id="page"></main></section></div><button id="aiFab" class="ai-fab" title="AI 助手">AI<span class="ai-fab-dot"></span></button><div class="ai-fab-tip hidden">问制度 · 帮我请假</div><div id="aiModal" class="ai-modal hidden"><div class="ai-modal-card"><div class="ai-modal-head"><span>AI 助手</span><button type="button" id="aiClose">×</button></div><div id="aiModalBody" class="ai-modal-body"></div></div></div>`;document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>navigate(x.dataset.page));$('#logout').onclick=async()=>{clearInterval(state.notificationTimer);await api('/api/logout',{method:'POST'});login()};$('#logoutMini').onclick=$('#logout').onclick;initAIFab();initAIFabTip();const sw=$('#switchEmployee');if(sw)sw.onclick=switchToEmployeeAccount;$('#aiClose').onclick=closeAI;$('#aiModal').onmousedown=e=>{e.currentTarget._aiDown=(e.target===e.currentTarget)};$('#aiModal').onmouseup=e=>{if(e.currentTarget._aiDown&&e.target===e.currentTarget)closeAI()}}

async function navigate(page){state.page=page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));let meta={home:['工作台','查看假期概况与待办'],apply:['发起请假','填写时间、假种和必要材料'],records:['我的请假记录','跟踪申请状态与审批轨迹'],profile:['我的假期余额','查看当前可用额度'],guide:['制度与流程','请假、补材料与返岗办理说明'],admin:['待办审批','优先处理临近时限的申请'],delegation:['审批代理','设置请假期间的审批代理人'],adjustments:['返岗与续假','审批员工的销假与续假手续'],history:['审批记录','查看已处理和二次审批记录'],hr:['HR 假期管理','全局假期制度和使用概况'],notifications:['消息通知','查看最新申请与审批变更']};$('#title').textContent=meta[page]?.[0]||'';$('#subtitle').textContent=meta[page]?.[1]||'';if(page==='home')home();if(page==='apply')applyPage();if(page==='records')await records();if(page==='guide')guide();if(page==='profile')profile();if(page==='admin'||page==='history')await admin(page);if(page==='delegation')await delegationPage();if(page==='adjustments')await adjustmentAdmin();if(page==='notifications')await notificationsPage();if(page==='ai')aiPage();if(page==='hr')await hrAdmin()}

function profile(){const saved=loginMemory().find(x=>x.username===state.me.username);$('#page').innerHTML=`<section class="balance-overview"><div><span class="eyebrow">可用假期</span><h3>${state.me.name}的假期账户</h3><p>${state.me.department||'综合管理部'} · 连续工龄 ${state.me.continuous_years} 年</p></div><button class="btn btn-primary" onclick="navigate('apply')">发起请假</button></section><div class="balance-saas-grid">${state.balances.filter(x=>state.policies.some(p=>p.leave_type===x.leave_type)).map(x=>{let p=state.policies.find(p=>p.leave_type===x.leave_type);return`<article class="balance-saas-card"><div><span>${x.leave_type}</span><small>${p?.unit||'天'}计算</small></div><strong>${fmtDays(x.remaining_days)}<em>天</em></strong><p>${textSafe(p?.limit||'')}</p></article>`}).join('')}</div><div class="grid account-panel"><section class="card span5"><h3>个人信息</h3><dl class="info-list"><div><dt>部门</dt><dd>${state.me.department||'综合管理部'}</dd></div><div><dt>本单位工龄</dt><dd>${state.me.unit_years} 年</dd></div><div><dt>连续工龄</dt><dd>${state.me.continuous_years} 年</dd></div></dl></section><section class="card span7"><h3>账号安全</h3><dl class="info-list"><div><dt>登录账号</dt><dd>${textSafe(state.me.username)}</dd></div><div><dt>本设备密码记忆</dt><dd>${saved?.password&&!saved.stale?'已启用':'未启用'}</dd></div></dl><button class="btn btn-ghost" id="changePassword">修改密码</button></section></div>`;$('#changePassword').onclick=changePasswordDialog}

async function records(){let d=await api('/api/requests');state.requests=d.requests;$('#page').innerHTML=`<div class="section-toolbar"><div><strong>${d.requests.length}</strong> 条申请记录</div><button class="btn btn-primary" onclick="navigate('apply')">新建申请</button></div><div class="request-card-list">${d.requests.map(x=>`<article class="request-card" onclick="employeeDetail(${x.id})"><div class="request-card-main"><div class="request-type-icon">${x.leave_type.slice(0,1)}</div><div><div class="request-card-title"><strong>${x.leave_type}</strong><span class="badge ${x.status}">${labels[x.status]||x.status}</span></div><p>${x.start_time.slice(0,10)} 至 ${x.end_time.slice(0,10)} · ${fmtDays(x.days)} 天</p><small>${textSafe(x.reason||'无需填写请假事由')}</small></div></div><div class="request-card-meta"><span>${x.request_no}</span><time>${x.submitted_at}</time><b>查看详情 →</b></div></article>`).join('')||'<div class="empty-state">暂无请假记录</div>'}</div>`}

async function admin(page){let d=await api('/api/admin/requests'),items=d.requests;if(page==='admin')items=items.filter(x=>['pending','reported','supplement_required'].includes(x.status));$('#page').innerHTML=`<div class="section-toolbar"><div><strong>${items.length}</strong> ${page==='admin'?'条待处理':'条审批记录'}</div><span class="sla-note">标准处理时限：1 个工作日</span></div><div class="approval-list">${items.map(x=>approvalCard(x,page)).join('')||'<div class="empty-state">暂无待处理申请</div>'}</div>`}
function approvalCard(x,page){let active=['pending','reported','supplement_required'].includes(x.status);return`<article class="approval-card ${x.overdue?'is-overdue':''}" onclick="adminDetail(${x.id}, '${page}')"><header><div><span class="employee-name">${textSafe(x.name)}</span><span class="department-tag">${textSafe(x.department||'综合管理部')}</span></div><div><span class="badge ${x.status}">${labels[x.status]||x.status}</span>${x.overdue?'<span class="overdue">已超时</span>':''}</div></header><div class="approval-summary"><div class="summary-primary"><span class="leave-type">${x.leave_type}</span><strong>${x.start_time.slice(0,10)} — ${x.end_time.slice(0,10)}</strong><small>${fmtDays(x.days)} 天 · ${x.emergency_report?'突发报备':'普通申请'}</small></div><div class="reason-brief"><span>请假原因</span><p>${textSafe(x.reason||'无需填写')}</p></div><div>${active?balanceDecision(x,true):''}</div></div><footer><span>${x.request_no} · 提交于 ${x.submitted_at}</span><div class="actions">${active?`<button class="action-approve" onclick="event.stopPropagation();action(${x.id}, 'approve')">通过</button><button class="action-return" onclick="event.stopPropagation();openReturnModal(${x.id})">打回</button>`:''}<button class="action-view" onclick="event.stopPropagation();adminDetail(${x.id}, '${page}')">查看详情</button></div></footer></article>`}

async function adminDetail(id,returnPage=state.page){await readRequestNotifications(id);try{let d=await api(`/api/admin/requests/${id}${returnPage==='history'?'?all=1':''}`),x=d.request,active=['pending','reported','supplement_required'].includes(x.status);$('#title').textContent='请假申请详情';$('#page').innerHTML=`<button class="back-link" id="backAdmin">← 返回</button><section class="approval-detail-summary"><header><div><span class="eyebrow">申请单 ${x.request_no}</span><h2>${textSafe(x.name)} · ${x.leave_type}</h2><p>${textSafe(x.department||'综合管理部')} · ${x.username}</p></div><span class="badge ${x.status}">${labels[x.status]||x.status}</span></header><div class="summary-grid"><div><span>请假日期</span><strong>${x.start_time.slice(0,10)}<br>${x.end_time.slice(0,10)}</strong></div><div><span>请假时长</span><strong>${fmtDays(x.days)} 天</strong></div><div class="summary-reason"><span>请假原因</span><strong>${textSafe(x.reason||'无需填写')}</strong></div></div>${active?balanceDecision(x):''}<div class="detail-actions">${active?`<button class="btn action-approve" onclick="action(${x.id}, 'approve')">通过申请</button><button class="btn action-return" onclick="openReturnModal(${x.id})">打回申请</button>`:''}</div></section><div class="detail-columns"><section class="card"><h3>申请与材料</h3><dl class="info-list"><div><dt>计算口径</dt><dd>${x.policy_unit||'—'}</dd></div><div><dt>申请时限</dt><dd>${x.timely?'符合':'未符合'} · 实际提前 ${x.advance_actual} 个工作日</dd></div><div><dt>材料状态</dt><dd>${x.material_status==='complete'?'已提交':'待补交'}</dd></div><div><dt>突发报备</dt><dd>${x.emergency_report?'已报备':'否'}</dd></div></dl>${attachmentGallery(d.attachments)}</section><section class="card"><h3>审批历史</h3><div class="timeline">${d.logs.length?d.logs.map(l=>`<div><i></i><strong>${({approve:'通过',reject:'不通过',return:'退回修改',supplement:'要求材料',remind:'提醒补交'})[l.action]||l.action}</strong><span>${textSafe(l.approver_name)} · ${l.created_at}</span><p>${textSafe(l.comment||'无留言')}</p></div>`).join(''):'<div class="empty-state small">暂无审批记录</div>'}</div></section></div>`;$('#backAdmin').textContent=returnPage==='notifications'?'← 返回消息通知':'← 返回列表';$('#backAdmin').onclick=()=>navigate(returnPage);if(active&&x.user_id===state.me.id){const da=document.querySelector('.detail-actions');if(da)da.innerHTML='<div class="notice">不能审批自己的请假申请</div>';}}catch(e){toast(e.message,true)}}

async function hrAdmin(){try{let d=await api('/api/admin/hr-summary'),counts=d.status_counts||{};$('#page').innerHTML=`<div class="kpi-grid"><article><span>在职员工</span><strong>${d.employees}</strong><small>人</small></article><article><span>待审批</span><strong>${(counts.pending||0)+(counts.reported||0)+(counts.supplement_required||0)}</strong><small>条</small></article><article><span>已通过</span><strong>${counts.approved||0}</strong><small>条</small></article><article><span>退回 / 不通过</span><strong>${(counts.returned||0)+(counts.rejected||0)}</strong><small>条</small></article></div><div class="detail-columns hr-columns"><section class="card"><h3>假期使用概况</h3><div class="management-list">${d.usage.map(x=>`<div><strong>${x.leave_type}</strong><span>${x.request_count} 笔申请</span><span>已批准 ${fmtDays(x.approved_days)} 天</span><span>待审 ${fmtDays(x.pending_days)} 天</span></div>`).join('')}</div></section><section class="card"><h3>假期制度配置</h3><div class="policy-admin-list">${d.policies.filter(p=>p.application_required!==false).map(p=>`<details><summary><strong>${p.leave_type}</strong><span>${p.unit}</span></summary><p>${textSafe(p.limit)}</p><small>${textSafe(p.timing)}</small></details>`).join('')}</div></section></div><div class="privacy-note">权限说明：本页仅展示全局汇总与制度，不展示员工的完整病假历史或其他敏感明细。</div>`}catch(e){toast(e.message,true)}}

async function home(){try{let d=await api('/api/requests'),items=d.requests||[];state.requests=items;let waiting=items.filter(x=>['pending','reported','supplement_required'].includes(x.status)).length,approved=items.filter(x=>x.status==='approved').length,recent=items.slice(0,3);$('#page').innerHTML=`<section class="workspace-welcome"><div><span class="eyebrow">员工工作台</span><h2>${greeting()}，${textSafe(state.me.name)}</h2><p>从这里发起申请、查看进度和处理待补交事项。</p></div><button class="btn btn-primary" onclick="navigate('apply')">发起请假</button></section><div class="work-kpis"><button onclick="navigate('records')"><span>审批中</span><strong>${waiting}</strong><small>查看进度 →</small></button><button onclick="navigate('records')"><span>已通过</span><strong>${approved}</strong><small>查看记录 →</small></button><button onclick="navigate('notifications')"><span>未读消息</span><strong>${state.unread||0}</strong><small>打开消息 →</small></button></div><div class="workspace-grid"><section class="card"><div class="card-heading"><div><h3>最近申请</h3><p>按提交时间显示最新记录</p></div><button class="text-button" onclick="navigate('records')">查看全部</button></div><div class="recent-list">${recent.map(x=>`<button onclick="employeeDetail(${x.id})"><span class="request-type-icon">${x.leave_type[0]}</span><span><strong>${x.leave_type}</strong><small>${x.start_time.slice(0,10)} 至 ${x.end_time.slice(0,10)} · ${fmtDays(x.days)} 天</small></span><span class="badge ${x.status}">${labels[x.status]||x.status}</span></button>`).join('')||'<div class="empty-state small">暂无请假申请</div>'}</div></section><aside class="card quick-actions"><h3>快捷操作</h3><button onclick="navigate('profile')"><strong>查看假期余额</strong><small>按假种查看当前可用天数</small></button><button onclick="navigate('notifications')"><strong>处理消息通知</strong><small>查看审批结果与补交提醒</small></button><button onclick="navigate('guide')"><strong>查看制度与流程</strong><small>了解申请时限和材料要求</small></button></aside></div>`}catch(e){toast(e.message,true)}}

function recordCards(items){return items.map(x=>`<article class="request-card" onclick="employeeDetail(${x.id})"><div class="request-card-main"><div class="request-type-icon">${x.leave_type.slice(0,1)}</div><div><div class="request-card-title"><strong>${x.leave_type}</strong><span class="badge ${x.status}">${labels[x.status]||x.status}</span></div><p>${x.start_time.slice(0,10)} 至 ${x.end_time.slice(0,10)} · ${fmtDays(x.days)} 天</p><small>${textSafe(x.reason||'无需填写请假事由')}</small></div></div><div class="request-card-meta"><span>${x.request_no}</span><time>${x.submitted_at}</time><b>查看详情 →</b></div></article>`).join('')||'<div class="empty-state">没有符合条件的申请</div>'}
async function records(){let d=await api('/api/requests'),all=d.requests||[];state.requests=all;let types=[...new Set(all.map(x=>x.leave_type))];$('#page').innerHTML=`<div class="filter-bar"><div class="search-field"><span>⌕</span><input id="recordSearch" placeholder="搜索申请单号、假种或事由"></div><select id="recordStatus"><option value="">全部状态</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><select id="recordType"><option value="">全部假种</option>${types.map(x=>`<option>${x}</option>`).join('')}</select><button class="btn btn-primary" onclick="navigate('apply')">新建申请</button></div><div class="result-count" id="recordCount"></div><div class="request-card-list" id="recordResults"></div>`;let render=()=>{let q=$('#recordSearch').value.trim().toLowerCase(),status=$('#recordStatus').value,type=$('#recordType').value,items=all.filter(x=>(!status||x.status===status)&&(!type||x.leave_type===type)&&(!q||`${x.request_no} ${x.leave_type} ${x.reason}`.toLowerCase().includes(q)));$('#recordCount').textContent=`共 ${items.length} 条记录`;$('#recordResults').innerHTML=recordCards(items)};$('#recordSearch').oninput=render;$('#recordStatus').onchange=render;$('#recordType').onchange=render;render()}

async function admin(page){let d=await api(page==='history'?'/api/admin/requests?all=1':'/api/admin/requests'),all=d.requests||[];if(page==='admin')all=all.filter(x=>['pending','reported','supplement_required'].includes(x.status));let types=[...new Set(all.map(x=>x.leave_type))],departments=[...new Set(all.map(x=>x.department||'综合管理部'))];$('#page').innerHTML=`<div class="filter-bar approval-filters"><div class="search-field"><span>⌕</span><input id="approvalSearch" placeholder="搜索员工、单号或原因"></div><select id="approvalType"><option value="">全部假种</option>${types.map(x=>`<option>${x}</option>`).join('')}</select><select id="approvalDepartment"><option value="">全部部门</option>${departments.map(x=>`<option>${x}</option>`).join('')}</select><select id="approvalOrder"><option value="time">最新提交</option><option value="urgent">超时优先</option></select></div><div class="section-toolbar"><div id="approvalCount"></div><span class="sla-note">标准处理时限：1 个工作日</span></div><div class="approval-list" id="approvalResults"></div>`;let render=()=>{let q=$('#approvalSearch').value.trim().toLowerCase(),type=$('#approvalType').value,department=$('#approvalDepartment').value,items=all.filter(x=>(!type||x.leave_type===type)&&(!department||(x.department||'综合管理部')===department)&&(!q||`${x.name} ${x.request_no} ${x.reason}`.toLowerCase().includes(q)));if($('#approvalOrder').value==='urgent')items.sort((a,b)=>b.overdue-a.overdue||a.submitted_at.localeCompare(b.submitted_at));$('#approvalCount').innerHTML=`<strong>${items.length}</strong> ${page==='admin'?'条待处理':'条审批记录'}`;$('#approvalResults').innerHTML=items.map(x=>approvalCard(x,page)).join('')||'<div class="empty-state">没有符合条件的申请</div>'};['approvalSearch','approvalType','approvalDepartment','approvalOrder'].forEach(id=>$('#'+id).addEventListener(id==='approvalSearch'?'input':'change',render));render()}

// 普通访问或刷新一律先进登录页；带 ?request= 的详情深链直接进入。
if(new URLSearchParams(location.search).get('request'))boot();else login();

// ===== AI 助手（悬浮窗 + 弹窗） =====
function openAI(){
  const m=$('#aiModal');
  m.classList.remove('hidden');
  aiPage();
  $('#aiFab').classList.add('hidden');
}
function closeAI(){
  $('#aiModal').classList.add('hidden');
  $('#aiFab').classList.remove('hidden');
}
function aiPage(){
  const isApprover=state.me.role==='approver';
  let cards='';
  cards+='<div class="ai-card"><h3>制度问答</h3><div class="field"><input id="aiQ" class="ai-input" autocomplete="off" name="aiQ" placeholder="例如：婚假要提前几天申请、需要什么材料"><div id="aiQHist" class="ai-hist"></div></div><button class="btn btn-primary" id="aiAsk">提问</button><div class="ai-out" id="aiQAOut"></div></div>';
  if(!isApprover){cards+='<div class="ai-card"><h3>智能填单</h3><div class="field"><input id="aiP" class="ai-input" autocomplete="off" name="aiP" placeholder="例如：10月10日到10月12日休年假"><div id="aiPHist" class="ai-hist"></div></div><button class="btn btn-primary" id="aiParse">解析</button><div class="ai-out" id="aiParseOut"></div></div>';}
  if(isApprover){
    cards+='<div class="ai-card"><h3>审批智能校验</h3><div class="ai-req-list" id="aiReqList"></div><button class="btn btn-primary" id="aiReviewBatch" style="margin-top:8px">批量预审待办</button><div class="ai-out" id="aiReviewOut"></div><div class="hint" id="aiStatus"></div></div>';
  }else{
    cards+='<div class="ai-card"><h3>我的申请预审</h3><div class="ai-req-list" id="aiReqList"></div><div class="ai-out" id="aiReviewOut"></div><div class="hint" id="aiStatus"></div></div>';
  }
  $('#aiModalBody').innerHTML=cards;

  aiLoadMemory();
  $('#aiAsk').onclick=async()=>{
    const q=$('#aiQ').value.trim();
    aiRemember('aiQList','ai_qa_history',q);
    if(!q){toast('请输入问题',true);return}
    $('#aiQAOut').innerHTML='<div class="ai-loading">思考中…</div>';
    try{const d=await api('/api/ai/qa',{method:'POST',body:JSON.stringify({question:q})});aiRenderQA(d,q)}catch(e){$('#aiQAOut').innerHTML='<span class="badge returned">'+aiEscape(e.message)+'</span>'}
  };
  if(!isApprover){
    $('#aiParse').onclick=async()=>{
      const t=$('#aiP').value.trim();
      aiRemember('aiPList','ai_parse_history',t);
      if(!t){toast('请先说一句话',true);return}
      $('#aiParseOut').innerHTML='<div class="ai-loading">解析中…</div>';
      try{const d=await api('/api/ai/parse',{method:'POST',body:JSON.stringify({text:t})});aiParsed=d;aiRenderParse(d);if(d.follow_up)toast(d.follow_up)}catch(e){$('#aiParseOut').innerHTML='<span class="badge returned">'+aiEscape(e.message)+'</span>'}
    };
  }
  $('#aiQ').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();$('#aiAsk').click()}};
  if(!isApprover){
    $('#aiP').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();$('#aiParse').click()}};
    $('#aiParse').onclick=async()=>{
      const t=$('#aiP').value.trim();
      aiRemember('aiPList','ai_parse_history',t);
      if(!t){toast('请先说一句话',true);return}
      $('#aiParseOut').innerHTML='<div class="ai-loading">解析中…</div>';
      try{const d=await api('/api/ai/parse',{method:'POST',body:JSON.stringify({text:t})});aiParsed=d;aiRenderParse(d);if(d.follow_up)toast(d.follow_up)}catch(e){$('#aiParseOut').innerHTML='<span class="badge returned">'+aiEscape(e.message)+'</span>'}
    };
  }
  if(isApprover){
    $('#aiReviewBatch').onclick=async()=>{
      $('#aiReviewOut').innerHTML='<div class="ai-loading">批量预审中…</div>';
      try{const d=await api('/api/ai/review-batch',{method:'POST',body:'{}'});aiRenderBatch(d)}catch(e){$('#aiReviewOut').innerHTML='<span class="badge returned">'+aiEscape(e.message)+'</span>'}
    };
  }
  aiLoadReqs();
  api('/api/ai/status').then(s=>{
    $('#aiStatus').innerHTML='<span class="hint">检索模式：'+(s.vector_mode==='embedding-api'?'Embedding 接口':'字符 n-gram 兜底')+' · 大模型：'+(s.llm_configured?'已接入':'未接入（规则兜底）')+'</span> <button class="btn btn-ghost" id="aiTest">测试大模型连接</button>';
    $('#aiTest').onclick=async()=>{try{const d=await api('/api/ai/test-llm',{method:'POST',body:'{}'});toast(d.ok?('连接成功：'+d.reply):d.message, !d.ok)}catch(e){toast(e.message,true)}};
  }).catch(()=>{});
}

function aiEscape(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function mdToHtml(md){let s=aiEscape(md==null?'':String(md));s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');s=s.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');s=s.replace(/^#{1,4}\s*(.*)$/gm,'<strong>$1</strong>');s=s.replace(/^\s*[-•]\s+(.*)$/gm,'&nbsp;&nbsp;• $1');s=s.replace(/^\s*(\d+)[.、]\s*(.*)$/gm,'&nbsp;&nbsp;$1. $2');s=s.replace(/\n/g,'<br>');return s}
let aiFabDrag = null;
let aiFabMoved = false;
let aiFabInited = false;
function initAIFab(){
  const fab = $('#aiFab');
  if(!fab)return;
  fab.onmousedown = function(e){
    aiFabDrag = {sx:e.clientX, sy:e.clientY, left:fab.getBoundingClientRect().left, top:fab.getBoundingClientRect().top};
    aiFabMoved = false;
    e.preventDefault();
  };
  fab.onclick = function(){
    if(aiFabMoved){ aiFabMoved = false; return; }
    openAI();
  };
  if(aiFabInited) return;
  aiFabInited = true;
  document.addEventListener('mousemove', function(e){
    if(!aiFabDrag) return;
    const dx = e.clientX - aiFabDrag.sx;
    const dy = e.clientY - aiFabDrag.sy;
    if(Math.abs(dx) + Math.abs(dy) > 4) aiFabMoved = true;
    if(aiFabMoved){
      const w = fab.offsetWidth || 54;
      const h = fab.offsetHeight || 54;
      let left = aiFabDrag.left + dx;
      let top = aiFabDrag.top + dy;
      left = Math.max(-w/2, Math.min(window.innerWidth - w/2, left));
      top = Math.max(-h/2, Math.min(window.innerHeight - h/2, top));
      fab.style.left = left + 'px';
      fab.style.top = top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }
  });
  document.addEventListener('mouseup', function(){ aiFabDrag = null; });
}
function initAIFabTip(){
  const tip=document.querySelector('.ai-fab-tip');
  const dot=document.querySelector('.ai-fab-dot');
  if(!tip||!dot)return;
  if(!localStorage.getItem('ai_tip_shown')){
    setTimeout(function(){tip.classList.remove('hidden')},1500);
    setTimeout(function(){tip.classList.add('hidden');localStorage.setItem('ai_tip_shown','1')},8000);
  }
  const fab=$('#aiFab');
  if(fab)fab.addEventListener('click',function(){dot.classList.add('hidden')});
}
function aiLoadMemory(){
  aiRenderHistory('aiQHist','ai_qa_history','aiQ');
  aiRenderHistory('aiPHist','ai_parse_history','aiP');
}
function aiRenderHistory(histId,key,inputId){
  let a=[];
  try{a=JSON.parse(localStorage.getItem(key)||'[]')}catch(e){}
  const el=document.getElementById(histId);
  if(!el)return;
  if(!a.length){el.innerHTML='';return}
  el.innerHTML='<div class="ai-hist-head"><span class="ai-hist-label">历史</span><button type="button" class="ai-hist-clear" data-key="'+key+'">清空</button></div><div class="ai-hist-chips">'+a.map(function(x,i){
    return '<span class="ai-hist-item"><span class="ai-hist-text" data-fill="'+aiEscape(x)+'" data-input="'+inputId+'">'+aiEscape(x)+'</span><button type="button" class="ai-hist-del" data-key="'+key+'" data-idx="'+i+'" title="删除">×</button></span>';
  }).join('')+'</div>';
  el.querySelectorAll('.ai-hist-text').forEach(function(t){
    t.onclick=function(){const inp=document.getElementById(t.getAttribute('data-input'));if(inp)inp.value=t.getAttribute('data-fill');};
  });
  el.querySelectorAll('.ai-hist-del').forEach(function(d){
    d.onclick=function(){aiDeleteMemory(d.getAttribute('data-key'),parseInt(d.getAttribute('data-idx'),10));};
  });
  const clr=el.querySelector('.ai-hist-clear');
  if(clr)clr.onclick=function(){aiClearMemory(clr.getAttribute('data-key'));};
}
function aiClearMemory(key){
  try{localStorage.removeItem(key)}catch(e){}
  aiLoadMemory();
}
function aiDeleteMemory(key,idx){
  try{
    let a=JSON.parse(localStorage.getItem(key)||'[]');
    a.splice(idx,1);
    localStorage.setItem(key,JSON.stringify(a));
  }catch(e){}
  if(key==='ai_qa_history'){aiRenderHistory('aiQHist',key,'aiQ');}
  else{aiRenderHistory('aiPHist',key,'aiP');}
}
function aiRemember(listId,key,value){
  if(!value)return;
  try{
    let a=JSON.parse(localStorage.getItem(key)||'[]');
    a=[value].concat(a.filter(function(x){return x!==value})).slice(0,10);
    localStorage.setItem(key,JSON.stringify(a));
  }catch(e){}
  aiLoadMemory();
}
function aiRenderQA(d, question){
  const src=(d.sources||[]).filter(Boolean);
  const srcHtml=src.length?'<div class="hint">来源：'+src.map(function(x){return '<span class="ai-src">'+aiEscape(x)+'</span>';}).join('')+'（'+(d.mode==='llm'?'大模型':'规则引擎')+'）</div>':'';
  const fb=d.llm_fallback?'<div class="ai-fallback">⚠ LLM 失败，已回退规则版</div>':'';
  const answer=aiHighlightTerms(mdToHtml(d.answer||''), aiQAHighlightTerms(d, question));
  $('#aiQAOut').innerHTML=fb+'<div class="ai-answer">'+answer+'</div>'+srcHtml+'<button type="button" class="ai-copy">复制</button>';
  $('#aiQAOut .ai-copy').onclick=function(){aiCopy(d.answer)};
}

function aiQAHighlightTerms(d, question){
  const terms=[];
  if(question)terms.push(question.trim());
  (d.sources||[]).forEach(function(x){if(x)terms.push(x)});
  (state.policies||[]).forEach(function(p){if(p&&p.leave_type)terms.push(p.leave_type)});
  terms.push('年休假','事假','婚假','丧假','病假','产假','陪产假','路程假','育儿假','护理假','法定病假','一次性短期病假','妇女节假期','奖励假','提前','工作日','自然日','报备','补交','证明材料','剩余','额度');
  return terms.filter(function(x){return x&&String(x).trim().length>=2});
}

function aiHighlightTerms(html, terms){
  const unique=[...new Set(terms)].sort(function(a,b){return String(b).length-String(a).length});
  let out=html;
  unique.forEach(function(term){
    const esc=String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out=out.replace(new RegExp(esc, 'g'), '<mark class="ai-kw">'+term+'</mark>');
  });
  return out;
}
function aiCopy(text){
  if(!text)return;
  const ok=function(){toast('已复制')};
  const no=function(){toast('复制失败',true)};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,no)}
  else{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');ok()}catch(e){no()}document.body.removeChild(ta)}
}
function aiRenderParse(d){
  const conf=(typeof d.confidence==='number')?d.confidence:null;
  const confCls=conf==null?'':(conf>=0.8?'ai-conf-high':(conf>=0.6?'ai-conf-mid':'ai-conf-low'));
  const confText=conf==null?'':(Math.round(conf*100)+'%');
  let h='<div class="ai-preview-card">';
  h+='<div class="ai-pc-head">'+(d.leave_type?'<strong class="ai-pc-type">'+aiEscape(d.leave_type)+'</strong>':'<strong class="ai-pc-type">请先选择假种，我来推荐</strong>')+(confText?'<span class="ai-conf '+confCls+'">置信度 '+confText+'</span>':'')+'</div>';
  const ks=[['start_date','开始'],['end_date','结束'],['days','天数']];
  const rows=ks.filter(function(k){return d[k[0]]!=null;}).map(function(k){return '<div class="ai-pc-row"><span>'+k[1]+'</span><strong>'+aiEscape(d[k[0]])+'</strong></div>';}).join('');
  if(rows)h+='<div class="ai-pc-rows">'+rows+'</div>';
  if(d.reason){
    h+='<div class="ai-pc-row"><span>事由</span><strong>'+aiEscape(d.reason)+'</strong></div>';
    if(d.reason_valid==='不合理'){h+='<div class="ai-confirm-warn">事由不合理：'+aiEscape(d.reason_note||'请补充具体说明')+'</div>'}
    else if(d.reason_valid==='存疑'){h+='<div class="ai-confirm-warn" style="background:#fff4e5;color:#b56908">事由存疑：'+aiEscape(d.reason_note||'请确认或补充')+'</div>'}
  }
  if(d.emergency_report||d.pending_material){
    h+='<div class="ai-pc-flags">';
    if(d.emergency_report)h+='<span class="ai-flag">突发情况报备</span>';
    if(d.pending_material)h+='<span class="ai-flag">证明材料待补交</span>';
    h+='</div>';
  }
  if(d.llm_fallback)h+='<div class="ai-fallback">⚠ LLM 失败，已回退规则版</div>';
  h+='</div>';
  if(d.guidance)h+='<div class="ai-guide">'+aiEscape(d.guidance)+'</div>';
  if(d.complete&&d.reason_required&&!d.reason)h+='<div class="field" style="margin-top:8px"><input id="aiReason" class="ai-input" placeholder="请假事由（必填）"></div>';
  if(d.options&&d.options.length){
    h+='<div style="margin-top:10px">'+d.options.map(function(o){return '<button type="button" class="btn '+(o.primary?'ai-opt-primary':'ai-opt-alt')+'" data-aiopt="'+aiEscape(o.leave_type)+'">'+(o.primary?'✓ ':'')+aiEscape(o.leave_type)+(o.primary?' · 去填写':'')+'</button>';}).join('')+'</div>';
  }
  if(d.complete&&!d.material_required&&d.reason_valid!=='不合理'){
    const needConfirm=(conf!=null&&conf<0.6)||d.reason_valid==='存疑';
    if(needConfirm){
      h+='<div class="ai-confirm-warn">识别信息需人工确认，请核对无误</div><label class="ai-confirm-check"><input type="checkbox" id="aiConfirm"> 我已确认信息无误</label><button class="btn btn-primary" id="aiSubmitBtn" style="margin-top:8px" disabled>一键发起请假（无需附件）</button>';
    }else{
      h+='<button class="btn btn-primary" id="aiSubmitBtn" style="margin-top:10px">一键发起请假（无需附件）</button>';
    }
  }
  if(d.follow_up)h+='<div class="hint" style="margin-top:6px">'+aiEscape(d.follow_up)+'</div>';
  if(d.suggestion)h+='<div class="ai-guide" style="margin-top:10px">'+mdToHtml(d.suggestion)+'</div>';
  $('#aiParseOut').innerHTML=h;
  document.querySelectorAll('[data-aiopt]').forEach(function(b){b.onclick=function(){aiPrefillFromParsed(b.getAttribute('data-aiopt'));closeAI();navigate('apply');};});
  const b=$('#aiSubmitBtn');const ck=$('#aiConfirm');
  if(b){b.onclick=function(){aiSubmitLeave();};if(ck){ck.onchange=function(){b.disabled=!ck.checked;};}}
}
function aiRenderBatch(d){
  if(d.error){$('#aiReviewOut').innerHTML='<span class="badge returned">'+aiEscape(d.error)+'</span>';return}
  let h='<div class="hint">'+aiEscape(d.summary||'')+'</div>';
  (d.items||[]).forEach(function(x){
    const v=x.verdict||'需关注';
    const cls=v==='通过'?'approved':(v==='不通过'?'returned':'pending');
    h+='<div class="ai-batch-item"><div class="ai-batch-head"><span class="badge '+cls+'">'+aiEscape(v)+'</span><strong>'+aiEscape(x.request_no||'')+'</strong><span class="hint">'+aiEscape((x.applicant&&x.applicant.name)||'')+'</span><span class="ai-conf ai-conf-mid">评分 '+x.score+'</span></div>';
    h+='<p>'+aiEscape(x.summary||'')+'</p>';
    h+='<button type="button" class="btn btn-ghost ai-batch-open" data-id="'+x.request_id+'">查看完整预审</button></div>';
  });
  $('#aiReviewOut').innerHTML=h;
  document.querySelectorAll('.ai-batch-open').forEach(function(b){b.onclick=function(){aiReviewRequest(parseInt(b.getAttribute('data-id'),10));};});
}

function aiRenderReview(d){
  const verdict=d.verdict||'需关注';
  const cls=verdict==='通过'?'approved':(verdict==='不通过'?'returned':'pending');
  const fb=d.llm_fallback?'<div class="ai-fallback">⚠ LLM 失败，已回退规则版</div>':'';
  let h=fb+'<div class="ai-review-head">';
  h+='<span class="badge '+cls+'">'+aiEscape(verdict)+'</span>';
  if(typeof d.score==='number')h+='<span class="ai-conf ai-conf-mid">智能评分 '+d.score+'</span>';
  if(d.request_no)h+='<span class="hint">'+aiEscape(d.request_no)+'</span>';
  h+='</div>';
  if(d.applicant&&d.applicant.name){
    h+='<div class="ai-applicant">申请人：'+aiEscape(d.applicant.name)+' · '+aiEscape(d.applicant.department||'综合管理部')+'</div>';
  }
  if(d.history_count!=null){
    h+='<div class="hint">同类假期已批准记录：'+aiEscape(d.history_count)+' 笔</div>';
  }
  h+='<p>'+aiEscape(d.summary)+'</p>';
  if(d.risk_details&&d.risk_details.length){
    h+='<div class="ai-risk-list">'+d.risk_details.map(function(r){
      const lv=r.level==='high'?'danger':(r.level==='medium'?'warn':'info');
      return '<div class="ai-risk-item"><span class="ai-badge '+lv+'">'+aiEscape(r.level==='high'?'高风险':(r.level==='medium'?'中风险':'低风险'))+'</span><div><strong>'+aiEscape(r.message)+'</strong>'+((r.policy)?'<small>'+aiEscape(r.policy)+'</small>':'')+'</div></div>';
    }).join('')+'</div>';
  }else if(d.risk_items&&d.risk_items.length){
    h+='<ul>'+d.risk_items.map(function(r){return '<li>'+aiEscape(r)+'</li>';}).join('')+'</ul>';
  }
  if(d.suggested_action){
    h+='<div class="ai-action-hint">建议操作：'+aiEscape(d.suggested_action)+'</div>';
  }
  if(d.comment_draft){
    h+='<div class="ai-comment-box"><div class="ai-comment-title">审批意见草稿</div><div>'+aiEscape(d.comment_draft)+'</div><button type="button" class="btn btn-ghost ai-copy-comment">复制意见</button></div>';
  }
  if(d.request_id){
    h+='<button type="button" class="btn btn-primary ai-open-request" data-id="'+d.request_id+'">打开申请详情</button>';
  }
  $('#aiReviewOut').innerHTML=h;
  const copy=$('#aiReviewOut .ai-copy-comment');
  if(copy)copy.onclick=function(){aiCopy(d.comment_draft)};
  const open=$('#aiReviewOut .ai-open-request');
  if(open)open.onclick=function(){const id=parseInt(open.getAttribute('data-id'),10);aiOpenRequestDetail(id)};
}

function aiOpenRequestDetail(id){
  const url=new URL(location.href);
  url.searchParams.set('request', id);
  window.open(url.toString(), '_blank');
}

async function showDetailOnly(id){
  document.body.classList.add('detail-only');
  const isApprover = state.me.role === 'approver';
  if(isApprover){
    await adminDetail(id, '__detail__');
  }else{
    await employeeDetail(id, '__detail__');
  }
  const back = document.getElementById(isApprover ? 'backAdmin' : 'backMine');
  if(back){
    back.textContent='返回';
    back.onclick=closeDetailTab;
  }
}

function closeDetailTab(){
  window.close();
  setTimeout(function(){
    location.replace(location.origin + location.pathname);
  }, 300);
}


function finishDetailOrNavigate(){
  if(document.body.classList.contains('detail-only')){
    closeDetailTab();
  }else{
    navigate(state.page);
  }
}
let aiParsed=null;
let aiPrefill=null;
async function aiSubmitLeave(){
  if(!aiParsed||!aiParsed.leave_type||!aiParsed.start_time){toast('请先解析',true);return}
  if(aiParsed.half_day){toast('半天暂不支持一键发起，请在“发起请假”手动选择0.5天',true);return}
  const reasonEl=document.getElementById('aiReason');
  let reason=aiParsed.reason||'';
  if(reasonEl)reason=reasonEl.value.trim()||reason;
  if(aiParsed.reason_required && !reason){toast('请填写请假事由',true);return}
  const body={leave_type:aiParsed.leave_type,start_time:aiParsed.start_time,end_time:aiParsed.end_time,reason:reason,pending_material:!!aiParsed.pending_material,material_note:aiParsed.material_note||'',emergency_report:!!aiParsed.emergency_report,emergency_reason:aiParsed.emergency_reason||''};
  try{const r=await api('/api/requests',{method:'POST',body:JSON.stringify(body)});toast('已提交 '+r.request_no);closeAI();navigate('records')}catch(e){toast(e.message,true)}
}
function aiGoApply(){
  if(aiParsed&&aiParsed.leave_type){aiPrefill={leave_type:aiParsed.leave_type};}
  closeAI();navigate('apply');
}
function aiPrefillFromParsed(type){
  aiPrefill={
    leave_type:type,
    start_date:(aiParsed&&aiParsed.start_date)||'',
    end_date:(aiParsed&&aiParsed.end_date)||'',
    reason:(aiParsed&&aiParsed.reason)||'',
    pending_material:!!(aiParsed&&aiParsed.pending_material),
    material_note:(aiParsed&&aiParsed.material_note)||'',
    emergency_report:!!(aiParsed&&aiParsed.emergency_report),
    emergency_reason:(aiParsed&&aiParsed.emergency_reason)||''
  };
  return aiPrefill;
}
async function aiLoadReqs(){
  try{
    const isAdmin=state.me.role==='approver';
    const d=await api(isAdmin?'/api/admin/requests':'/api/requests');
    const list=(d.requests||[]).filter(function(x){return ['pending','reported','supplement_required','returned'].indexOf(x.status)>=0;});
    const el=$('#aiReqList');
    if(!el)return;
    if(!list.length){el.innerHTML='<div class="hint">暂无待处理申请</div>';return}
    el.innerHTML=list.map(function(x){
      const ov=x.overdue?'<span class="ai-badge danger">超时</span>':'';
      const rk=(x.status==='supplement_required'||x.status==='returned')?'<span class="ai-badge warn">'+aiEscape(labels[x.status]||x.status)+'</span>':'';
      const st=(x.status==='pending'||x.status==='reported')?'<span class="ai-badge">'+aiEscape(labels[x.status]||x.status)+'</span>':'';
      return '<div class="ai-req-item'+(x.overdue?' ai-req-overdue':'')+'"><div class="ai-req-info"><strong>'+aiEscape(x.request_no)+'</strong> · '+aiEscape(x.leave_type)+(x.name?' · '+aiEscape(x.name):'')+'</div><div>'+ov+rk+st+'</div><button type="button" class="btn btn-primary ai-req-go" data-id="'+x.id+'">预审</button></div>';
    }).join('');
    el.querySelectorAll('.ai-req-go').forEach(function(b){b.onclick=function(){aiReviewRequest(parseInt(b.getAttribute('data-id'),10));};});
  }catch(e){}
}
function aiReviewRequest(id){
  $('#aiReviewOut').innerHTML='<div class="ai-loading">预审中…</div>';
  api('/api/ai/review-request/'+id,{method:'POST',body:'{}'}).then(function(d){aiRenderReview(d);}).catch(function(e){$('#aiReviewOut').innerHTML='<span class="badge returned">'+aiEscape(e.message)+'</span>';});
}
