/* 智审 OA · Vue 应用外壳（侧边栏 / 顶栏 / AI 悬浮球） */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  var APPROVER_NAV = [
    { group: '审批工作' },
    { page: 'admin', label: '待办审批', businessOnly: true, hrAllowed: true },
    { page: 'adjustments', label: '返岗与续假', businessOnly: true, hrAllowed: true },
    { page: 'history', label: '审批记录', businessOnly: true, hrAllowed: true },
    { page: 'delegation', label: '审批代理', businessOnly: true },
    { group: '管理' },
    { page: 'history', label: '全部请假记录', adminOnly: true },
    { page: 'hr', label: '假期管理', hrOrAdmin: true }
  ];

  var EMPLOYEE_NAV = [
    { group: '我的工作台' },
    { page: 'home', label: '工作台' },
    { page: 'apply', label: '发起请假' },
    { page: 'profile', label: '我的假期余额' },
    { page: 'records', label: '我的请假记录' },
    { page: 'guide', label: '制度与流程' }
  ];

  C.AppShell = {
    name: 'AppShell',
    data: function () {
      return {
        fabLeft: null,
        fabTop: null,
        fabMoved: false,
        drag: null,
        tipVisible: false,
        dotHidden: false,
        modalDownOnBackdrop: false
      };
    },
    computed: {
      store: function () { return VP.store; },
      me: function () { return VP.store.me || {}; },
      isApprover: function () { return VP.isApprover(); },
      navItems: function () {
        var items = this.isApprover ? APPROVER_NAV : EMPLOYEE_NAV;
        return items.filter(function (item) {
          if (item.adminOnly) { return VP.isAdmin(); }
          if (item.hrOrAdmin) { return VP.isHrOrAdmin(); }
          if (item.businessOnly) {
            if (VP.isAdmin()) { return false; }
            if (VP.isHr() && !item.hrAllowed) { return false; }
          }
          return true;
        });
      },
      badge: function () { return VP.store.unread > 99 ? '99+' : String(VP.store.unread || 0); },
      initial: function () { return String(this.me.name || '?').slice(0, 1); },
      roleText: function () {
        var levels = { employee: '员工', supervisor: '主管', manager: '部门经理', director: '总监', general_manager: '总经理', hr: 'HR管理员', admin: '系统管理员' };
        var role = this.me.is_admin ? '系统管理员' : (this.me.is_hr ? 'HR管理员' : (levels[this.me.job_level] || (this.isApprover ? '审批员' : '员工')));
        return role + ' · ' + (this.me.department || '综合管理部');
      },
      actingForText: function () {
        var names = this.me.acting_for_names || [];
        return names.length ? '代理审批中：' + names.join('、') : '';
      },
      switchLabel: function () {
        if (this.isApprover && this.me.linked_employee_id) { return '切换员工账号'; }
        if (!this.isApprover && this.me.linked_approver_id) { return '切换审批账号'; }
        return '';
      },
      fabStyle: function () {
        if (this.fabLeft === null) { return {}; }
        return { left: this.fabLeft + 'px', top: this.fabTop + 'px', right: 'auto', bottom: 'auto' };
      },
      cachedViews: function () {
        return [
          'HomeView', 'ApplyView', 'RecordsView', 'ProfileView', 'GuideView',
          'NotificationsView', 'AdminView', 'AdjustmentsView', 'HrView', 'DelegationView'
        ];
      }
    },
    created: function () {
      var self = this;
      this._move = function (e) { self.onFabMove(e); };
      this._up = function () { self.onFabUp(); };
      document.addEventListener('mousemove', this._move);
      document.addEventListener('mouseup', this._up);
    },
    mounted: function () {
      var self = this;
      try { this.dotHidden = localStorage.getItem('ai_tip_shown') === '1'; } catch (e) { /* 忽略 */ }
      if (!this.dotHidden) {
        this._tipOn = setTimeout(function () { self.tipVisible = true; }, 1500);
        this._tipOff = setTimeout(function () {
          self.tipVisible = false;
          try { localStorage.setItem('ai_tip_shown', '1'); } catch (e) { /* 忽略 */ }
        }, 8000);
      }
    },
    beforeUnmount: function () {
      document.removeEventListener('mousemove', this._move);
      document.removeEventListener('mouseup', this._up);
      if (this._tipOn) { clearTimeout(this._tipOn); }
      if (this._tipOff) { clearTimeout(this._tipOff); }
      VP.stopNotifyTimer();
    },
    methods: {
      go: function (page) { this.$router.push('/' + page).catch(function () { }); },
      logout: async function () {
        VP.stopNotifyTimer();
        await VP.logout();
        this.$router.replace('/login').catch(function () { });
      },
      switchAccount: function () { VP.switchAccount(this.$router); },
      openAI: function () {
        VP.store.ai.open = true;
        this.dotHidden = true;
        this.tipVisible = false;
        try { localStorage.setItem('ai_tip_shown', '1'); } catch (e) { /* 忽略 */ }
      },
      closeAI: function () { VP.store.ai.open = false; },
      onBackdropDown: function (e) { this.modalDownOnBackdrop = (e.target === e.currentTarget); },
      onBackdropUp: function (e) {
        if (this.modalDownOnBackdrop && e.target === e.currentTarget) { this.closeAI(); }
        this.modalDownOnBackdrop = false;
      },
      onFabDown: function (e) {
        var rect = this.$refs.fab.getBoundingClientRect();
        this.drag = { sx: e.clientX, sy: e.clientY, left: rect.left, top: rect.top };
        this.fabMoved = false;
        e.preventDefault();
      },
      onFabMove: function (e) {
        if (!this.drag) { return; }
        var dx = e.clientX - this.drag.sx;
        var dy = e.clientY - this.drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) { this.fabMoved = true; }
        if (!this.fabMoved) { return; }
        var w = 52, h = 52;
        this.fabLeft = Math.max(-w / 2, Math.min(window.innerWidth - w / 2, this.drag.left + dx));
        this.fabTop = Math.max(-h / 2, Math.min(window.innerHeight - h / 2, this.drag.top + dy));
      },
      onFabUp: function () { this.drag = null; },
      onFabClick: function () {
        if (this.fabMoved) { this.fabMoved = false; return; }
        this.openAI();
      }
    },
    template: `
      <div>
        <div class="shell">
          <aside class="sidebar">
            <div class="logo"><span class="logo-symbol">OA</span><span>请假系统</span></div>
            <nav class="nav">
              <template v-for="(item, i) in navItems" :key="i">
                <span v-if="item.group" class="nav-group">{{ item.group }}</span>
                <button v-else :class="{active: store.page === item.page}" @click="go(item.page)">{{ item.label }}</button>
              </template>
              <button class="notification-nav" @click="go('notifications')">
                <span>消息通知</span>
                <span class="notification-badge" :class="{hidden: !store.unread}">{{ badge }}</span>
              </button>
            </nav>
            <div class="user-mini">
              <div class="avatar">{{ initial }}</div>
              <div>
                <strong>{{ me.name }}</strong><br>
                <small>{{ roleText }}</small>
              </div>
              <button v-if="switchLabel" class="mini-switch" type="button" @click="switchAccount">{{ switchLabel }}</button>
              <button class="mini-logout" type="button" @click="logout">退出登录</button>
            </div>
          </aside>
          <section class="content">
            <header class="topbar">
              <div>
                <h2>{{ store.title }}</h2>
                <span class="topbar-subtitle">{{ store.subtitle }}</span>
              </div>
              <div class="topbar-actions">
                <span v-if="actingForText" class="acting-for-banner">{{ actingForText }}</span>
                <button class="btn btn-danger" @click="logout">退出</button>
              </div>
            </header>
            <main class="page">
              <router-view v-slot="{ Component, route }">
                <keep-alive :include="cachedViews" :max="30">
                  <component :is="Component" :key="route.fullPath"></component>
                </keep-alive>
              </router-view>
            </main>
          </section>
        </div>

        <button ref="fab" class="ai-fab" :style="fabStyle" title="AI 助手"
                @mousedown="onFabDown" @click="onFabClick">
          AI<span class="ai-fab-dot" :class="{hidden: dotHidden}"></span>
        </button>
        <div class="ai-fab-tip" :class="{hidden: !tipVisible}">问制度 · 帮我请假</div>

        <div class="ai-modal" :class="{hidden: !store.ai.open}"
             @mousedown="onBackdropDown" @mouseup="onBackdropUp">
          <div class="ai-modal-card">
            <div class="ai-modal-head">
              <span>AI 助手</span>
              <button type="button" @click="closeAI">×</button>
            </div>
            <div class="ai-modal-body">
              <AiAssistantPanel v-if="store.ai.open"></AiAssistantPanel>
            </div>
          </div>
        </div>
      </div>`
  };
})(window);
