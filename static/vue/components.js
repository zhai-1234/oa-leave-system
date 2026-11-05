/* 智审 OA · Vue 公共组件与列表卡片 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  /* 余额判断条 */
  C.BalanceDecision = {
    name: 'BalanceDecision',
    props: {
      item: { type: Object, required: true },
      compact: { type: Boolean, default: false }
    },
    computed: {
      visible: function () { return this.item.available_balance !== undefined; },
      cls: function () {
        return 'balance-decision' + (this.item.balance_sufficient ? '' : ' insufficient') + (this.compact ? ' compact' : '');
      },
      pending: function () { return Number(this.item.pending_occupied || 0); }
    },
    methods: { fmt: function (v) { return VP.fmtDays(v); } },
    template: `
      <div v-if="visible" :class="cls">
        <span>{{ item.name }} · {{ item.leave_type }}可用 <strong>{{ fmt(item.available_balance) }} 天</strong></span>
        <span v-if="pending > 0">其他待审占用 <strong>{{ fmt(pending) }} 天</strong></span>
        <span class="balance-arrow">→</span>
        <span>本次 <strong>{{ fmt(item.days) }} 天</strong></span>
        <span class="balance-arrow">→</span>
        <span>批准后 <strong>{{ fmt(item.balance_after_approval) }} 天</strong></span>
        <em v-if="!item.balance_sufficient">余额不足</em>
      </div>`
  };

  /* 附件图墙 */
  C.AttachmentGallery = {
    name: 'AttachmentGallery',
    props: { items: { type: Array, default: function () { return []; } } },
    template: `
      <div>
        <p v-if="!items.length" class="hint">尚未上传证明图片</p>
        <div v-else class="attachment-gallery">
          <a v-for="x in items" :key="x.url" :href="x.url" target="_blank" rel="noopener" :title="'打开 ' + x.original_name">
            <img :src="x.url" :alt="x.original_name">
            <span>{{ x.original_name }}</span>
          </a>
        </div>
      </div>`
  };

  /* 密码输入框（带显示/隐藏） */
  C.PasswordField = {
    name: 'PasswordField',
    props: {
      modelValue: { type: String, default: '' },
      label: { type: String, default: '密码' },
      autocomplete: { type: String, default: 'current-password' },
      placeholder: { type: String, default: '请输入密码' },
      minlength: { type: [String, Number], default: null }
    },
    emits: ['update:modelValue'],
    data: function () { return { visible: false }; },
    computed: {
      icon: function () { return this.visible ? VP.iconEyeOpen() : VP.iconEyeClosed(); },
      title: function () { return this.visible ? '遮挡密码' : '查看密码'; }
    },
    template: `
      <div class="field">
        <label>{{ label }}</label>
        <div class="password-input-wrap">
          <input :type="visible ? 'text' : 'password'" :value="modelValue"
                 :autocomplete="autocomplete" :placeholder="placeholder" :minlength="minlength" required
                 @input="$emit('update:modelValue', $event.target.value)">
          <button type="button" class="password-toggle" :title="title" :aria-label="title"
                  @click="visible = !visible" v-html="icon"></button>
        </div>
        <slot></slot>
      </div>`
  };

  /* 员工端申请记录卡片 */
  C.RequestCard = {
    name: 'RequestCard',
    props: { item: { type: Object, required: true } },
    emits: ['open'],
    computed: {
      labels: function () { return VP.labels; },
      initial: function () { return String(this.item.leave_type || '?').slice(0, 1); },
      dateRange: function () {
        var start = String(this.item.start_time || '');
        var end = String(this.item.end_time || '');
        if (this.item.leave_type === '调休' && start.length >= 16 && end.length >= 16) {
          return start.slice(0, 10) + ' ' + start.slice(11, 16) + ' 至 ' + end.slice(0, 10) + ' ' + end.slice(11, 16);
        }
        return start.slice(0, 10) + ' 至 ' + end.slice(0, 10);
      }
    },
    methods: { fmt: function (v) { return VP.fmtDays(v); } },
    template: `
      <article class="request-card" @click="$emit('open', item.id)">
        <div class="request-card-main">
          <div class="request-type-icon">{{ initial }}</div>
          <div>
            <div class="request-card-title">
              <strong>{{ item.leave_type }}</strong>
              <span class="badge" :class="item.status">{{ labels[item.status] || item.status }}</span>
            </div>
            <p>{{ dateRange }} · {{ fmt(item.days) }} 天</p>
            <small>{{ item.reason || '无需填写请假事由' }}</small>
          </div>
        </div>
        <div class="request-card-meta">
          <span>{{ item.request_no }}</span>
          <time>{{ item.submitted_at }}</time>
          <b>查看详情 →</b>
        </div>
      </article>`
  };

  /* 审批端申请卡片 */
  C.ApprovalCard = {
    name: 'ApprovalCard',
    props: {
      item: { type: Object, required: true },
      page: { type: String, default: 'admin' }
    },
    emits: ['open', 'approve', 'return'],
    computed: {
      labels: function () { return VP.labels; },
      active: function () { return VP.isActiveStatus(this.item.status); },
      cls: function () { return 'approval-card' + (this.item.overdue ? ' is-overdue' : ''); },
      approveLabel: function () { return this.item.is_final_step === false ? '同意并转上级' : '批准'; },
      dateRange: function () {
        var start = String(this.item.start_time || '');
        var end = String(this.item.end_time || '');
        if (this.item.leave_type === '调休' && start.length >= 16 && end.length >= 16) {
          return start.slice(0, 10) + ' ' + start.slice(11, 16) + ' — ' + end.slice(0, 10) + ' ' + end.slice(11, 16);
        }
        return start.slice(0, 10) + ' — ' + end.slice(0, 10);
      }
    },
    methods: { fmt: function (v) { return VP.fmtDays(v); } },
    template: `
      <article :class="cls" @click="$emit('open', { id: item.id, page: page })">
        <header>
          <div>
            <span class="employee-name">{{ item.name }}</span>
            <span class="department-tag">{{ item.department || '综合管理部' }}</span>
          </div>
          <div>
            <span class="badge" :class="item.status">{{ labels[item.status] || item.status }}</span>
            <span v-if="item.overdue" class="overdue">已超时</span>
          </div>
        </header>
        <div class="approval-summary">
          <div class="summary-primary">
            <span class="leave-type">{{ item.leave_type }}</span>
            <strong>{{ dateRange }}</strong>
            <small>{{ fmt(item.days) }} 天 · {{ item.emergency_report ? '突发报备' : '普通申请' }}<template v-if="item.step_type_label"> · {{ item.step_type_label }}</template></small>
            <small v-if="item.acting_for_name" class="proxy-mark">代理审批：{{ item.proxy_actor_name }} 代 {{ item.acting_for_name }}</small>
          </div>
          <div class="reason-brief">
            <span>请假原因</span>
            <p>{{ item.reason || '无需填写' }}</p>
          </div>
          <div><BalanceDecision v-if="active" :item="item" compact></BalanceDecision></div>
        </div>
        <footer>
          <span>{{ item.request_no }} · 提交于 {{ item.submitted_at }}</span>
          <div class="actions">
            <button v-if="active && page !== 'history'" class="action-approve" @click.stop="$emit('approve', item.id)">{{ approveLabel }}</button>
            <button v-if="active && page !== 'history'" class="action-return" @click.stop="$emit('return', item.id)">打回</button>
            <button class="action-view" @click.stop="$emit('open', { id: item.id, page: page })">查看详情</button>
          </div>
        </footer>
      </article>`
  };

  /* 审批轨迹条目 */
  C.ApprovalTimeline = {
    name: 'ApprovalTimeline',
    props: { logs: { type: Array, default: function () { return []; } } },
    computed: { actionLabels: function () { return VP.actionLabels; } },
    template: `
      <div class="timeline">
        <div v-for="(l, i) in logs" :key="i">
          <i></i>
          <strong>{{ actionLabels[l.action] || l.action }}</strong>
          <span>{{ l.approver_name }}<template v-if="l.acting_for_name">（代 {{ l.acting_for_name }} 审批）</template> · {{ l.created_at }}</span>
          <p>{{ l.comment || '无留言' }}</p>
        </div>
        <div v-if="!logs.length" class="empty-state small">暂无审批记录</div>
      </div>`
  };
})(window);
