/* 智审 OA · Vue 员工端页面 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  /* ---------- 工作台 ---------- */
  C.HomeView = {
    name: 'HomeView',
    data: function () { return { items: [], loading: true }; },
    computed: {
      me: function () { return VP.store.me || {}; },
      unread: function () { return VP.store.unread || 0; },
      waitingCount: function () {
        return this.items.filter(function (x) { return VP.isActiveStatus(x.status); }).length;
      },
      approvedCount: function () {
        return this.items.filter(function (x) { return x.status === 'approved'; }).length;
      },
      recent: function () { return this.items.slice(0, 3); }
    },
    created: async function () {
      try {
        var d = await VP.api('/api/requests');
        this.items = d.requests || [];
        VP.store.requests = this.items;
      } catch (e) {
        VP.toast(e.message, true);
      }
      this.loading = false;
    },
    methods: {
      greeting: function () { return VP.greeting(); },
      fmt: function (v) { return VP.fmtDays(v); },
      labels: function () { return VP.labels; },
      go: function (page) { this.$router.push('/' + page).catch(function () { }); },
      openDetail: function (id) { this.$router.push('/requests/' + id).catch(function () { }); },
      day: function (v) { return String(v || '').slice(0, 10); }
    },
    template: `
      <div>
        <section class="workspace-welcome">
          <div>
            <span class="eyebrow">员工工作台</span>
            <h2>{{ greeting() }}，{{ me.name }}</h2>
            <p>从这里发起申请、查看进度和处理待补交事项。</p>
          </div>
          <button class="btn btn-primary" @click="go('apply')">发起请假</button>
        </section>
        <div class="work-kpis">
          <button @click="go('records')">
            <span>审批中</span><strong>{{ waitingCount }}</strong><small>查看进度 →</small>
          </button>
          <button @click="go('records')">
            <span>已通过</span><strong>{{ approvedCount }}</strong><small>查看记录 →</small>
          </button>
          <button @click="go('notifications')">
            <span>未读消息</span><strong>{{ unread }}</strong><small>打开消息 →</small>
          </button>
        </div>
        <div class="workspace-grid">
          <section class="card">
            <div class="card-heading">
              <div><h3>最近申请</h3><p>按提交时间显示最新记录</p></div>
              <button class="text-button" @click="go('records')">查看全部</button>
            </div>
            <div class="recent-list">
              <button v-for="x in recent" :key="x.id" @click="openDetail(x.id)">
                <span class="request-type-icon">{{ String(x.leave_type || '?').slice(0, 1) }}</span>
                <span>
                  <strong>{{ x.leave_type }}</strong>
                  <small>{{ day(x.start_time) }} 至 {{ day(x.end_time) }} · {{ fmt(x.days) }} 天</small>
                </span>
                <span class="badge" :class="x.status">{{ labels()[x.status] || x.status }}</span>
              </button>
              <div v-if="!recent.length" class="empty-state small">暂无请假申请</div>
            </div>
          </section>
          <aside class="card quick-actions">
            <h3>快捷操作</h3>
            <button @click="go('profile')"><strong>查看假期余额</strong><small>按假种查看当前可用天数</small></button>
            <button @click="go('notifications')"><strong>处理消息通知</strong><small>查看审批结果与补交提醒</small></button>
            <button @click="go('guide')"><strong>查看制度与流程</strong><small>了解申请时限和材料要求</small></button>
          </aside>
        </div>
      </div>`
  };

  /* ---------- 发起请假 ---------- */
  C.ApplyView = {
    name: 'ApplyView',
    data: function () {
      return {
        form: {
          leave_type: '', start_time: '', end_time: '', reason: '', pending_material: false,
          material_note: '', related_request_no: '', exception_requested: false,
          emergency_report: false, emergency_reason: ''
        },
        calc: null,
        timing: null,
        warnings: [],
        balanceError: null,
        error: '',
        uploading: '',
        busy: false,
        compFillDays: 0,
        draftReady: false
      };
    },
    computed: {
      store: function () { return VP.store; },
      policies: function () { return VP.employeePolicies(); },
      current: function () {
        var lt = this.form.leave_type;
        return VP.store.policies.find(function (p) { return p.leave_type === lt; }) || null;
      },
      isCompLeave: function () { return this.form.leave_type === '调休'; },
      availableCompDays: function () {
        var row = (VP.store.balances || []).find(function (x) { return x.leave_type === '调休'; });
        return row ? Math.max(0, Number(row.remaining_days || 0) - Number(row.pending_days || 0)) : 0;
      },
      availCompText: function () { return VP.fmtDays(this.availableCompDays); },
      compFillExceeds: function () {
        return Number(this.compFillDays || 0) > Number(this.availableCompDays || 0) + 1e-9;
      },
      reasonExempt: function () { return !!(this.current && this.current.reason_required === false); },
      aiPrefill: function () { return VP.store.ai.prefill; },
      draftStorageKey: function () {
        return 'leave_apply_draft:' + ((VP.store.me && VP.store.me.username) || 'anonymous');
      }
    },
    created: async function () {
      this.restoreDraft();
      this.draftReady = true;
      if (this.consumePrefill() === false) {
        if (!this.form.leave_type && this.policies.length) {
          this.form.leave_type = this.policies[0].leave_type;
        }
      }
      await this.calculate();
    },
    watch: {
      /* AI 助手在本页触发填单时不会重新挂载，需要监听预填变化 */
      aiPrefill: function (v) {
        if (v) { this.consumePrefill(); }
      },
      form: {
        deep: true,
        handler: function () { this.saveDraft(); }
      },
      compFillDays: function () { this.saveDraft(); }
    },
    activated: function () {
      if (!this.form.leave_type && this.policies.length) {
        this.form.leave_type = this.policies[0].leave_type;
      }
    },
    methods: {
      restoreDraft: function () {
        try {
          var saved = JSON.parse(sessionStorage.getItem(this.draftStorageKey) || 'null');
          if (!saved) { return; }
          if (saved.form) { this.form = Object.assign(this.form, saved.form); }
          this.compFillDays = Number(saved.compFillDays || 0);
        } catch (e) { /* 忽略损坏的本地草稿 */ }
      },
      saveDraft: function () {
        if (!this.draftReady) { return; }
        try {
          sessionStorage.setItem(this.draftStorageKey, JSON.stringify({
            form: this.form,
            compFillDays: this.compFillDays
          }));
        } catch (e) { /* 本地存储不可用时不阻断申请 */ }
      },
      clearDraft: function () {
        try { sessionStorage.removeItem(this.draftStorageKey); } catch (e) { /* 忽略 */ }
      },
      consumePrefill: function () {
        var prefill = VP.store.ai.prefill;
        if (!prefill) { return false; }
        VP.store.ai.prefill = null;
        if (prefill.leave_type) { this.form.leave_type = prefill.leave_type; }
        this.form.start_time = prefill.start_date || '';
        this.form.end_time = prefill.end_date || '';
        this.form.reason = prefill.reason || '';
        this.form.pending_material = !!prefill.pending_material;
        this.form.material_note = prefill.material_note || '';
        this.form.emergency_report = !!prefill.emergency_report;
        this.form.emergency_reason = prefill.emergency_reason || '';
        return true;
      },
      formatLocalDate: function (value) {
        var m = ('0' + (value.getMonth() + 1)).slice(-2);
        var d = ('0' + value.getDate()).slice(-2);
        return value.getFullYear() + '-' + m + '-' + d;
      },
      formatLocalDateTime: function (value, minutesOfDay) {
        var hours = Math.floor(minutesOfDay / 60);
        var minutes = minutesOfDay % 60;
        return this.formatLocalDate(value) + 'T' + ('0' + hours).slice(-2) + ':' + ('0' + minutes).slice(-2);
      },
      nextWorkday: function (base, offset) {
        var value = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        var added = 0;
        while (added < offset) {
          value.setDate(value.getDate() + 1);
          if (value.getDay() !== 0 && value.getDay() !== 6) { added += 1; }
        }
        return value;
      },
      requestRange: function () {
        return { start: this.form.start_time, end: this.form.end_time };
      },
      quickFillComp: async function () {
        var days = Number(this.availableCompDays || 0);
        var requested = Number(this.compFillDays || 0);
        if (!requested) {
          requested = days;
          this.compFillDays = days;
        }
        if (days <= 0) {
          VP.toast('当前没有可用调休额度', true);
          return;
        }
        var today = new Date();
        var start = this.nextWorkday(today, 1);
        if (requested <= 1) {
          var minutes = Math.min(480, Math.max(1, Math.round(requested * 480)));
          var endMinutes = 9 * 60 + minutes + (minutes >= 180 ? 60 : 0);
          this.form.start_time = this.formatLocalDateTime(start, 9 * 60);
          this.form.end_time = this.formatLocalDateTime(start, endMinutes);
        } else {
          var fullDays = Math.floor(requested + 1e-9);
          var fraction = requested - fullDays;
          var end = this.nextWorkday(start, Math.max(0, fullDays - (fraction > 0 ? 0 : 1)));
          this.form.start_time = this.formatLocalDateTime(start, 9 * 60);
          if (fraction > 0) {
            var partMinutes = Math.round(fraction * 480);
            var partEnd = 9 * 60 + partMinutes + (partMinutes >= 180 ? 60 : 0);
            this.form.end_time = this.formatLocalDateTime(end, partEnd);
          } else {
            this.form.end_time = this.formatLocalDateTime(end, 18 * 60);
          }
        }
        this.calculate();
        VP.toast(this.compFillExceeds ? '已填入，但所选额度超过当前可用余额' : '已填入调休时间');
      },
      onTypeChange: async function () {
        if (this.reasonExempt) {
          this.form.reason = '';
          this.form.pending_material = false;
          this.form.material_note = '';
          if (this.$refs.files) { this.$refs.files.value = ''; }
          this.uploading = '';
        }
        if (this.form.leave_type === '调休') {
          this.compFillDays = this.availableCompDays;
          if (this.form.start_time && this.form.start_time.length === 10) {
            this.form.start_time += 'T09:00';
          }
          if (this.form.end_time && this.form.end_time.length === 10) {
            this.form.end_time += 'T18:00';
          }
        }
        await this.calculate();
      },
      calculate: async function () {
        if (!this.form.start_time || !this.form.end_time) { return; }
        this.balanceError = null;
        try {
          var range = this.requestRange();
          var r = await VP.api('/api/calculate-days', {
            method: 'POST',
            body: JSON.stringify({
              leave_type: this.form.leave_type,
              start_time: range.start,
              end_time: range.end
            })
          });
          this.calc = r;
          this.timing = r;
          this.warnings = r.principle_warnings || [];
        } catch (e) {
          this.calc = null;
          this.timing = null;
          this.warnings = [];
          VP.toast(e.message, true);
        }
      },
      setUploading: function (text) { this.uploading = text; },
      submit: async function () {
        if (this.busy) { return; }
        this.error = '';
        this.balanceError = null;
        if (this.warnings.length && !this.form.exception_requested) {
          this.error = '申请暂不能提交：' + this.warnings.join('；') + '。请修改申请，或勾选特殊审批并说明原因。';
          return;
        }
        this.busy = true;
        try {
          var body = Object.assign({}, this.form);
          var range = this.requestRange();
          body.start_time = range.start;
          body.end_time = range.end;
          body.attachment_tokens = await VP.uploadFiles(this.$refs.files && this.$refs.files.files, this.setUploading);
          var r = await VP.api('/api/requests', { method: 'POST', body: JSON.stringify(body) });
          VP.toast('已提交 ' + r.request_no);
          this.form = {
            leave_type: this.policies.length ? this.policies[0].leave_type : '',
            start_time: '', end_time: '', reason: '', pending_material: false,
            material_note: '', related_request_no: '', exception_requested: false,
            emergency_report: false, emergency_reason: ''
          };
          this.compFillDays = this.availableCompDays;
          this.clearDraft();
          this.calc = null;
          this.timing = null;
          this.warnings = [];
          this.balanceError = null;
          this.$router.push('/records').catch(function () { });
        } catch (e) {
          if (e.data && e.data.balance) {
            this.balanceError = e.data.balance;
          } else {
            this.error = e.message;
          }
        } finally {
          this.busy = false;
        }
      }
    },
    template: `
      <div class="grid">
        <form class="card span7" @submit.prevent="submit">
          <h3>填写请假申请</h3>
          <div class="two">
            <div class="field">
              <label>请假类型</label>
              <select v-model="form.leave_type" required @change="onTypeChange">
                <option v-for="p in policies" :key="p.leave_type" :value="p.leave_type">{{ p.leave_type }}（{{ p.unit }}）</option>
              </select>
            </div>
            <div class="field">
              <label>系统计算天数</label>
              <input readonly :value="calc ? (calc.days + ' 天（' + calc.unit + '）') : ''" placeholder="选择日期后自动计算">
            </div>
          </div>
          <div v-if="current" class="notice">
            <strong>{{ current.unit }}计算 · {{ current.limit }}</strong><br>
            申请时限：{{ current.timing }}<br>
            材料提示：{{ current.material }}
          </div>
          <div v-if="timing" class="notice" :class="{ 'rule-warning': !timing.timely }">
            <template v-if="timing.advance_required === null">该假期无统一提前天数要求。</template>
            <template v-else-if="timing.timely">✓ 符合时限：需提前 {{ timing.advance_required }} 个工作日，当前提前 {{ timing.advance_actual }} 个工作日。</template>
            <template v-else>⚠ 未按标准时限：需提前 {{ timing.advance_required }} 个工作日，当前仅提前 {{ timing.advance_actual }} 个工作日。请调整日期；如属突发/紧急情况，请勾选下方“突发情况报备”并说明原因。</template>
          </div>
          <div v-if="calc && calc.leave_length" class="notice leave-length-notice">
            <strong>{{ calc.leave_length.label }}</strong> · {{ calc.leave_length.summary }}<br>
            <span class="hint">{{ calc.leave_length_rule.text }}</span>
          </div>
          <div v-if="calc && calc.balance" class="balance-availability" :class="{ insufficient: !calc.balance.balance_sufficient }">
            <div><span>当前剩余</span><strong>{{ calc.balance.account_balance }} 天</strong></div>
            <div v-if="calc.balance.pending_occupied > 0"><span>待审占用</span><strong>{{ calc.balance.pending_occupied }} 天</strong></div>
            <div><span>当前可用</span><strong>{{ calc.balance.available_balance }} 天</strong></div>
            <div><span>本次申请</span><strong>{{ calc.balance.requested_days }} 天</strong></div>
            <div v-if="calc.balance.shortfall_days > 0" class="shortfall"><span>尚缺</span><strong>{{ calc.balance.shortfall_days }} 天</strong></div>
          </div>
          <div v-if="calc" class="notice" :class="{ 'rule-warning': warnings.length }">
            <template v-if="warnings.length">
              <strong>⚠ 不符合原则性要求</strong>
              <ul><li v-for="(w, i) in warnings" :key="i">{{ w }}</li></ul>
              <span>请修改申请；确有特殊情况时，勾选“申请特殊审批”并在事由中说明。</span>
            </template>
            <template v-else>✓ 当前天数、累计额度和申请次数符合一般标准。</template>
          </div>
          <div v-if="!isCompLeave" class="two">
            <div class="field"><label>开始日期</label><input v-model="form.start_time" type="date" required @change="calculate"></div>
            <div class="field"><label>结束日期</label><input v-model="form.end_time" type="date" required @change="calculate"></div>
          </div>
          <div v-else class="two">
            <div class="field"><label>开始日期时间</label><input v-model="form.start_time" type="datetime-local" required @change="calculate"></div>
            <div class="field"><label>结束日期时间</label><input v-model="form.end_time" type="datetime-local" required @change="calculate"></div>
          </div>
          <div v-if="isCompLeave" class="comp-quick-fill">
            <div class="comp-balance-note"><span>当前可用调休</span><strong>{{ availCompText }} 天</strong></div>
            <div class="field">
              <label>本次填入额度（天）</label>
              <input v-model.number="compFillDays" type="number" min="0" step="0.125">
            </div>
            <button type="button" class="btn btn-ghost" @click="quickFillComp">快捷填入</button>
            <p v-if="compFillExceeds" class="comp-over-limit">
              所选 {{ compFillDays }} 天超过可用 {{ availCompText }} 天，提交时会被余额校验拦截。
            </p>
          </div>
          <p v-if="isCompLeave" class="hint">日期和时间合并填写；不足一天按实际小时折算，中午 12:00-13:00 不计入调休时长。</p>
          <div v-show="!reasonExempt" class="reason-material-section">
            <div class="field">
              <label>请假事由与证明材料</label>
              <textarea v-model="form.reason" :required="!reasonExempt" placeholder="请说明具体事由"></textarea>
              <div class="reason-upload-row">
                <label class="image-upload-button" for="materialImages">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3"/></svg>
                  <span>上传证明图片</span>
                </label>
                <input id="materialImages" ref="files" class="hidden-file-input" type="file"
                       accept="image/jpeg,image/png,image/webp,image/gif" multiple>
                <span class="hint">支持 JPG、PNG、WebP、GIF，单张不超过 8MB</span>
              </div>
              <div class="upload-status">{{ uploading }}</div>
            </div>
            <label><input type="checkbox" v-model="form.pending_material"> 证明材料待补交</label>
            <div class="field">
              <label>材料说明 / 预计补交时间</label>
              <input v-model="form.material_note" placeholder="如：返岗后 1 个工作日内补交">
            </div>
          </div>
          <div class="field">
            <label>关联申请单号</label>
            <input v-model="form.related_request_no" placeholder="路程假须填写关联的婚假或丧假单号">
          </div>
          <label><input type="checkbox" v-model="form.exception_requested"> 不符合原则性要求，申请特殊审批</label><br>
          <label><input type="checkbox" v-model="form.emergency_report"> 突发情况报备</label>
          <div class="field">
            <label>报备原因</label>
            <textarea v-model="form.emergency_reason" placeholder="如属突发报备，请说明客观情况"></textarea>
          </div>
          <div v-if="balanceError" class="notice rule-warning balance-error-detail" role="alert">
            <strong>余额不足，申请不能提交</strong>
            <p>{{ balanceError.balance_type }}当前剩余 {{ balanceError.account_balance }} 天<template v-if="balanceError.pending_occupied > 0">，已有待审批占用 {{ balanceError.pending_occupied }} 天</template>，当前可用 {{ balanceError.available_balance }} 天。</p>
            <p>本次申请 {{ balanceError.requested_days }} 天，尚缺 {{ balanceError.shortfall_days }} 天，请调整请假天数或选择其他假期类型。</p>
          </div>
          <div v-if="error" class="notice rule-warning">{{ error }}</div>
          <button class="btn btn-primary" :disabled="busy">{{ busy ? '提交中…' : '提交申请' }}</button>
        </form>
        <div class="card span5">
          <h3>计算口径</h3>
          <p><strong>工作日</strong>：排除周六、周日及已配置的法定节假日；调休工作日计入。</p>
          <p><strong>自然日</strong>：包含休息日与法定节假日，按连续日历天计算。</p>
          <div class="notice">年度法定节假日及调休日期需由管理员按国务院当年通知录入。</div>
          <h3>连续 / 分批请假</h3>
          <p>不同类型连续休假请分别提交相邻日期的申请。系统会校验提前时限、单次天数、累计额度、申请次数、关联单号和连续安排。</p>
        </div>
      </div>`
  };

  /* ---------- 我的请假记录 ---------- */
  C.RecordsView = {
    name: 'RecordsView',
    data: function () { return { items: [], cleanupCandidates: [], query: '', status: '', type: '', cleanupBusyId: 0 }; },
    computed: {
      labels: function () { return VP.labels; },
      types: function () {
        var set = {};
        this.items.forEach(function (x) { set[x.leave_type] = 1; });
        return Object.keys(set);
      },
      filtered: function () {
        var q = String(this.query || '').trim().toLowerCase();
        var status = this.status;
        var type = this.type;
        return this.items.filter(function (x) {
          if (status && x.status !== status) { return false; }
          if (type && x.leave_type !== type) { return false; }
          if (q) {
            var hay = (x.request_no + ' ' + x.leave_type + ' ' + (x.reason || '')).toLowerCase();
            if (hay.indexOf(q) < 0) { return false; }
          }
          return true;
        });
      }
    },
    created: async function () { await this.load(); },
    methods: {
      load: async function () {
      try {
        var d = await VP.api('/api/requests');
        this.items = d.requests || [];
        this.cleanupCandidates = d.cleanup_candidates || [];
        VP.store.requests = this.items;
      } catch (e) {
        VP.toast(e.message, true);
      }
      },
      open: function (id) { this.$router.push('/requests/' + id).catch(function () { }); },
      keepRequest: async function (item) {
        if (this.cleanupBusyId) { return; }
        this.cleanupBusyId = item.id;
        try {
          await VP.api('/api/requests/' + item.id + '/keep', { method: 'POST', body: '{}' });
          this.cleanupCandidates = this.cleanupCandidates.filter(function (x) { return x.id !== item.id; });
          VP.toast('已保留申请单 ' + item.request_no);
        } catch (e) { VP.toast(e.message, true); }
        finally { this.cleanupBusyId = 0; }
      },
      archiveRequest: async function (item) {
        if (this.cleanupBusyId) { return; }
        if (!window.confirm('不再保留申请单 ' + item.request_no + '？可用额度会收回，记录移入垃圾桶。')) { return; }
        this.cleanupBusyId = item.id;
        try {
          await VP.api('/api/requests/' + item.id + '/archive', { method: 'POST', body: '{}' });
          VP.toast('已移入垃圾桶');
          await this.load();
          await VP.loadSession();
        } catch (e) { VP.toast(e.message, true); }
        finally { this.cleanupBusyId = 0; }
      },
      go: function (page) { this.$router.push('/' + page).catch(function () { }); }
    },
    template: `
      <div>
        <div v-if="cleanupCandidates.length" class="notice cleanup-banner">
          <strong>有 {{ cleanupCandidates.length }} 张退回申请长期未修改</strong>
          <div v-for="item in cleanupCandidates" :key="item.id" class="cleanup-item">
            <span>{{ item.request_no }} · {{ item.leave_type }} · {{ item.days }} 天 · 退回于 {{ item.updated_at }}</span>
            <div class="actions">
              <button class="btn btn-ghost" :disabled="cleanupBusyId" @click="keepRequest(item)">保留</button>
              <button class="btn btn-danger" :disabled="cleanupBusyId" @click="archiveRequest(item)">不保留并归档</button>
            </div>
          </div>
        </div>
        <div class="filter-bar">
          <div class="search-field">
            <span>⌕</span>
            <input v-model="query" placeholder="搜索申请单号、假种或事由">
          </div>
          <select v-model="status">
            <option value="">全部状态</option>
            <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="type">
            <option value="">全部假种</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
          <button class="btn btn-primary" @click="go('apply')">新建申请</button>
        </div>
        <div class="result-count">共 {{ filtered.length }} 条记录</div>
        <div class="request-card-list">
          <RequestCard v-for="x in filtered" :key="x.id" :item="x" @open="open"></RequestCard>
          <div v-if="!filtered.length" class="empty-state">没有符合条件的申请</div>
        </div>
      </div>`
  };

  /* ---------- 请假条垃圾桶 ---------- */
  C.TrashView = {
    name: 'TrashView',
    data: function () { return { items: [], loading: true, error: '' }; },
    computed: { labels: function () { return VP.labels; } },
    created: async function () { await this.load(); },
    methods: {
      load: async function () {
        try {
          var d = await VP.api('/api/requests/trash');
          this.items = d.requests || [];
        } catch (e) {
          this.error = e.message;
        } finally {
          this.loading = false;
        }
      },
      open: function (id) { this.$router.push('/requests/' + id).catch(function () { }); }
    },
    template: `
      <div>
        <div class="hero">
          <h2>请假条垃圾桶</h2>
          <div>归档记录不会被删除，可点击查看原申请、审批轨迹和归档原因。</div>
        </div>
        <div v-if="error" class="notice rule-warning">{{ error }}</div>
        <div v-else-if="loading" class="empty-state">正在加载归档记录…</div>
        <div v-else class="card">
          <div class="trash-list">
            <button v-for="item in items" :key="item.id" class="trash-item" @click="open(item.id)">
              <div>
                <strong>{{ item.request_no }} · {{ item.leave_type }}</strong>
                <span>{{ String(item.start_time).slice(0, 10) }} 至 {{ String(item.end_time).slice(0, 10) }} · {{ item.days }} 天</span>
                <small>{{ item.archive_reason || '已归档' }}</small>
              </div>
              <div class="trash-meta">
                <span class="badge" :class="item.status">{{ labels[item.status] || item.status }}</span>
                <time>{{ item.archived_at || item.updated_at }}</time>
              </div>
            </button>
            <div v-if="!items.length" class="empty-state small">垃圾桶中暂无请假条</div>
          </div>
        </div>
      </div>`
  };

  /* ---------- 我的假期余额 / 个人信息 ---------- */
  C.ProfileView = {
    name: 'ProfileView',
    data: function () { return { passwordOpen: false, savedCredential: null, showSaved: false }; },
    computed: {
      store: function () { return VP.store; },
      me: function () { return VP.store.me || {}; },
      balances: function () {
        var policies = VP.store.policies;
        return VP.store.balances.filter(function (x) {
          return policies.some(function (p) { return p.leave_type === x.leave_type; });
        });
      },
      hasSavedPassword: function () {
        return !!(this.savedCredential && this.savedCredential.password && !this.savedCredential.stale);
      }
    },
    created: function () {
      var name = (VP.store.me || {}).username;
      this.savedCredential = VP.loginMemory().find(function (x) { return x.username === name; }) || null;
    },
    methods: {
      fmt: function (v) { return VP.fmtDays(v); },
      policyOf: function (lt) {
        return VP.store.policies.find(function (p) { return p.leave_type === lt; }) || {};
      },
      go: function (page) { this.$router.push('/' + page).catch(function () { }); },
      icon: function () { return this.showSaved ? VP.iconEyeOpen() : VP.iconEyeClosed(); }
    },
    template: `
      <div>
        <section class="balance-overview">
          <div>
            <span class="eyebrow">可用假期</span>
            <h3>{{ me.name }}的假期账户</h3>
            <p>{{ me.department || '综合管理部' }} · 连续工龄 {{ me.continuous_years }} 年</p>
          </div>
          <button class="btn btn-primary" @click="go('apply')">发起请假</button>
        </section>
        <div class="balance-saas-grid">
          <article v-for="x in balances" :key="x.leave_type" class="balance-saas-card">
            <div><span>{{ x.leave_type }}</span><small>{{ policyOf(x.leave_type).unit || '天' }}计算</small></div>
            <div class="balance-remaining"><span>剩余</span><strong>{{ fmt(x.remaining_days) }}<em>天</em></strong></div>
            <div class="balance-usage">
              <span>本年度已用 <b>{{ fmt(x.used_days) }}</b> 天</span>
              <span>审批中 <b>{{ fmt(x.pending_days) }}</b> 天</span>
            </div>
            <p>{{ policyOf(x.leave_type).limit || '' }}</p>
          </article>
        </div>
        <div class="grid account-panel">
          <section class="card span5">
            <h3>个人信息</h3>
            <dl class="info-list">
              <div><dt>员工工号</dt><dd>{{ (me.employee_profile || {}).employee_no || '未填写' }}</dd></div>
              <div><dt>岗位</dt><dd>{{ (me.employee_profile || {}).position_title || '未填写' }}</dd></div>
              <div><dt>部门</dt><dd>{{ me.department || '综合管理部' }}</dd></div>
              <div><dt>联系电话</dt><dd>{{ (me.employee_profile || {}).phone || '未填写' }}</dd></div>
              <div><dt>工作邮箱</dt><dd>{{ (me.employee_profile || {}).work_email || '未填写' }}</dd></div>
              <div><dt>紧急联系人</dt><dd>{{ (me.employee_profile || {}).emergency_contact || '未填写' }}{{ (me.employee_profile || {}).emergency_phone ? ' · ' + me.employee_profile.emergency_phone : '' }}</dd></div>
              <div><dt>本单位工龄</dt><dd>{{ me.unit_years }} 年</dd></div>
              <div><dt>连续工龄</dt><dd>{{ me.continuous_years }} 年</dd></div>
              <div><dt>法定年休假额度</dt><dd>{{ me.annual_leave_entitlement }} 个工作日</dd></div>
              <div><dt>医疗期参考</dt><dd>{{ me.medical_period_months }} 个月</dd></div>
            </dl>
          </section>
          <section class="card span7">
            <h3>账号安全</h3>
            <dl class="info-list">
              <div><dt>登录账号</dt><dd>{{ me.username }}</dd></div>
              <div><dt>账号类型</dt><dd>{{ me.role === 'approver' ? '审批员' : '普通员工' }}</dd></div>
              <div>
                <dt>本设备密码记忆</dt>
                <dd>
                  <span v-if="hasSavedPassword">{{ showSaved ? savedCredential.password : '••••••••' }}</span>
                  <span v-else-if="savedCredential && savedCredential.stale">等待下次登录重新记忆</span>
                  <span v-else>未在此设备保存</span>
                  <button v-if="hasSavedPassword" type="button" class="password-toggle" @click="showSaved = !showSaved" v-html="icon()"></button>
                </dd>
              </div>
            </dl>
            <div class="notice">服务器不保存可读取的密码明文。修改密码后，本设备会清除旧密码；下次手动输入新密码登录成功后才重新记忆。</div>
            <button class="btn btn-ghost" @click="passwordOpen = true">修改密码</button>
          </section>
        </div>
        <p class="hint">法定病假显示的是医疗期管理参考天数，并非当然可一次性请休的假期余额。</p>
        <ChangePasswordDialog v-model="passwordOpen"></ChangePasswordDialog>
      </div>`
  };

  /* ---------- 制度与流程 ---------- */
  C.GuideView = {
    name: 'GuideView',
    computed: {
      policies: function () { return VP.store.policies; },
      me: function () { return VP.store.me || {}; },
      leaveLengthRule: function () { return VP.store.leaveLengthRule; }
    },
    template: `
      <div class="grid">
        <div v-if="leaveLengthRule" class="notice span12">
          <strong>长短假划分</strong><br>{{ leaveLengthRule.text }}
        </div>
        <div class="card span12">
          <h3>休假类型与计算规则</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>假期类型</th><th>计算单位</th><th>额度与限制</th><th>材料</th></tr></thead>
              <tbody>
                <tr v-for="p in policies" :key="p.leave_type">
                  <td><strong>{{ p.leave_type }}</strong></td>
                  <td>{{ p.unit }}</td>
                  <td>{{ p.limit }}</td>
                  <td>{{ p.proof ? '需要/待补交' : '按实际情况' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card span7">
          <h3>年休假规则</h3>
          <p>累计工作满 1 年不满 10 年：5 个工作日；满 10 年不满 20 年：10 个工作日；满 20 年及以上：15 个工作日。</p>
          <p>新入职当年按“年度应休天数 × 当年实际工作月数 ÷ 12”折算，不足 1 天部分舍去。</p>
          <p>病假达到法定工龄档位的 2／3／4 个月，或事假累计达到 20 天且单位未扣发工资，经依法核实后可取消当年未休年假；已休部分不追溯。</p>
        </div>
        <div class="card span5">
          <h3>病假与医疗期</h3>
          <p>法定病假按自然日连续计算，工作日、休息日和法定节假日均计入，并统一纳入医疗期。</p>
          <div class="notice">你的当前医疗期参考值：<strong>{{ me.medical_period_months || '—' }} 个月</strong></div>
          <p class="hint">同一或医学相关疾病原则上合并计算；医学关联性以合法医疗机构诊断意见为依据。</p>
        </div>
        <div class="card span12">
          <h3>申请与审批流程</h3>
          <ol class="flow">
            <li><strong>选择类型和日期</strong><br><span class="hint">系统按工作日或自然日自动计算。</span></li>
            <li><strong>提交或标记待补交材料</strong></li>
            <li><strong>审批员处理</strong><br><span class="hint">通常 1 个工作日，复杂申请原则上不超过 2 个工作日。</span></li>
            <li><strong>查看结果并按留言修改或补充</strong></li>
          </ol>
        </div>
        <div class="card span4">
          <h3>提前返岗 / 销假</h3>
          <p>员工提前返岗时，应于返岗当日或返岗前确认实际休假结束时间并提交审批。</p>
          <p class="hint">未办理但实际返岗的，由公司结合考勤、工作安排等事实综合认定。</p>
        </div>
        <div class="card span4">
          <h3>续假</h3>
          <p>确需延长休假的，必须在原批准假期届满前申请，并按原假期类型补充材料；审批通过后方可继续休假。</p>
          <p class="hint">未经批准擅自延长的，视为未请假缺勤。</p>
        </div>
        <div class="card span4">
          <h3>病假复工</h3>
          <p>病假返岗时，公司可结合岗位风险依法、合理要求复工证明或健康评估，以保障健康与生产安全。</p>
        </div>
      </div>`
  };

  /* ---------- 消息通知 ---------- */
  C.NotificationsView = {
    name: 'NotificationsView',
    data: function () { return { items: [], unread: 0, loading: true }; },
    computed: { isApprover: function () { return VP.isApprover(); } },
    created: async function () {
      try {
        var d = await VP.api('/api/notifications');
        this.items = d.notifications || [];
        this.unread = d.unread || 0;
        VP.store.unread = this.unread;
      } catch (e) {
        VP.toast(e.message, true);
      } finally {
        this.loading = false;
      }
    },
    methods: {
      markAll: async function () {
        try {
          await VP.api('/api/notifications/read', { method: 'POST', body: '{}' });
          this.items.forEach(function (x) { x.is_read = 1; });
          this.unread = 0;
          VP.store.unread = 0;
        } catch (e) { VP.toast(e.message, true); }
      },
      open: async function (item) {
        try {
          await VP.api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id: Number(item.id) }) });
          item.is_read = 1;
          await VP.refreshUnread();
          this.unread = VP.store.unread;
        } catch (e) { /* 忽略 */ }
        if (item.target_page) {
          var targetId = Number(item.request_id || 0);
          if (item.target_page === 'history' && targetId) {
            this.$router.push('/history/requests/' + targetId).catch(function () { });
          } else if (item.target_page === 'records' && targetId) {
            this.$router.push('/requests/' + targetId).catch(function () { });
          } else {
            this.$router.push('/' + item.target_page).catch(function () { });
          }
          return;
        }
        var rid = Number(item.request_id || 0);
        if (!rid) {
          var page = '';
          if (item.category === 'attendance') {
            if ((item.title || '').indexOf('补卡') >= 0) {
              page = this.isApprover ? 'correction-approvals' : 'attendance';
            } else {
              page = this.isApprover ? 'attendance-admin' : 'attendance';
            }
          } else if (item.category === 'overtime') {
            page = this.isApprover ? 'overtime-admin' : 'overtime';
          } else if (item.category === 'adjustment') {
            page = this.isApprover ? 'adjustments' : 'records';
          } else if (item.category === 'delegation') {
            page = 'delegation';
          } else if (item.category === 'profile') {
            page = 'profile';
          }
          if (page) { this.$router.push('/' + page).catch(function () { }); }
          return;
        }
        if (this.isApprover) {
          this.$router.push('/history/requests/' + rid).catch(function () { });
        } else {
          this.$router.push('/requests/' + rid).catch(function () { });
        }
      }
    },
    template: `
      <div>
        <div class="hero">
          <h2>最新请假消息</h2>
          <div>{{ isApprover ? '查看员工新申请、重新提交和返岗续假手续。' : '查看请假审批结果、退回原因和补交材料提醒。' }}</div>
        </div>
        <div class="card">
          <div class="toolbar">
            <h3>{{ items.length }} 条消息</h3>
            <button v-if="unread" class="btn btn-ghost" @click="markAll">全部标为已读</button>
            <span v-else class="hint">暂无未读消息</span>
          </div>
          <div class="notification-list">
            <button v-for="n in items" :key="n.id" class="notification-item" :class="{unread: !n.is_read}" @click="open(n)">
              <span class="notification-dot"></span>
              <span>
                <strong>{{ n.title }}</strong>
                <small>{{ n.message }}</small>
                <time>{{ n.created_at }}</time>
              </span>
            </button>
            <div v-if="!items.length" class="notice">暂无消息通知</div>
          </div>
        </div>
      </div>`
  };

  /* ---------- 我的申请详情 ---------- */
  C.EmployeeDetailView = {
    name: 'EmployeeDetailView',
    props: { id: { type: [String, Number], required: true } },
    data: function () {
      return { detail: null, logs: [], adjustments: [], attachments: [], steps: [], error: '', editOpen: false, adjustOpen: false, adjustType: 'return', cancelBusy: false };
    },
    computed: {
      x: function () { return this.detail || {}; },
      labels: function () { return VP.labels; },
      actionLabels: function () { return VP.actionLabels; },
      pendingAdjustment: function () {
        return this.adjustments.some(function (a) { return a.status === 'pending'; });
      }
    },
    created: async function () { await this.load(); },
    watch: {
      id: async function () { await this.load(); }
    },
    methods: {
      load: async function () {
        this.error = '';
        try {
          var d = await VP.api('/api/requests/' + this.id);
          this.detail = d.request;
          this.logs = d.logs || [];
          this.adjustments = d.adjustments || [];
          this.attachments = d.attachments || [];
          this.steps = d.approval_steps || [];
          VP.store.title = '我的申请详情';
          VP.store.subtitle = '申请单 ' + (d.request.request_no || '');
          VP.readRequestNotifications(this.id);
        } catch (e) {
          this.error = e.message;
          VP.toast(e.message, true);
        }
      },
      back: function () {
        if (document.body.classList.contains('detail-only')) {
          window.close();
          setTimeout(function () { location.replace(location.origin + location.pathname); }, 300);
          return;
        }
        this.$router.push(this.x.is_archived ? '/trash' : '/records').catch(function () { });
      },
      fmt: function (v) { return VP.fmtDays(v); },
      day: function (v) { return String(v || '').slice(0, 10); },
      stepStatus: function (status) {
        var map = { pending: '待审批', approved: '已通过', rejected: '已拒绝', returned: '已退回', supplement_required: '待补充材料', skipped: '已跳过' };
        return map[status] || status;
      },
      openAdjust: function (type) { this.adjustType = type; this.adjustOpen = true; },
      cancelRequest: async function () {
        if (this.cancelBusy) { return; }
        if (!window.confirm('确认取消申请单 ' + this.x.request_no + '？可用额度会收回，记录移入垃圾桶。')) { return; }
        this.cancelBusy = true;
        try {
          var result = await VP.api('/api/requests/' + this.id + '/cancel', { method: 'POST', body: '{}' });
          VP.toast(result.released_days > 0 ? '已取消并返还 ' + result.released_days + ' 天' : '申请已取消并移入垃圾桶');
          await VP.loadSession();
          this.$router.push('/trash').catch(function () { });
        } catch (e) {
          VP.toast(e.message, true);
        } finally {
          this.cancelBusy = false;
        }
      }
    },
    template: `
      <div v-if="error" class="notice rule-warning">{{ error }}</div>
      <div v-else-if="detail">
        <div class="toolbar">
          <button class="btn btn-ghost" @click="back">← {{ x.is_archived ? '返回垃圾桶' : '返回我的申请' }}</button>
          <span class="hint">{{ x.request_no }}</span>
        </div>
        <div class="grid">
          <div class="card span8">
            <div class="toolbar">
              <div>
                <h3>{{ x.leave_type }}</h3>
                <span class="badge" :class="x.status">{{ labels[x.status] || x.status }}</span>
              </div>
              <div class="actions">
                <button v-if="x.can_modify" class="action-edit-request" @click="editOpen = true">修改申请&nbsp;&nbsp;&nbsp;仅限一次</button>
                <button v-if="x.can_cancel" class="btn btn-danger" :disabled="cancelBusy" @click="cancelRequest">{{ cancelBusy ? '取消中…' : '取消申请' }}</button>
                <template v-if="x.status === 'approved' && !pendingAdjustment">
                  <button class="action-return-work" @click="openAdjust('return')">提前返岗 / 销假</button>
                  <button class="action-extend-leave" @click="openAdjust('extension')">申请续假</button>
                </template>
                <span v-else-if="pendingAdjustment" class="badge pending">返岗/续假手续审批中</span>
              </div>
            </div>
            <div v-if="x.is_archived" class="notice rule-warning">
              该申请已归档：{{ x.archive_reason || '已移入垃圾桶' }}（{{ x.archived_at }}）
            </div>
            <table>
              <tbody>
                <tr><th>开始时间</th><td>{{ x.start_time }}</td><th>结束时间</th><td>{{ x.end_time }}</td></tr>
                <tr><th>请假天数</th><td>{{ fmt(x.days) }} 天</td><th>计算口径</th><td>{{ x.policy_unit || '—' }}</td></tr>
                <tr><th>提交时间</th><td>{{ x.submitted_at }}</td><th>审批轮次</th><td>第 {{ x.review_round }} 次</td></tr>
                <tr><th>是否按时</th><td>{{ x.timely ? '✓ 按时' : '⚠ 未按时' }}</td><th>突发报备</th><td>{{ x.emergency_report ? '已报备' : '否' }}</td></tr>
              </tbody>
            </table>
            <h3 style="margin-top:22px">申请事由</h3>
            <div class="notice">{{ x.reason || '—' }}</div>
            <h3>材料信息</h3>
            <div class="notice">状态：{{ x.material_status === 'complete' ? '已提交' : '待补交' }}<br>说明：{{ x.material_note || '—' }}</div>
            <AttachmentGallery :items="attachments"></AttachmentGallery>
            <template v-if="x.approver_comment">
              <h3>审批留言</h3>
              <div class="notice rule-warning">{{ x.approver_comment }}</div>
            </template>
          </div>
          <div class="card span4">
            <h3>申请规则</h3>
            <p>{{ x.timing_rule }}</p>
            <p>{{ x.material_rule }}</p>
            <h3>审批流程</h3>
            <div class="approval-flow">
              <div v-for="s in steps" :key="s.step_no" class="approval-step" :class="s.status">
                <span class="step-no">{{ s.step_no }}</span>
                <div>
                  <strong>{{ s.approver_name || '审批人' }}</strong>
                  <small>{{ s.step_type_label || '业务审批' }} · {{ stepStatus(s.status) }}</small>
                  <p v-if="s.comment">{{ s.comment }}</p>
                </div>
              </div>
              <p v-if="!steps.length" class="hint">暂无审批步骤</p>
            </div>
            <h3>审批轨迹</h3>
            <ApprovalTimeline :logs="logs"></ApprovalTimeline>
            <h3>返岗 / 续假记录</h3>
            <div v-for="(a, i) in adjustments" :key="i" class="notice">
              <strong>{{ a.adjustment_type === 'return' ? '提前返岗 / 销假' : '续假' }}</strong> · {{ labels[a.status] || a.status }}<br>
              <span class="hint">目标时间：{{ a.proposed_time }}<br>{{ a.reason }}<template v-if="a.approver_comment"><br>审批留言：{{ a.approver_comment }}</template></span>
            </div>
            <p v-if="!adjustments.length" class="hint">暂无记录</p>
          </div>
        </div>
        <EditRequestDialog v-model="editOpen" :request="detail" @done="load"></EditRequestDialog>
        <AdjustmentDialog v-model="adjustOpen" :request="detail" :type="adjustType" @done="load"></AdjustmentDialog>
      </div>`
  };
})(window);
