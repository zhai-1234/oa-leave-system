/* 智审 OA · Vue 前端核心层：响应式状态、API 封装、公共工具 */
(function (window) {
  'use strict';

  var Vue = window.Vue;
  var VP = (window.VP = window.VP || {});

  VP.labels = {
    pending: '待审批',
    approved: '已通过',
    rejected: '不通过',
    returned: '退回修改',
    supplement_required: '待补充材料',
    reported: '突发报备',
    cancelled: '已取消',
    expired: '已过期'
  };

  VP.actionLabels = {
    approve: '通过',
    reject: '不通过',
    return: '退回修改',
    supplement: '要求材料',
    remind: '提醒补交',
    cancel: '取消申请'
  };

  VP.pageMeta = {
    home: ['工作台', '查看假期概况与待办'],
    apply: ['发起请假', '填写时间、假种和必要材料'],
    records: ['我的请假记录', '跟踪申请状态与审批轨迹'],
    profile: ['我的假期余额', '查看当前可用额度'],
    guide: ['制度与流程', '请假、补材料与返岗办理说明'],
    admin: ['待办审批', '优先处理临近时限的申请'],
    delegation: ['审批代理', '设置请假期间的审批代理人'],
    adjustments: ['返岗与续假', '审批员工的销假与续假手续'],
    history: ['审批记录', '查看已处理和二次审批记录'],
    hr: ['HR 假期管理', '全局假期制度和使用概况'],
    notifications: ['消息通知', '查看最新申请与审批变更']
  };

  /* ============ 全局状态 ============ */
  VP.store = Vue.reactive({
    me: null,
    balances: [],
    policies: [],
    leaveLengthRule: null,
    unread: 0,
    requests: [],
    title: '',
    subtitle: '',
    ready: false,
    detailOnly: false,
    ai: {
      open: false,
      tab: 'qa',
      qa: null,
      qaLoading: false,
      parsed: null,
      parseLoading: false,
      review: null,
      reviewLoading: false,
      batch: null,
      batchLoading: false,
      reqs: [],
      status: null,
      prefill: null,
      tipVisible: false,
      tipText: '问制度 · 帮我请假'
    }
  });

  /* ============ 提示条 ============ */
  var toastTimer = null;

  VP.toast = function (msg, bad) {
    var t = document.getElementById('toast');
    if (!t) { return; }
    t.textContent = String(msg == null ? '' : msg);
    t.style.cssText = 'position:fixed;right:22px;top:20px;z-index:9999;background:' +
      (bad ? '#c63d44' : '#16865b') + ';color:white;padding:12px 18px;border-radius:9px';
    if (toastTimer) { clearTimeout(toastTimer); }
    setTimeout(function () { t.style.display = 'none'; }, 2600);
    t.style.display = 'block';
  };

  /* ============ 请求封装 ============ */
  VP.api = async function api(url, opt) {
    var options = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {});
    var r = await fetch(url, options);
    var d = null;
    try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok) {
      var error = Error((d && (d.error || d.detail)) || '操作失败');
      error.data = d || {};
      error.status = r.status;
      throw error;
    }
    return d;
  };

  /* ============ 公共工具 ============ */
  VP.textSafe = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  VP.fmtDays = function (value) {
    return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  };

  VP.greeting = function () {
    var h = new Date().getHours();
    return h < 11 ? '上午好' : h < 18 ? '下午好' : '晚上好';
  };

  VP.isActiveStatus = function (status) {
    return ['pending', 'reported', 'supplement_required'].indexOf(status) >= 0;
  };

  VP.employeePolicyVisible = function (p) {
    var me = VP.store.me;
    if (p.application_required === false) { return false; }
    if (p.leave_type === '陪产假') { return !!me && me.gender === '男'; }
    if (p.leave_type === '产假' || p.leave_type === '奖励假') { return !!me && me.gender === '女'; }
    return true;
  };

  VP.isApprover = function () {
    return !!(VP.store.me && VP.store.me.role === 'approver');
  };

  VP.isAdmin = function () {
    return !!(VP.store.me && VP.store.me.is_admin);
  };

  VP.isHr = function () {
    return !!(VP.store.me && VP.store.me.is_hr);
  };

  VP.isHrOrAdmin = function () {
    return VP.isAdmin() || VP.isHr();
  };

  VP.employeePolicies = function () {
    return (VP.store.policies || []).filter(VP.employeePolicyVisible);
  };

  /* ============ 附件上传 ============ */
  VP.uploadFiles = async function (fileList, onProgress) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) { return []; }
    var allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    files.forEach(function (file) {
      if (allowed.indexOf(file.type) < 0) { throw Error(file.name + ' 不是支持的图片格式'); }
      if (file.size > 8 * 1024 * 1024) { throw Error(file.name + ' 超过8MB'); }
    });
    if (onProgress) { onProgress('正在上传 0 / ' + files.length); }
    var tokens = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var data = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(Error('无法读取 ' + file.name)); };
        reader.readAsDataURL(file);
      });
      var result = await VP.api('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mime_type: file.type, data: data })
      });
      tokens.push(result.token);
      if (onProgress) {
        onProgress('已上传 ' + (i + 1) + ' / ' + files.length);
      }
    }
    return tokens;
  };

  /* ============ 登录记忆 ============ */
  var LOGIN_MEMORY_KEY = 'oa.leave.login-memory.v1';

  VP.loginMemory = function () {
    try {
      var v = JSON.parse(localStorage.getItem(LOGIN_MEMORY_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  };

  VP.saveLoginMemory = function (account) {
    var all = VP.loginMemory().filter(function (x) { return x.username !== account.username; });
    all.unshift(Object.assign({}, account, { lastUsed: Date.now() }));
    var payload = JSON.stringify(all);
    try {
      localStorage.setItem(LOGIN_MEMORY_KEY, payload);
    } catch (e) {
      // 仅在浏览器存储配额不足时淘汰最旧记录，不设置固定的记忆条数上限。
      localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(all.slice(0, Math.max(20, all.length / 2))));
    }
  };

  VP.forgetLoginMemory = function (username) {
    localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(
      VP.loginMemory().filter(function (x) { return x.username !== username; })
    ));
  };

  VP.accountSimilarity = function (a, b) {
    a = String(a || '').toLowerCase();
    b = String(b || '').toLowerCase();
    if (!a) { return 0.45; }
    if (a === b) { return 1; }
    if (b.indexOf(a) === 0) { return 0.92 - a.length * 0.001; }
    if (b.indexOf(a) >= 0) { return 0.82; }
    var m = a.length, n = b.length;
    var d = [];
    for (var i = 0; i <= m; i++) { d.push([i]); }
    for (var j = 0; j <= n; j++) { d[0][j] = j; }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return 1 - d[m][n] / Math.max(m, n);
  };

  /* ============ 图标 ============ */
  VP.iconEyeClosed = function () {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5.2 9 5.2a14.6 14.6 0 0 1-2.3 2.8M6.2 6.2C4.2 7.5 3 9.2 3 9.2S6.5 15 12 15a9 9 0 0 0 3-.5"/></svg>';
  };

  VP.iconEyeOpen = function () {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-5.5 9-5.5S21 12 21 12s-3.5 5.5-9 5.5S3 12 3 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
  };

  /* ============ Markdown 与高亮 ============ */
  VP.mdToHtml = function (md) {
    var s = VP.textSafe(md == null ? '' : String(md));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/^#{1,4}\s*(.*)$/gm, '<strong>$1</strong>');
    s = s.replace(/^\s*[-\u2022]\s+(.*)$/gm, '&nbsp;&nbsp;\u2022 $1');
    s = s.replace(/^\s*(\d+)[.\u3001]\s*(.*)$/gm, '&nbsp;&nbsp;$1. $2');
    s = s.replace(/\n/g, '<br>');
    return s;
  };

  VP.highlightTerms = function (html, terms) {
    var seen = {};
    var list = [];
    (terms || []).forEach(function (t) {
      var key = String(t || '').trim();
      if (key.length >= 2 && !seen[key]) { seen[key] = 1; list.push(key); }
    });
    list.sort(function (a, b) { return b.length - a.length; });
    var out = html;
    list.forEach(function (term) {
      var esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        out = out.replace(new RegExp(esc, 'g'), '<mark class="ai-kw">' + term + '</mark>');
      } catch (e) { /* 忽略非法正则 */ }
    });
    return out;
  };

  VP.qaHighlightTerms = function (d, question) {
    var terms = [];
    if (question) { terms.push(String(question).trim()); }
    ((d && d.sources) || []).forEach(function (x) { if (x) { terms.push(x); } });
    (VP.store.policies || []).forEach(function (p) { if (p && p.leave_type) { terms.push(p.leave_type); } });
    terms.push('年休假', '事假', '婚假', '丧假', '病假', '产假', '陪产假', '路程假', '育儿假', '护理假',
      '法定病假', '一次性短期病假', '妇女节假期', '奖励假', '提前', '工作日', '自然日', '报备', '补交',
      '证明材料', '剩余', '额度', '医疗期', '工龄');
    return terms;
  };

  VP.copyText = function (text) {
    var ok = function () { VP.toast('已复制'); };
    var no = function () { VP.toast('复制失败，请手动选择文本', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, no);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { no(); }
      document.body.removeChild(ta);
    }
  };

  /* ============ 启动数据加载 ============ */
  VP.loadSession = async function () {
    var results = await Promise.all([
      VP.api('/api/me'),
      VP.api('/api/policies'),
      VP.api('/api/notifications/unread-count')
    ]);
    var d = results[0], p = results[1], n = results[2];
    var store = VP.store;
    store.me = d.user;
    store.policies = p.policies;
    store.leaveLengthRule = p.leave_length_rule || null;
    store.unread = n.unread;
    store.balances = (d.balances || []).filter(function (x) {
      return store.policies.some(function (y) { return y.leave_type === x.leave_type && VP.employeePolicyVisible(y); });
    });
    store.ready = true;
    return d;
  };

  VP.logout = async function () {
    try { await VP.api('/api/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
    VP.store.me = null;
    VP.store.ready = false;
    VP.store.balances = [];
    VP.store.policies = [];
    VP.store.requests = [];
    VP.store.unread = 0;
  };

  VP.refreshUnread = async function () {
    try {
      var d = await VP.api('/api/notifications/unread-count');
      VP.store.unread = d.unread;
    } catch (e) { /* 忽略 */ }
  };

  VP.readRequestNotifications = async function (requestId) {
    try {
      await VP.api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ request_id: Number(requestId) }) });
      await VP.refreshUnread();
    } catch (e) { /* 忽略 */ }
  };

  /* ============ 未读消息轮询 ============ */
  var notifyTimer = null;

  VP.startNotifyTimer = function () {
    VP.stopNotifyTimer();
    notifyTimer = setInterval(function () { VP.refreshUnread(); }, 30000);
  };

  VP.stopNotifyTimer = function () {
    if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
  };

  VP.switchAccount = async function (router) {
    try {
      await VP.api('/api/switch-employee', { method: 'POST', body: '{}' });
      await VP.loadSession();
      VP.startNotifyTimer();
      var target = VP.isApprover() ? '/admin' : '/home';
      if (router && router.replace) {
        await router.replace(target);
      } else {
        location.hash = '#' + target;
      }
    } catch (e) {
      VP.toast(e.message, true);
    }
  };
})(window);
