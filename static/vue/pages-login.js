/* 智审 OA · Vue 登录页 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  C.LoginView = {
    name: 'LoginView',
    data: function () {
      return {
        mode: 'login',
        username: '',
        password: '',
        remember: true,
        error: '',
        notice: '',
        showPass: false,
        showSuggestions: false,
        memories: [],
        selected: null,
        busy: false,
        form: { name: '', gender: '女', age: '', unit_years: '', continuous_years: '', department: '综合管理部' }
      };
    },
    computed: {
      isRegister: function () { return this.mode === 'register'; },
      submitText: function () { return this.isRegister ? '注册账号' : '登录'; },
      matches: function () {
        var q = String(this.username || '').trim();
        return this.memories
          .map(function (x) { return Object.assign({}, x, { score: VP.accountSimilarity(q, x.username) }); })
          .filter(function (x) { return !q || x.score >= 0.34; })
          .sort(function (a, b) { return q ? (b.score - a.score || b.lastUsed - a.lastUsed) : b.lastUsed - a.lastUsed; });
      }
    },
    created: function () {
      this.memories = VP.loginMemory();
    },
    mounted: function () {
      var self = this;
      this._outside = function (e) {
        if (!e.target.closest('.account-field')) { self.showSuggestions = false; }
      };
      document.addEventListener('pointerdown', this._outside);
    },
    beforeUnmount: function () {
      if (this._outside) { document.removeEventListener('pointerdown', this._outside); }
    },
    methods: {
      eyeOpen: function () { return VP.iconEyeOpen(); },
      eyeClosed: function () { return VP.iconEyeClosed(); },
      switchMode: function (mode) {
        this.mode = mode;
        this.error = '';
        this.showSuggestions = false;
      },
      onUsernameInput: function () {
        this.selected = null;
        this.password = '';
        this.notice = '';
        this.showSuggestions = true;
      },
      onUsernameFocus: function () { this.showSuggestions = true; },
      onUsernameKeydown: function (e) {
        if ((e.key === 'Enter' || e.key === 'ArrowDown') && this.showSuggestions && this.matches.length) {
          e.preventDefault();
          this.choose(this.matches[0]);
        }
      },
      choose: function (item) {
        if (!item) { return; }
        this.selected = item;
        this.username = item.username;
        this.password = item.stale ? '' : item.password;
        this.notice = item.stale
          ? '密码已修改，请输入一次新密码以重新建立登录记忆。'
          : '已自动填入此账号上次成功登录的密码';
        this.showSuggestions = false;
        var self = this;
        requestAnimationFrame(function () {
          var el = self.$refs.pass;
          if (el) { el.focus(); }
        });
      },
      removeMemory: function (username) {
        VP.forgetLoginMemory(username);
        this.memories = VP.loginMemory();
        if (this.selected && this.selected.username === username) {
          this.selected = null;
          this.password = '';
          this.notice = '';
        }
      },
      submit: async function () {
        if (this.busy) { return; }
        this.error = '';
        this.busy = true;
        try {
          if (this.isRegister) {
            await VP.api('/api/register', {
              method: 'POST',
              body: JSON.stringify({
                username: this.username, password: this.password,
                name: this.form.name, gender: this.form.gender, age: this.form.age,
                unit_years: this.form.unit_years, continuous_years: this.form.continuous_years,
                department: this.form.department
              })
            });
            if (this.remember) {
              VP.saveLoginMemory({
                username: this.username,
                password: this.password,
                role: 'employee'
              });
              this.memories = VP.loginMemory();
            }
            VP.toast('注册成功，请登录');
            this.switchMode('login');
            return;
          }
          var result = await VP.api('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username: this.username, password: this.password })
          });
          if (this.remember) {
            VP.saveLoginMemory({ username: this.username, password: this.password, role: result.role });
          } else {
            VP.forgetLoginMemory(this.username);
          }
          await this.$router.replace('/enter');
        } catch (x) {
          if (this.selected && this.selected.username === this.username && this.selected.password === this.password) {
            this.error = '此账号的密码可能已经发生变更。请重新输入新密码；登录成功后，系统会自动更新该账号的记忆密码。';
            this.password = '';
            this.notice = '记忆密码已失效，请输入当前密码';
          } else {
            this.error = x.message;
          }
        } finally {
          this.busy = false;
        }
      }
    },
    template: `
      <section class="login-shell">
        <div class="brand-panel">
          <div class="brand-mark">OA · 请假系统</div>
          <div>
            <h1>让每一次休假<br>清楚、有序、可追踪</h1>
            <p>统一管理员工档案、招聘、考勤、假期、审批与成长记录，并由 AI 助手完成制度问答和合规分析。</p>
          </div>
          <small>内部系统 · 请妥善保管账号信息</small>
        </div>
        <div class="login-panel">
          <div class="auth-card">
            <h2>欢迎使用企业员工管理系统</h2>
            <div class="auth-tabs">
              <button :class="{active: mode === 'login'}" @click="switchMode('login')">账号登录</button>
              <button :class="{active: mode === 'register'}" @click="switchMode('register')">新员工注册</button>
            </div>
            <form @submit.prevent="submit">
              <template v-if="isRegister">
                <div class="two">
                  <div class="field"><label>姓名</label><input v-model="form.name" required></div>
                  <div class="field">
                    <label>性别</label>
                    <select v-model="form.gender"><option>女</option><option>男</option><option>其他</option></select>
                  </div>
                </div>
                <div class="two">
                  <div class="field"><label>年龄</label><input v-model="form.age" type="number"></div>
                  <div class="field"><label>本单位工龄</label><input v-model="form.unit_years" type="number" step="0.5"></div>
                </div>
                <div class="two">
                  <div class="field"><label>连续工龄</label><input v-model="form.continuous_years" type="number" step="0.5"></div>
                  <div class="field">
                    <label>部门</label>
                    <input v-model="form.department" placeholder="综合管理部">
                  </div>
                </div>
              </template>
              <div class="field account-field">
                <label>账号</label>
                <input v-model="username" name="username" autocomplete="username" required placeholder="请输入账号"
                       @input="onUsernameInput" @focus="onUsernameFocus" @keydown="onUsernameKeydown">
                <div v-show="showSuggestions && matches.length" class="account-suggestions">
                  <div class="account-suggestions-head">本机已记忆 {{ matches.length }} 个账号，可滚动查看</div>
                  <button v-for="m in matches" :key="m.username" type="button" @click="choose(m)">
                    <span class="avatar">{{ (m.username[0] || '').toUpperCase() }}</span>
                    <span>
                      <strong>{{ m.username }}</strong>
                      <small>{{ m.stale ? '密码已修改 · 需要重新输入' : (m.role === 'approver' ? '审批员账号' : '员工账号') + ' · 已记忆' }}</small>
                    </span>
                    <span class="suggest-remove" title="清除此账号" @click.stop="removeMemory(m.username)">×</span>
                  </button>
                </div>
              </div>
              <div class="field">
                <label>密码</label>
                <div class="password-input-wrap">
                  <input ref="pass" v-model="password" name="password" :type="showPass ? 'text' : 'password'"
                         autocomplete="current-password" required placeholder="请输入密码">
                  <button type="button" class="password-toggle" :title="showPass ? '遮挡密码' : '查看密码'"
                          @click="showPass = !showPass" v-html="showPass ? eyeOpen() : eyeClosed()"></button>
                </div>
                <div class="hint">{{ notice }}</div>
              </div>
              <label class="remember-check"><input type="checkbox" v-model="remember"> 在此设备记住账号和密码</label>
              <div v-if="error" class="notice rule-warning">{{ error }}</div>
              <button class="btn btn-primary full" :disabled="busy">{{ busy ? '处理中…' : submitText }}</button>
            </form>
            <p class="hint">仅在个人或受信任设备启用密码记忆。演示员工：employee / 123456<br>演示审批员：approver / 123456，经理：manager / 123456<br>HR管理员：hr / 123456，系统管理员：admin / 123456</p>
          </div>
        </div>
      </section>`
  };
})(window);
