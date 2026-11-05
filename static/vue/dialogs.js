/* 智审 OA · Vue 弹窗组件 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  /* 通用确认弹窗（通过申请 / 通过销假续假） */
  C.ConfirmDialog = {
    name: 'ConfirmDialog',
    props: {
      modelValue: { type: Boolean, default: false },
      title: { type: String, default: '确认操作' },
      message: { type: String, default: '' },
      notice: { type: String, default: '请确认申请信息、材料和假期余额均已核对无误。' },
      confirmText: { type: String, default: '确认通过' },
      confirmClass: { type: String, default: 'action-approve' }
    },
    emits: ['update:modelValue', 'confirm'],
    methods: {
      close: function () { this.$emit('update:modelValue', false); },
      confirm: function () {
        this.$emit('update:modelValue', false);
        this.$emit('confirm');
      }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <div class="modal-card approval-confirm">
          <div class="approval-confirm-icon">✓</div>
          <h3>{{ title }}</h3>
          <p>{{ message }}</p>
          <div class="notice">{{ notice }}</div>
          <div class="approval-confirm-actions">
            <button type="button" class="btn btn-ghost" @click="close">取消</button>
            <button type="button" class="btn" :class="confirmClass" @click="confirm">{{ confirmText }}</button>
          </div>
        </div>
      </div>`
  };

  /* 打回请假申请 */
  C.ReturnDialog = {
    name: 'ReturnDialog',
    props: {
      modelValue: { type: Boolean, default: false },
      requestId: { type: [Number, String], default: null }
    },
    emits: ['update:modelValue', 'done'],
    data: function () { return { type: 'return', comment: '', error: '' }; },
    computed: {
      isMaterial: function () { return this.type === 'supplement'; },
      isReject: function () { return this.type === 'reject'; },
      label: function () {
        return this.isMaterial ? '缺失材料说明（选填）' : this.isReject ? '不通过缘由（必填）' : '退回原因（选填）';
      },
      placeholder: function () {
        if (this.isMaterial) { return '说明缺少的证明材料、格式或补交期限'; }
        if (this.isReject) { return '请说明不通过的具体原因'; }
        return '说明需要修改的内容，便于员工重新提交';
      },
      help: function () {
        if (this.isMaterial) { return '申请将进入待补充材料状态，员工补交后进入二次审批。'; }
        if (this.isReject) { return '申请将被标记为不通过，员工可在申请详情中查看缘由。'; }
        return '申请将退回员工修改，重新提交后进入二次审批。';
      }
    },
    watch: {
      modelValue: function (v) {
        if (v) { this.type = 'return'; this.comment = ''; this.error = ''; }
      }
    },
    methods: {
      close: function () { this.$emit('update:modelValue', false); },
      submit: async function () {
        this.error = '';
        var reason = String(this.comment || '').trim();
        if (this.isReject && !reason) {
          this.error = '选择“不通过”时必须填写具体缘由。';
          return;
        }
        try {
          await VP.api('/api/admin/requests/' + this.requestId + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: this.type, comment: reason })
          });
          this.close();
          VP.toast(this.isMaterial ? '已要求补充材料' : this.isReject ? '已设为不通过' : '已退回修改');
          this.$emit('done');
        } catch (e) {
          this.error = e.message;
        }
      }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <div class="modal-card">
          <div class="toolbar">
            <h3>打回请假申请</h3>
            <button class="btn btn-ghost" @click="close">关闭</button>
          </div>
          <div class="field">
            <label>处理方式</label>
            <select v-model="type">
              <option value="return">退回修改</option>
              <option value="supplement">要求补充材料</option>
              <option value="reject">不通过</option>
            </select>
          </div>
          <div class="field">
            <label>{{ label }}</label>
            <textarea v-model="comment" :placeholder="placeholder"></textarea>
          </div>
          <div class="notice">{{ help }}</div>
          <div v-if="error" class="notice rule-warning">{{ error }}</div>
          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button class="btn btn-ghost" @click="close">取消</button>
            <button class="btn btn-danger" @click="submit">确认打回</button>
          </div>
        </div>
      </div>`
  };

  /* 打回销假 / 续假手续 */
  C.AdjustmentReturnDialog = {
    name: 'AdjustmentReturnDialog',
    props: {
      modelValue: { type: Boolean, default: false },
      adjustmentId: { type: [Number, String], default: null }
    },
    emits: ['update:modelValue', 'done'],
    data: function () { return { type: 'return', comment: '', error: '' }; },
    computed: {
      isReject: function () { return this.type === 'reject'; },
      label: function () { return this.isReject ? '不通过缘由（必填）' : '说明（选填）'; },
      placeholder: function () {
        return this.isReject ? '请说明不通过的具体原因' : '填写退回原因、缺失材料或补交期限';
      }
    },
    watch: {
      modelValue: function (v) { if (v) { this.type = 'return'; this.comment = ''; this.error = ''; } }
    },
    methods: {
      close: function () { this.$emit('update:modelValue', false); },
      submit: async function () {
        this.error = '';
        var reason = String(this.comment || '').trim();
        if (this.isReject && !reason) {
          this.error = '选择“不通过”时必须填写具体缘由。';
          return;
        }
        try {
          await VP.api('/api/admin/adjustments/' + this.adjustmentId + '/action', {
            method: 'POST',
            body: JSON.stringify({ action: this.type, comment: reason })
          });
          this.close();
          VP.toast('处理完成');
          this.$emit('done');
        } catch (e) {
          this.error = e.message;
        }
      }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <div class="modal-card">
          <div class="toolbar">
            <h3>打回手续</h3>
            <button class="btn btn-ghost" @click="close">关闭</button>
          </div>
          <div class="field">
            <label>处理方式</label>
            <select v-model="type">
              <option value="return">退回修改</option>
              <option value="supplement">要求补充材料</option>
              <option value="reject">不通过</option>
            </select>
          </div>
          <div class="field">
            <label>{{ label }}</label>
            <textarea v-model="comment" :placeholder="placeholder"></textarea>
          </div>
          <div v-if="error" class="notice rule-warning">{{ error }}</div>
          <button class="btn btn-danger full" @click="submit">确认打回</button>
        </div>
      </div>`
  };

  /* 修改申请（仅限一次） */
  C.EditRequestDialog = {
    name: 'EditRequestDialog',
    props: {
      modelValue: { type: Boolean, default: false },
      request: { type: Object, default: null }
    },
    emits: ['update:modelValue', 'done'],
    data: function () {
      return {
        form: {
          leave_type: '', start_time: '', end_time: '', reason: '',
          related_request_no: '', pending_material: false, material_note: '',
          exception_requested: false, emergency_report: false, emergency_reason: ''
        },
        error: '', uploading: '', busy: false
      };
    },
    computed: {
      policies: function () { return VP.employeePolicies(); },
      currentPolicy: function () {
        var type = this.form.leave_type;
        for (var i = 0; i < this.policies.length; i++) {
          if (this.policies[i].leave_type === type) { return this.policies[i]; }
        }
        return null;
      },
      reasonRequired: function () {
        return !this.currentPolicy || this.currentPolicy.reason_required !== false;
      }
    },
    watch: {
      modelValue: function (v) { if (v) { this.reset(); } }
    },
    methods: {
      reset: function () {
        var x = this.request || {};
        this.form = {
          leave_type: x.leave_type || '',
          start_time: String(x.start_time || '').slice(0, 10),
          end_time: String(x.end_time || '').slice(0, 10),
          reason: x.reason || '',
          related_request_no: x.related_request_no || '',
          pending_material: x.material_status !== 'complete',
          material_note: x.material_note || '',
          exception_requested: !!x.exception_requested,
          emergency_report: !!x.emergency_report,
          emergency_reason: x.emergency_reason || ''
        };
        this.error = '';
        this.uploading = '';
      },
      close: function () { this.$emit('update:modelValue', false); },
      submit: async function () {
        if (this.busy) { return; }
        this.error = '';
        this.busy = true;
        try {
          var body = Object.assign({}, this.form);
          body.attachment_tokens = await VP.uploadFiles(this.$refs.files && this.$refs.files.files, this.$setUploading);
          var r = await VP.api('/api/requests/' + this.request.id + '/update', { method: 'POST', body: JSON.stringify(body) });
          this.close();
          VP.toast('修改成功，进入第 ' + r.review_round + ' 次审批');
          this.$emit('done', this.request.id);
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
        }
      },
      $setUploading: function (text) { this.uploading = text; }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <form class="modal-card edit-request-modal" @submit.prevent="submit">
          <div class="toolbar edit-request-head">
            <h3>修改申请&nbsp;&nbsp;&nbsp;仅限一次</h3>
            <button type="button" class="btn btn-ghost" @click="close">关闭</button>
          </div>
          <div class="edit-request-body">
            <div class="notice">保存后将进入第 {{ (request && request.review_round || 1) + 1 }} 次审批，且不能再次修改。</div>
            <div class="field">
              <label>假期类型</label>
              <select v-model="form.leave_type">
                <option v-for="p in policies" :key="p.leave_type" :value="p.leave_type">{{ p.leave_type }}</option>
              </select>
            </div>
            <div class="two">
              <div class="field"><label>开始日期</label><input v-model="form.start_time" type="date" required></div>
              <div class="field"><label>结束日期</label><input v-model="form.end_time" type="date" required></div>
            </div>
            <div class="field"><label>请假事由</label><textarea v-model="form.reason" :required="reasonRequired" :placeholder="reasonRequired ? '请说明具体事由' : '该假种无需填写事由'"></textarea></div>
            <div class="field">
              <label>关联申请单号</label>
              <input v-model="form.related_request_no" placeholder="路程假须填写关联的婚假或丧假单号">
            </div>
            <label><input type="checkbox" v-model="form.pending_material"> 材料待补交</label>
            <div class="field">
              <label>补充证明图片</label>
              <input ref="files" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
              <div class="upload-status">{{ uploading }}</div>
            </div>
            <div class="field"><label>材料说明</label><input v-model="form.material_note"></div>
            <label><input type="checkbox" v-model="form.exception_requested"> 申请特殊审批</label><br>
            <label><input type="checkbox" v-model="form.emergency_report"> 突发情况报备</label>
            <div class="field"><label>报备原因</label><textarea v-model="form.emergency_reason"></textarea></div>
          </div>
          <div class="edit-request-footer">
            <div v-if="error" class="notice rule-warning">{{ error }}</div>
            <button type="submit" class="btn btn-primary full" :disabled="busy">{{ busy ? '提交中…' : '保存修改并重新提交' }}</button>
          </div>
        </form>
      </div>`
  };

  /* 提前返岗销假 / 申请续假 */
  C.AdjustmentDialog = {
    name: 'AdjustmentDialog',
    props: {
      modelValue: { type: Boolean, default: false },
      request: { type: Object, default: null },
      type: { type: String, default: 'return' }
    },
    emits: ['update:modelValue', 'done'],
    data: function () {
      return {
        form: { proposed_time: '', reason: '', pending_material: false, material_note: '' },
        error: '', uploading: '', busy: false
      };
    },
    computed: {
      isReturn: function () { return this.type === 'return'; },
      title: function () { return this.isReturn ? '提前返岗 / 销假' : '申请续假'; },
      intro: function () {
        return this.isReturn
          ? '应于返岗当日或返岗前办理，确认实际休假结束时间。'
          : '必须在原批准假期届满前提出，经审批通过后方可继续休假。';
      },
      timeLabel: function () { return this.isReturn ? '实际返岗时间' : '续假至'; },
      reasonLabel: function () { return this.isReturn ? '提前返岗原因' : '续假原因'; },
      materialPlaceholder: function () {
        var lt = (this.request && this.request.leave_type) || '';
        if (this.isReturn && lt === '法定病假') { return '复工证明或健康评估说明'; }
        if (this.isReturn) { return '返岗确认材料说明'; }
        return '按 ' + lt + ' 要求补充证明材料';
      },
      showSickNotice: function () {
        return !!(this.request && this.request.leave_type === '法定病假' && this.isReturn);
      }
    },
    watch: {
      modelValue: function (v) {
        if (v) {
          this.form = { proposed_time: '', reason: '', pending_material: false, material_note: '' };
          this.error = '';
          this.uploading = '';
        }
      }
    },
    methods: {
      close: function () { this.$emit('update:modelValue', false); },
      submit: async function () {
        if (this.busy) { return; }
        this.error = '';
        this.busy = true;
        try {
          var body = Object.assign({}, this.form, { adjustment_type: this.type });
          body.attachment_tokens = await VP.uploadFiles(this.$refs.files && this.$refs.files.files, this.$setUploading);
          await VP.api('/api/requests/' + this.request.id + '/adjustments', { method: 'POST', body: JSON.stringify(body) });
          this.close();
          VP.toast((this.isReturn ? '销假' : '续假') + '手续已提交审批');
          this.$emit('done', this.request.id);
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
        }
      },
      $setUploading: function (text) { this.uploading = text; }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <form class="modal-card" @submit.prevent="submit">
          <div class="toolbar">
            <h3>{{ title }}</h3>
            <button type="button" class="btn btn-ghost" @click="close">关闭</button>
          </div>
          <div class="notice">{{ intro }}</div>
          <div v-if="showSickNotice" class="notice">病假返岗时，公司可依法、合理要求复工证明或健康评估，请按岗位要求准备材料。</div>
          <div class="field">
            <label>{{ timeLabel }}</label>
            <input v-model="form.proposed_time" type="datetime-local" required>
          </div>
          <div class="field">
            <label>{{ reasonLabel }}</label>
            <textarea v-model="form.reason" required placeholder="请如实说明原因"></textarea>
          </div>
          <label><input type="checkbox" v-model="form.pending_material"> 相关证明材料待补交</label>
          <div class="field">
            <label>导入证明图片</label>
            <input ref="files" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
            <div class="upload-status">{{ uploading }}</div>
          </div>
          <div class="field">
            <label>材料说明</label>
            <textarea v-model="form.material_note" :placeholder="materialPlaceholder"></textarea>
          </div>
          <div v-if="error" class="notice rule-warning">{{ error }}</div>
          <button class="btn btn-primary full" :disabled="busy">{{ busy ? '提交中…' : '提交' + (isReturn ? '销假' : '续假') + '审批' }}</button>
        </form>
      </div>`
  };

  /* 修改登录密码 */
  C.ChangePasswordDialog = {
    name: 'ChangePasswordDialog',
    props: { modelValue: { type: Boolean, default: false } },
    emits: ['update:modelValue'],
    data: function () {
      return { current_password: '', new_password: '', confirm_password: '', error: '', busy: false };
    },
    watch: {
      modelValue: function (v) {
        if (v) { this.current_password = ''; this.new_password = ''; this.confirm_password = ''; this.error = ''; }
      }
    },
    methods: {
      close: function () { this.$emit('update:modelValue', false); },
      submit: async function () {
        if (this.busy) { return; }
        this.error = '';
        if (this.new_password !== this.confirm_password) {
          this.error = '两次输入的新密码不一致';
          return;
        }
        this.busy = true;
        try {
          await VP.api('/api/change-password', {
            method: 'POST',
            body: JSON.stringify({ current_password: this.current_password, new_password: this.new_password })
          });
          var remembered = VP.loginMemory().find(function (x) { return x.username === VP.store.me.username; });
          if (remembered) { VP.saveLoginMemory(Object.assign({}, remembered, { password: '', stale: true })); }
          this.close();
          VP.toast('密码修改成功；下次登录需手动输入一次新密码，成功后将重新记忆');
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
        }
      }
    },
    template: `
      <div v-if="modelValue" class="modal" @click.self="close">
        <form class="modal-card" @submit.prevent="submit">
          <div class="toolbar">
            <h3>修改登录密码</h3>
            <button type="button" class="btn btn-ghost" @click="close">关闭</button>
          </div>
          <PasswordField v-model="current_password" label="当前密码" autocomplete="current-password" placeholder="请输入当前密码"></PasswordField>
          <PasswordField v-model="new_password" label="新密码" autocomplete="new-password" placeholder="请输入新密码" minlength="6">
            <span class="hint">至少6个字符，不能与当前密码相同</span>
          </PasswordField>
          <PasswordField v-model="confirm_password" label="确认新密码" autocomplete="new-password" placeholder="请再次输入新密码" minlength="6"></PasswordField>
          <div v-if="error" class="notice rule-warning">{{ error }}</div>
          <button class="btn btn-primary full" :disabled="busy">{{ busy ? '提交中…' : '确认修改' }}</button>
        </form>
      </div>`
  };
})(window);
