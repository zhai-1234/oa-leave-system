/* 智审 OA · Vue 审批端页面 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  /* ---------- 待办审批 / 审批记录 ---------- */
  C.AdminView = {
    name: 'AdminView',
    props: { mode: { type: String, default: 'admin' } },
    data: function () {
      return { items: [], query: '', type: '', department: '', order: 'time', approveId: null, returnId: null, confirmOpen: false };
    },
    computed: {
      isHistory: function () { return this.mode === 'history'; },
      isHr: function () { return VP.isHr(); },
      isAdmin: function () { return VP.isAdmin(); },
      selectedApproval: function () {
        var id = this.approveId;
        for (var i = 0; i < this.items.length; i++) {
          if (this.items[i].id === id) { return this.items[i]; }
        }
        return null;
      },
      approveIsFinal: function () { return !this.selectedApproval || this.selectedApproval.is_final_step !== false; },
      approveButtonText: function () { return this.approveIsFinal ? '批准' : '同意并转上级'; },
      approveTitle: function () { return this.approveIsFinal ? '确认批准申请' : '确认同意并转交上级'; },
      approveMessage: function () {
        return this.approveIsFinal
          ? '批准后，该申请将正式生效，并按规则扣减相应假期余额。'
          : '本次操作只记录本级同意意见，并将申请转交下一级审批；转交后暂不扣减假期余额。';
      },
      types: function () {
        var set = {};
        this.items.forEach(function (x) { set[x.leave_type] = 1; });
        return Object.keys(set);
      },
      departments: function () {
        var set = {};
        this.items.forEach(function (x) { set[x.department || '综合管理部'] = 1; });
        return Object.keys(set);
      },
      filtered: function () {
        var q = String(this.query || '').trim().toLowerCase();
        var type = this.type;
        var dept = this.department;
        var list = this.items.filter(function (x) {
          if (type && x.leave_type !== type) { return false; }
          if (dept && (x.department || '综合管理部') !== dept) { return false; }
          if (q) {
            var hay = (x.name + ' ' + x.request_no + ' ' + (x.reason || '')).toLowerCase();
            if (hay.indexOf(q) < 0) { return false; }
          }
          return true;
        });
        if (this.order === 'urgent') {
          list = list.slice().sort(function (a, b) {
            return (b.overdue - a.overdue) || String(a.submitted_at).localeCompare(String(b.submitted_at));
          });
        }
        return list;
      }
    },
    created: async function () { await this.load(); },
    watch: {
      mode: async function () { await this.load(); }
    },
    methods: {
      load: async function () {
        try {
          var url = this.isHistory ? '/api/admin/requests?all=1' : '/api/admin/requests';
          var d = await VP.api(url);
          var all = d.requests || [];
          if (!this.isHistory) {
            all = all.filter(function (x) { return VP.isActiveStatus(x.status); });
          }
          this.items = all;
        } catch (e) {
          VP.toast(e.message, true);
        }
      },
      open: function (payload) {
        var target = '/' + (this.isHistory ? 'history' : 'admin') + '/requests/' + payload.id;
        this.$router.push(target).catch(function () { });
      },
      askApprove: function (id) { this.approveId = id; this.confirmOpen = true; },
      doApprove: async function () {
        var id = this.approveId;
        var isFinal = this.approveIsFinal;
        this.approveId = null;
        try {
          var r = await VP.api('/api/admin/requests/' + id + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', comment: isFinal ? '批准' : '同意并转上级' })
          });
          VP.toast(r && r.is_final_step === false ? '已同意并转交上级审批' : '已批准申请');
          await this.load();
          if (r && r.is_final_step === false) {
            this.$router.push('/history').catch(function () { });
          }
        } catch (e) {
          VP.toast(e.message, true);
        }
      },
      askReturn: function (id) { this.returnId = id; },
      afterReturn: async function () {
        await this.load();
        this.$router.push('/history').catch(function () { });
      }
    },
    template: `
      <div>
        <div class="filter-bar approval-filters">
          <div class="search-field">
            <span>⌕</span>
            <input v-model="query" placeholder="搜索员工、单号或原因">
          </div>
          <select v-model="type">
            <option value="">全部假种</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
          <select v-model="department">
            <option value="">全部部门</option>
            <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
          </select>
          <select v-model="order">
            <option value="time">最新提交</option>
            <option value="urgent">超时优先</option>
          </select>
        </div>
        <div class="section-toolbar">
          <div><strong>{{ filtered.length }}</strong> {{ isHistory ? (isAdmin ? '条请假记录' : '条审批记录') : '条待处理' }}</div>
          <span class="sla-note">标准处理时限：1 个工作日</span>
        </div>
        <div class="approval-list">
          <ApprovalCard v-for="x in filtered" :key="x.id" :item="x" :page="mode"
                        @open="open" @approve="askApprove" @return="askReturn"></ApprovalCard>
          <div v-if="!filtered.length" class="empty-state">
            <template v-if="isHr">当前没有轮到 HR 复核的请假申请。业务主管、经理等前置步骤完成后，申请会自动进入这里。</template>
            <template v-else>没有符合条件的申请</template>
          </div>
        </div>

        <ConfirmDialog v-model="confirmOpen" :title="approveTitle"
                       :message="approveMessage" :confirm-text="approveButtonText"
                       @confirm="doApprove"></ConfirmDialog>
        <ReturnDialog :modelValue="returnId !== null" :request-id="returnId"
                      @update:modelValue="returnId = null" @done="afterReturn"></ReturnDialog>
      </div>`
  };

  /* ---------- 审批详情 ---------- */
  C.AdminDetailView = {
    name: 'AdminDetailView',
    props: {
      id: { type: [String, Number], required: true },
      all: { type: String, default: '' }
    },
    data: function () {
      return { detail: null, logs: [], attachments: [], steps: [], error: '', confirmOpen: false, returnOpen: false };
    },
    computed: {
      x: function () { return this.detail || {}; },
      labels: function () { return VP.labels; },
      active: function () { return VP.isActiveStatus(this.x.status); },
      isSelf: function () { return !!(this.x.user_id && VP.store.me && this.x.user_id === VP.store.me.id); },
      canAct: function () { return this.all !== '1' && this.active && !this.isSelf && this.x.can_act === true; },
      approveIsFinal: function () { return this.x.is_final_step !== false; },
      approveButtonText: function () { return this.approveIsFinal ? '批准申请' : '同意并转上级'; },
      approveTitle: function () { return this.approveIsFinal ? '确认批准申请' : '确认同意并转交上级'; },
      approveMessage: function () {
        return this.approveIsFinal
          ? '批准后，该申请将正式生效，并按规则扣减相应假期余额。'
          : '本次操作只记录本级同意意见，并将申请转交下一级审批；转交后暂不扣减假期余额。';
      },
      backTarget: function () { return this.all === '1' ? '/history' : '/admin'; }
    },
    created: async function () { await this.load(); },
    watch: { id: async function () { await this.load(); } },
    methods: {
      load: async function () {
        this.error = '';
        try {
          var suffix = this.all === '1' ? '?all=1' : '';
          var d = await VP.api('/api/admin/requests/' + this.id + suffix);
          this.detail = d.request;
          this.logs = d.logs || [];
          this.attachments = d.attachments || [];
          this.steps = d.approval_steps || [];
          VP.store.title = '请假申请详情';
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
        this.$router.push(this.backTarget).catch(function () { });
      },
      fmt: function (v) { return VP.fmtDays(v); },
      day: function (v) { return String(v || '').slice(0, 10); },
      stepStatus: function (status) {
        var map = { pending: '待审批', approved: '已通过', rejected: '已拒绝', returned: '已退回', supplement_required: '待补充材料', skipped: '已跳过' };
        return map[status] || status;
      },
      doApprove: async function () {
        var isFinal = this.approveIsFinal;
        try {
          var r = await VP.api('/api/admin/requests/' + this.id + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', comment: isFinal ? '批准' : '同意并转上级' })
          });
          VP.toast(r && r.is_final_step === false ? '已同意并转交上级审批' : '已批准申请');
          this.$router.push('/history').catch(function () { });
        } catch (e) { VP.toast(e.message, true); }
      }
    },
    template: `
      <div v-if="error" class="notice rule-warning">{{ error }}</div>
      <div v-else-if="detail">
        <button class="back-link" @click="back">← 返回</button>
        <section class="approval-detail-summary">
          <header>
            <div>
              <span class="eyebrow">申请单 {{ x.request_no }}</span>
              <h2>{{ x.name }} · {{ x.leave_type }}</h2>
              <p>{{ x.department || '综合管理部' }} · {{ x.username }}</p>
            </div>
            <span class="badge" :class="x.status">{{ labels[x.status] || x.status }}</span>
          </header>
          <div class="summary-grid">
            <div><span>请假日期</span><strong>{{ day(x.start_time) }}<br>{{ day(x.end_time) }}</strong></div>
            <div><span>请假时长</span><strong>{{ fmt(x.days) }} 天</strong></div>
            <div class="summary-reason"><span>请假原因</span><strong>{{ x.reason || '无需填写' }}</strong></div>
          </div>
          <BalanceDecision v-if="active" :item="x"></BalanceDecision>
          <div class="detail-actions">
            <template v-if="canAct">
              <button class="btn action-approve" @click="confirmOpen = true">{{ approveButtonText }}</button>
              <button class="btn action-return" @click="returnOpen = true">打回申请</button>
            </template>
            <div v-else-if="active && isSelf" class="notice">不能审批自己的请假申请</div>
          </div>
        </section>
        <section v-if="steps.length" class="card approval-flow-card">
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
          </div>
        </section>
        <div class="detail-columns">
          <section class="card">
            <h3>申请与材料</h3>
            <dl class="info-list">
              <div><dt>计算口径</dt><dd>{{ x.policy_unit || '—' }}</dd></div>
              <div><dt>申请时限</dt><dd>{{ x.timely ? '符合' : '未符合' }} · 实际提前 {{ x.advance_actual }} 个工作日</dd></div>
              <div><dt>材料状态</dt><dd>{{ x.material_status === 'complete' ? '已提交' : '待补交' }}</dd></div>
              <div><dt>突发报备</dt><dd>{{ x.emergency_report ? '已报备' : '否' }}</dd></div>
              <div><dt>申请事由</dt><dd>{{ x.reason || '—' }}</dd></div>
            </dl>
            <AttachmentGallery :items="attachments"></AttachmentGallery>
          </section>
          <section class="card">
            <h3>审批历史</h3>
            <ApprovalTimeline :logs="logs"></ApprovalTimeline>
          </section>
        </div>
        <ConfirmDialog v-model="confirmOpen" :title="approveTitle"
                       :message="approveMessage" :confirm-text="approveButtonText"
                       @confirm="doApprove"></ConfirmDialog>
        <ReturnDialog v-model="returnOpen" :request-id="id"
                      @done="$router.push('/history')"></ReturnDialog>
      </div>`
  };

  /* ---------- 返岗与续假审批 ---------- */
  C.AdjustmentsView = {
    name: 'AdjustmentsView',
    data: function () { return { items: [], confirmId: null, confirmOpen: false, returnId: null }; },
    computed: { labels: function () { return VP.labels; } },
    created: async function () { await this.load(); },
    methods: {
      load: async function () {
        try {
          var d = await VP.api('/api/admin/adjustments');
          this.items = d.adjustments || [];
        } catch (e) { VP.toast(e.message, true); }
      },
      askApprove: function (id) { this.confirmId = id; this.confirmOpen = true; },
      doApprove: async function () {
        var id = this.confirmId;
        this.confirmId = null;
        try {
          await VP.api('/api/admin/adjustments/' + id + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'approve', comment: '通过' })
          });
          VP.toast('处理完成');
          await this.load();
        } catch (e) { VP.toast(e.message, true); }
      },
      askReturn: function (id) { this.returnId = id; }
    },
    template: `
      <div>
        <div class="hero">
          <h2>返岗、销假与续假审批</h2>
          <div>审批流程与请假审批一致；待处理手续按提交时间排序。</div>
        </div>
        <div class="card">
          <div class="toolbar">
            <h3>{{ items.length }} 条手续</h3>
            <span class="hint">原则上 1 个工作日内处理</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>员工</th><th>原申请</th><th>手续类型</th><th>目标时间</th><th>原因 / 材料</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="a in items" :key="a.id">
                  <td><strong>{{ a.name }}</strong><br>{{ a.username }}</td>
                  <td>{{ a.request_no }}<br><span class="hint">{{ a.leave_type }}<br>{{ a.start_time }} 至 {{ a.end_time }}</span></td>
                  <td><strong>{{ a.adjustment_type === 'return' ? '提前返岗 / 销假' : '续假' }}</strong></td>
                  <td>{{ a.proposed_time }}</td>
                  <td>{{ a.reason }}<br><span class="hint">材料：{{ a.material_status === 'complete' ? '已提交' : '待补交' }}<br>{{ a.material_note || '' }}</span></td>
                  <td>
                    <span class="badge" :class="a.status">{{ labels[a.status] || a.status }}</span>
                    <span v-if="a.status === 'pending' && a.current_approver_name"><br><span class="hint">当前：{{ a.current_approver_name }}</span></span>
                    <span v-if="a.acting_for_name" class="proxy-mark">代理审批：{{ a.proxy_actor_name }} 代 {{ a.acting_for_name }}</span>
                    <span v-if="a.overdue"><br><span class="overdue">● 已超时</span></span>
                    <template v-if="a.approver_comment"><br>{{ a.approver_comment }}</template>
                  </td>
                  <td>
                    <div v-if="a.status === 'pending'" class="actions">
                      <button class="action-approve" @click="askApprove(a.id)">通过</button>
                      <button class="action-return" @click="askReturn(a.id)">打回</button>
                    </div>
                    <span v-else>—</span>
                  </td>
                </tr>
                <tr v-if="!items.length"><td colspan="7">暂无返岗或续假手续</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <ConfirmDialog v-model="confirmOpen" title="确认通过返岗 / 续假手续"
                       message="通过后将更新原请假结束时间、实际休假天数及对应假期余额。"
                       @confirm="doApprove"></ConfirmDialog>
        <AdjustmentReturnDialog :modelValue="returnId !== null" :adjustment-id="returnId"
                                @update:modelValue="returnId = null" @done="load"></AdjustmentReturnDialog>
      </div>`
  };

  /* ---------- HR 假期管理 ---------- */
  C.HrView = {
    name: 'HrView',
    data: function () {
      return { data: null, error: '' };
    },
    computed: {
      counts: function () { return (this.data && this.data.status_counts) || {}; },
      pendingTotal: function () {
        var c = this.counts;
        return (c.pending || 0) + (c.reported || 0) + (c.supplement_required || 0);
      }
    },
    created: async function () {
      try {
        this.data = await VP.api('/api/admin/hr-summary');
      } catch (e) {
        this.error = e.message;
        VP.toast(e.message, true);
      }
    },
    methods: {
      fmt: function (v) { return VP.fmtDays(v); },
      visiblePolicies: function () {
        return ((this.data && this.data.policies) || []).filter(function (p) { return p.application_required !== false; });
      }
    },
    template: `
      <div v-if="error" class="notice rule-warning">{{ error }}</div>
      <div v-else-if="data">
        <div class="kpi-grid">
          <article><span>在职员工</span><strong>{{ data.employees }}</strong><small>人</small></article>
          <article><span>待审批</span><strong>{{ pendingTotal }}</strong><small>条</small></article>
          <article><span>已通过</span><strong>{{ counts.approved || 0 }}</strong><small>条</small></article>
          <article><span>退回 / 不通过</span><strong>{{ (counts.returned || 0) + (counts.rejected || 0) }}</strong><small>条</small></article>
        </div>
        <div class="detail-columns hr-columns">
          <section class="card">
            <h3>假期使用概况</h3>
            <div class="management-list">
              <div v-for="x in data.usage" :key="x.leave_type">
                <strong>{{ x.leave_type }}</strong>
                <span>{{ x.request_count }} 笔申请</span>
                <span>已批准 {{ fmt(x.approved_days) }} 天</span>
                <span>待审 {{ fmt(x.pending_days) }} 天</span>
              </div>
            </div>
          </section>
          <section class="card">
            <h3>假期制度配置</h3>
            <div class="policy-admin-list">
              <details v-for="p in visiblePolicies()" :key="p.leave_type">
                <summary><strong>{{ p.leave_type }}</strong><span>{{ p.unit }}</span></summary>
                <p>{{ p.limit }}</p>
                <small>{{ p.timing }}</small>
              </details>
            </div>
          </section>
        </div>
        <div class="privacy-note">权限说明：本页仅展示全局汇总与制度，不展示员工的完整病假历史或其他敏感明细。</div>
      </div>`
  };

  /* ---------- 审批代理 ---------- */
  C.DelegationView = {
    name: 'DelegationView',
    data: function () {
      return {
        delegates: [], current: null, incoming: [], actingFor: [], delegatedTasks: [],
        form: { delegate_approver_id: '', start_date: '', end_date: '', reason: '' },
        error: '', busy: false
      };
    },
    created: async function () { await this.load(); },
    computed: {
      labels: function () { return VP.labels; },
      statusText: function () {
        var map = { pending_accept: '待代理人确认', active: '已生效', rejected: '已拒绝' };
        if (this.current && this.current.status === 'active' && this.current.start_date > this.localDate(0)) {
          return '已接受，待 ' + this.current.start_date + ' 生效';
        }
        return this.current ? (map[this.current.status] || this.current.status) : '无';
      },
      statusClass: function () {
        var map = { pending_accept: 'pending', active: 'approved', rejected: 'returned' };
        if (this.current && this.current.status === 'active' && this.current.start_date > this.localDate(0)) {
          return 'pending';
        }
        return this.current ? (map[this.current.status] || '') : '';
      }
    },
    methods: {
      load: async function () {
        try {
          var d = await VP.api('/api/approval-delegation');
          this.delegates = d.delegates || [];
          this.current = d.current || null;
          this.incoming = d.incoming || [];
          this.actingFor = d.acting_for || [];
          this.delegatedTasks = d.delegated_tasks || [];
          if (this.current) {
            this.form = {
              delegate_approver_id: this.current.delegate_approver_id,
              start_date: this.current.start_date,
              end_date: this.current.end_date,
              reason: this.current.reason || ''
            };
          } else if (this.delegates.length) {
            this.form.delegate_approver_id = this.delegates[0].id;
          }
          if (!this.current) {
            if (!this.form.start_date) { this.form.start_date = this.localDate(0); }
            if (!this.form.end_date) { this.form.end_date = this.localDate(2); }
          }
        } catch (e) { VP.toast(e.message, true); }
      },
      save: async function () {
        if (this.busy) { return; }
        this.error = '';
        this.busy = true;
        try {
          await VP.api('/api/approval-delegation', {
            method: 'POST',
            body: JSON.stringify({
              delegate_approver_id: Number(this.form.delegate_approver_id),
              start_date: this.form.start_date,
              end_date: this.form.end_date,
              reason: this.form.reason
            })
          });
          VP.toast('委托已提交，等待代理人确认');
          await this.load();
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
        }
      },
      clearDelegation: async function () {
        try {
          await VP.api('/api/approval-delegation', {
            method: 'POST',
            body: JSON.stringify({ delegate_approver_id: 0, start_date: '2000-01-01', end_date: '2000-01-01', reason: '' })
          });
          VP.toast('已清除委托');
          await this.load();
        } catch (e) { VP.toast(e.message, true); }
      },
      respond: async function (id, action) {
        try {
          await VP.api('/api/approval-delegation/respond', {
            method: 'POST',
            body: JSON.stringify({ delegation_id: Number(id), action: action })
          });
          VP.toast(action === 'accept' ? '已接受委托' : '已拒绝委托');
          await this.load();
        } catch (e) { VP.toast(e.message, true); }
      },
      day: function (v) { return String(v || '').slice(0, 10); },
      localDate: function (offset) {
        var d = new Date();
        d.setDate(d.getDate() + Number(offset || 0));
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return d.getFullYear() + '-' + m + '-' + day;
      },
      actingStatus: function (item) {
        return item.effective_label || (item.effective_state === 'pending' ? '已接受，待生效' : (item.effective_state === 'ended' ? '代理已结束' : '代理生效中'));
      },
      actingStatusClass: function (item) {
        return item.effective_state === 'active' ? 'approved' : 'pending';
      },
      openTask: function (task) {
        this.$router.push(task.path).catch(function () { });
      },
      correctionTypeLabel: function (type) {
        return { missing_in: '上班缺卡', missing_out: '下班缺卡', late: '迟到更正', early: '早退更正', other: '其他' }[type] || type;
      },
      openLeave: function (id) { this.$router.push('/admin/requests/' + id).catch(function () { }); },
      openCorrections: function () { this.$router.push('/correction-approvals').catch(function () { }); }
    },
    template: `
      <div class="grid">
        <div class="card span7">
          <h3>代理设置</h3>
          <form @submit.prevent="save">
            <div class="two">
              <div class="field">
                <label>代理人</label>
                <select v-model="form.delegate_approver_id" required>
                  <option v-for="x in delegates" :key="x.id" :value="x.id">{{ x.name }} · {{ x.username }}</option>
                </select>
              </div>
              <div class="field"><label>生效开始日期</label><input v-model="form.start_date" type="date" required></div>
            </div>
            <div class="two">
              <div class="field"><label>生效结束日期</label><input v-model="form.end_date" type="date" required></div>
              <div class="field"><label>委托原因</label><input v-model="form.reason" placeholder="如：本人休假期间"></div>
            </div>
            <p class="hint">代理仅在起止日期范围内生效；若开始日期晚于今天，接受后当天不会出现代理待办。</p>
            <div v-if="error" class="notice rule-warning">{{ error }}</div>
            <button class="btn btn-primary" :disabled="busy">保存委托</button>
            <button type="button" class="btn btn-ghost" @click="clearDelegation">清除当前委托</button>
          </form>
        </div>
        <div class="card span5">
          <h3>我的委托状态</h3>
          <p v-if="current">
            <strong>{{ current.delegate_name }}</strong>
            <span class="badge" :class="statusClass">{{ statusText }}</span><br>
            <span class="hint">{{ current.start_date }} 至 {{ current.end_date }}</span><br>
            {{ current.reason || '' }}
          </p>
          <p v-else class="hint">暂无本人发起的委托</p>
        </div>
        <div class="card span12">
          <h3>收到的代理请求</h3>
          <div v-for="x in incoming" :key="x.id" class="ai-req-item">
            <div class="ai-req-info">
              <strong>{{ x.approver_name }}</strong> · {{ x.approver_username }}<br>
              <span class="hint">{{ x.start_date }} 至 {{ x.end_date }}</span><br>
              <span class="hint">{{ x.reason || '' }}</span>
              <div v-if="x.start_date > localDate(0)" class="notice rule-warning">该委托将在 {{ x.start_date }} 生效，今天暂无代理待办。</div>
            </div>
            <div>
              <button type="button" class="btn btn-primary" @click="respond(x.id, 'accept')">接受</button>
              <button type="button" class="btn btn-ghost" @click="respond(x.id, 'reject')">拒绝</button>
            </div>
          </div>
          <div v-if="!incoming.length" class="hint">暂无待确认的委托</div>
        </div>
        <div class="card span12">
          <h3>我代理的审批</h3>
          <div v-for="x in actingFor" :key="'acting-'+x.id" class="ai-req-item delegation-task">
            <div class="ai-req-info">
              <span class="delegation-type">代理身份</span>
              <strong>{{ x.approver_name }}</strong> · {{ x.approver_username }}<br>
              <span class="hint">{{ x.start_date }} 至 {{ x.end_date }} · {{ x.reason || '未填写原因' }}</span>
            </div>
            <div class="actions">
              <span class="badge" :class="actingStatusClass(x)">{{ actingStatus(x) }}</span>
            </div>
          </div>
          <div v-if="!actingFor.length" class="hint">当前没有已接受的代理委托</div>
        </div>
        <div class="card span12">
          <h3>代理收到的全部业务待办</h3>
          <div v-for="x in delegatedTasks" :key="x.task_type + '-' + x.id" class="ai-req-item delegation-task">
            <div class="ai-req-info">
              <span class="delegation-type">{{ x.task_type_label }}</span>
              <strong>{{ x.employee_name }}</strong> · {{ x.title }}<br>
              <span class="hint">{{ x.summary }}</span>
            </div>
            <div class="actions">
              <span class="badge pending">待审批</span>
              <button class="btn btn-ghost" @click="openTask(x)">去处理</button>
            </div>
          </div>
          <div v-if="!delegatedTasks.length" class="hint">当前代理生效范围内没有待审批业务</div>
        </div>
      </div>`
  };

  /* ---------- 部门管理（HR / 系统管理员） ---------- */
  C.DepartmentView = {
    name: 'DepartmentView',
    data: function () {
      return {
        departments: [], approvers: [],
        employees: [], employeeQuery: '', employeeWarning: '', employeeBusyId: 0,
        form: { name: '', approver_id: 0 },
        editing: null, error: '', deleteWarning: '', busy: false
      };
    },
    computed: {
      filteredEmployees: function () {
        var q = String(this.employeeQuery || '').trim().toLowerCase();
        if (!q) { return this.employees; }
        return this.employees.filter(function (employee) {
          return [
            employee.name,
            employee.username,
            employee.department,
            employee.linked_username || ''
          ].join(' ').toLowerCase().indexOf(q) >= 0;
        });
      }
    },
    created: async function () { await this.load(); },
    methods: {
      load: async function () {
        try {
          var d = await VP.api('/api/admin/departments');
          this.departments = d.departments || [];
          this.approvers = d.approvers || [];
          this.employees = (d.employees || []).map(function (employee) {
            employee.department = employee.department || '综合管理部';
            employee._original_department = employee.department;
            return employee;
          });
        } catch (e) { VP.toast(e.message, true); }
      },
      approverName: function (id) {
        for (var i = 0; i < this.approvers.length; i++) {
          if (this.approvers[i].id === id) { return this.approvers[i].name; }
        }
        return '未指定';
      },
      levelLabel: function (level) {
        var map = { employee: '员工', supervisor: '主管', manager: '经理', director: '总监', general_manager: '总经理', hr: 'HR', admin: '管理员' };
        return map[level] || level || '';
      },
      create: async function () {
        if (this.busy) { return; }
        this.error = '';
        if (!String(this.form.name || '').trim()) { this.error = '请填写部门名称'; return; }
        this.busy = true;
        try {
          await VP.api('/api/admin/departments', {
            method: 'POST',
            body: JSON.stringify({ name: this.form.name, approver_id: Number(this.form.approver_id) || 0 })
          });
          VP.toast('已新增部门');
          this.form = { name: '', approver_id: 0 };
          await this.load();
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
        }
      },
      startEdit: function (d) {
        this.editing = { id: d.id, name: d.name, approver_id: d.approver_id || 0 };
      },
      saveEdit: async function () {
        if (!this.editing || !String(this.editing.name || '').trim()) { return; }
        try {
          await VP.api('/api/admin/departments/' + this.editing.id, {
            method: 'POST',
            body: JSON.stringify({ name: this.editing.name, approver_id: Number(this.editing.approver_id) || 0 })
          });
          VP.toast('已保存');
          this.editing = null;
          await this.load();
        } catch (e) { VP.toast(e.message, true); }
      },
      employeeChanged: function (employee) {
        return employee.department !== employee._original_department;
      },
      saveEmployeeDepartment: async function (employee) {
        if (this.employeeBusyId || !this.employeeChanged(employee)) { return; }
        this.employeeWarning = '';
        this.employeeBusyId = employee.id;
        try {
          var result = await VP.api('/api/admin/employees/' + employee.id + '/department', {
            method: 'POST',
            body: JSON.stringify({ department: employee.department })
          });
          VP.toast('已将 ' + employee.name + ' 调整至 ' + result.department);
          await this.load();
        } catch (e) {
          this.employeeWarning = e.message;
          VP.toast(e.message, true);
        } finally {
          this.employeeBusyId = 0;
        }
      },
      remove: async function (d) {
        this.deleteWarning = '';
        if (d.name === '综合管理部') {
          this.deleteWarning = '综合管理部是默认部门，不能删除。';
          return;
        }
        if (Number(d.user_count || 0) > 0) {
          this.deleteWarning = '部门「' + d.name + '」下仍有 ' + d.user_count + ' 个关联账号，不能删除。请先调整人员所属部门。';
          return;
        }
        if (!window.confirm('确认删除空部门「' + d.name + '」？')) { return; }
        try {
          await VP.api('/api/admin/departments/' + d.id + '/delete', { method: 'POST' });
          VP.toast('已删除');
          await this.load();
        } catch (e) {
          this.deleteWarning = e.message;
          VP.toast(e.message, true);
        }
      }
    },
    template: `
      <div>
        <div class="hero"><h2>部门管理</h2><div>HR 与系统管理员可维护部门清单和部门审批员；有人员关联的部门和默认部门不能删除。</div></div>
        <div class="detail-columns dept-cols">
          <section class="card">
            <h3>部门清单</h3>
            <div v-if="deleteWarning" class="notice rule-warning dept-delete-warning" role="alert">{{ deleteWarning }}</div>
            <div class="dept-list">
              <div v-for="d in departments" :key="d.id" class="dept-row">
                <template v-if="editing && editing.id === d.id">
                  <div class="dept-edit">
                    <input v-model="editing.name">
                    <select v-model="editing.approver_id">
                      <option :value="0">未指定审批员</option>
                      <option v-for="a in approvers" :key="a.id" :value="a.id">{{ a.name }} · {{ a.username }} · {{ levelLabel(a.job_level) }}</option>
                    </select>
                  </div>
                  <div class="dept-actions">
                    <button class="btn btn-primary" @click="saveEdit">保存</button>
                    <button class="btn btn-ghost" @click="editing = null">取消</button>
                  </div>
                </template>
                <template v-else>
                  <div class="dept-name">
                    <strong>{{ d.name }}</strong>
                    <small>审批员：{{ approverName(d.approver_id) }} · 关联人员：{{ d.user_count || 0 }} 人</small>
                  </div>
                  <div class="dept-actions">
                    <button class="btn btn-ghost" @click="startEdit(d)">编辑</button>
                    <button class="btn btn-danger" @click="remove(d)">删除</button>
                  </div>
                </template>
              </div>
              <div v-if="!departments.length" class="hint">暂无部门</div>
            </div>
          </section>
          <section class="card">
            <h3>新增部门</h3>
            <form @submit.prevent="create">
              <div class="field"><label>部门名称</label><input v-model="form.name" required></div>
              <div class="field">
                <label>审批员（可选）</label>
                <select v-model="form.approver_id">
                  <option :value="0">未指定审批员</option>
                  <option v-for="a in approvers" :key="a.id" :value="a.id">{{ a.name }} · {{ a.username }} · {{ levelLabel(a.job_level) }}</option>
                </select>
              </div>
              <div v-if="error" class="notice rule-warning">{{ error }}</div>
              <button class="btn btn-primary" :disabled="busy">{{ busy ? '处理中…' : '新增部门' }}</button>
            </form>
            <p class="hint">未指定审批员时，该部门员工的请假仍按各自的上级审批员流转。</p>
          </section>
        </div>
        <section class="card dept-employee-card">
          <div class="card-heading">
            <div>
              <h3>员工部门归属</h3>
              <p>调整后同步关联审批身份；已完成和审批中的流程保持原审批步骤，新申请按新部门路由。</p>
            </div>
            <input v-model="employeeQuery" class="dept-employee-search" placeholder="搜索姓名、账号或部门">
          </div>
          <div v-if="employeeWarning" class="notice rule-warning" role="alert">{{ employeeWarning }}</div>
          <div class="table-wrap dept-employee-table">
            <table>
              <thead><tr><th>员工</th><th class="dept-col-level">层级</th><th class="dept-col-linked">关联审批身份</th><th>所属部门</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="e in filteredEmployees" :key="e.id">
                  <td>
                    <strong>{{ e.name }}</strong><br><span class="hint">{{ e.username }}</span>
                    <span class="dept-employee-mobile-meta">{{ levelLabel(e.job_level) }}<template v-if="e.linked_username"> · 审批身份 {{ e.linked_username }}</template></span>
                  </td>
                  <td class="dept-col-level">{{ levelLabel(e.job_level) }}</td>
                  <td class="dept-col-linked"><span v-if="e.linked_username">{{ e.linked_username }}</span><span v-else class="hint">—</span></td>
                  <td>
                    <select v-model="e.department">
                      <option v-for="d in departments" :key="d.id" :value="d.name">{{ d.name }}</option>
                    </select>
                  </td>
                  <td>
                    <button class="btn btn-primary" :disabled="employeeBusyId || !employeeChanged(e)"
                            @click="saveEmployeeDepartment(e)">
                      {{ employeeBusyId === e.id ? '保存中…' : '保存部门' }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!filteredEmployees.length"><td colspan="5">没有符合条件的员工</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>`
  };
})(window);
