/* 智审 OA · Vue AI 助手面板 */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  var QA_KEY = 'ai_qa_history';
  var PARSE_KEY = 'ai_parse_history';

  function readHistory(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function writeHistory(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, 10))); } catch (e) { /* 忽略 */ }
  }

  C.AiAssistantPanel = {
    name: 'AiAssistantPanel',
    data: function () {
      return {
        qa: { question: '', loading: false, answer: '', sources: [], mode: '', fallback: false },
        parse: { text: '', loading: false, result: null },
        review: { loading: false, result: null },
        batch: { loading: false, result: null },
        reqs: [],
        qaHistory: [],
        parseHistory: [],
        status: null,
        submitting: false,
        confirmChecked: false,
        feedback: { sending: false, done: false, adopted: null, comment: '', showComment: false }
      };
    },
    computed: {
      store: function () { return VP.store; },
      isApprover: function () { return VP.isApprover(); },
      labels: function () { return VP.labels; },
      parsed: function () { return this.parse.result || null; },
      confidenceText: function () {
        var r = this.parsed;
        return r && typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : '';
      },
      confidenceClass: function () {
        var c = this.parsed && this.parsed.confidence;
        if (typeof c !== 'number') { return ''; }
        return c >= 0.8 ? 'ai-conf-high' : (c >= 0.6 ? 'ai-conf-mid' : 'ai-conf-low');
      },
      needConfirm: function () {
        var r = this.parsed;
        if (!r) { return false; }
        var c = typeof r.confidence === 'number' ? r.confidence : null;
        return (c !== null && c < 0.6) || r.reason_valid === '存疑';
      },
      canSubmit: function () {
        var r = this.parsed;
        if (!r || !r.complete) { return false; }
        if (r.material_required) { return false; }
        if (r.reason_valid === '不合理') { return false; }
        if (this.needConfirm && !this.confirmChecked) { return false; }
        return true;
      },
      qaAnswerHtml: function () {
        if (!this.qa.answer) { return ''; }
        var html = VP.mdToHtml(this.qa.answer);
        return VP.highlightTerms(html, VP.qaHighlightTerms({ sources: this.qa.sources }, this.qa.question));
      },
      suggestionHtml: function () {
        var r = this.parsed;
        return (r && r.suggestion) ? VP.mdToHtml(r.suggestion) : '';
      },
      statusLine: function () {
        var s = this.status;
        if (!s) { return ''; }
        var vector = s.vector_mode === 'embedding-api' ? 'Embedding 接口' : '字符 n-gram 兜底';
        var llm = s.llm_configured ? '已接入' : '未接入（规则兜底）';
        return '检索模式：' + vector + ' · 大模型：' + llm;
      }
    },
    created: async function () {
      this.qaHistory = readHistory(QA_KEY);
      this.parseHistory = readHistory(PARSE_KEY);
      await Promise.all([this.loadReqs(), this.loadStatus()]);
    },
    methods: {
      remember: function (key, value, target) {
        var v = String(value || '').trim();
        if (!v) { return; }
        var list = readHistory(key).filter(function (x) { return x !== v; });
        list.unshift(v);
        writeHistory(key, list);
        if (target === 'qa') { this.qaHistory = readHistory(QA_KEY); }
        if (target === 'parse') { this.parseHistory = readHistory(PARSE_KEY); }
      },
      clearHistory: function (key, target) {
        writeHistory(key, []);
        if (target === 'qa') { this.qaHistory = []; }
        if (target === 'parse') { this.parseHistory = []; }
      },
      removeHistory: function (key, index, target) {
        var list = readHistory(key);
        list.splice(index, 1);
        writeHistory(key, list);
        if (target === 'qa') { this.qaHistory = list; }
        if (target === 'parse') { this.parseHistory = list; }
      },
      useHistory: function (target, value) {
        if (target === 'qa') { this.qa.question = value; }
        if (target === 'parse') { this.parse.text = value; }
      },
      ask: async function () {
        var q = String(this.qa.question || '').trim();
        this.remember(QA_KEY, q, 'qa');
        if (!q) { VP.toast('请输入问题', true); return; }
        this.qa.loading = true;
        this.qa.answer = '';
        this.qa.sources = [];
        try {
          var result = await VP.api('/api/ai/qa', {
            method: 'POST',
            body: JSON.stringify({ question: q })
          });
          this.qa.answer = result.answer || '';
          this.qa.sources = result.sources || [];
          this.qa.mode = result.mode || '';
          this.qa.fallback = result.mode !== 'llm';
        } catch (e) {
          this.qa.answer = '';
          VP.toast(e.message, true);
        } finally {
          this.qa.loading = false;
        }
      },
      copyAnswer: function () { VP.copyText(this.qa.answer); },
      runParse: async function () {
        var t = String(this.parse.text || '').trim();
        this.remember(PARSE_KEY, t, 'parse');
        if (!t) { VP.toast('请先说一句话', true); return; }
        this.parse.loading = true;
        this.confirmChecked = false;
        try {
          var d = await VP.api('/api/ai/parse', { method: 'POST', body: JSON.stringify({ text: t }) });
          this.parse.result = d;
          if (d.follow_up) { VP.toast(d.follow_up); }
        } catch (e) {
          VP.toast(e.message, true);
        } finally {
          this.parse.loading = false;
        }
      },
      submitLeave: function () {
        var r = this.parsed;
        if (!r || !r.leave_type || !r.start_date) { VP.toast('请先解析', true); return; }
        if (r.half_day) { VP.toast('半天暂不支持一键发起，请在“发起请假”手动选择 0.5 天', true); return; }
        if (!this.canSubmit) { return; }
        VP.store.ai.prefill = {
          leave_type: r.leave_type,
          start_date: r.start_date || '',
          end_date: r.end_date || '',
          reason: r.reason || '',
          pending_material: !!r.pending_material,
          material_note: r.material_note || '',
          emergency_report: !!r.emergency_report,
          emergency_reason: r.emergency_reason || ''
        };
        VP.store.ai.open = false;
        this.$router.push('/apply').catch(function () { });
      },
      chooseOption: function (type) {
        var r = this.parsed || {};
        VP.store.ai.prefill = {
          leave_type: type,
          start_date: r.start_date || '',
          end_date: r.end_date || '',
          reason: r.reason || '',
          pending_material: !!r.pending_material,
          material_note: r.material_note || '',
          emergency_report: !!r.emergency_report,
          emergency_reason: r.emergency_reason || ''
        };
        VP.store.ai.open = false;
        this.$router.push('/apply').catch(function () { });
      },
      loadStatus: async function () {
        try { this.status = await VP.api('/api/ai/status'); } catch (e) { /* 忽略 */ }
      },
      loadReqs: async function () {
        try {
          var url = this.isApprover ? '/api/admin/requests' : '/api/requests';
          var d = await VP.api(url);
          var list = (d.requests || []).filter(function (x) {
            return ['pending', 'reported', 'supplement_required', 'returned'].indexOf(x.status) >= 0;
          });
          this.reqs = list;
        } catch (e) { /* 忽略 */ }
      },
      reviewRequest: async function (id) {
        this.review.loading = true;
        this.review.result = null;
        this.feedback.sending = false;
        this.feedback.done = false;
        this.feedback.adopted = null;
        this.feedback.comment = '';
        this.feedback.showComment = false;
        try {
          var d = await VP.api('/api/ai/review-request/' + id, { method: 'POST', body: '{}' });
          this.review.result = d;
        } catch (e) {
          VP.toast(e.message, true);
        } finally {
          this.review.loading = false;
        }
      },
      runBatch: async function () {
        this.batch.loading = true;
        this.batch.result = null;
        try {
          this.batch.result = await VP.api('/api/ai/review-batch', { method: 'POST', body: '{}' });
        } catch (e) {
          VP.toast(e.message, true);
        } finally {
          this.batch.loading = false;
        }
      },
      openDetail: function (id) {
        window.open('?request=' + id, '_blank');
      },
      copyComment: function (text) { VP.copyText(text); },
      testLLM: async function () {
        try {
          var d = await VP.api('/api/ai/test-llm', { method: 'POST', body: '{}' });
          VP.toast(d.ok ? ('连接成功：' + d.reply) : d.message, !d.ok);
        } catch (e) { VP.toast(e.message, true); }
      },
      verdictClass: function (v) {
        return v === '通过' ? 'approved' : (v === '不通过' ? 'returned' : 'pending');
      },
      riskLevelClass: function (level) {
        return level === 'high' ? 'danger' : (level === 'medium' ? 'warn' : 'info');
      },
      riskLevelText: function (level) {
        return level === 'high' ? '高风险' : (level === 'medium' ? '中风险' : '低风险');
      },
      day: function (v) { return String(v || '').slice(0, 10); }
    },
    template: `
      <div>
        <!-- 制度问答 -->
        <div class="ai-card">
          <h3>制度问答</h3>
          <div class="field">
            <input v-model="qa.question" class="ai-input" autocomplete="off"
                   placeholder="例如：婚假要提前几天申请、需要什么材料" @keydown.enter.prevent="ask">
            <div v-if="qaHistory.length" class="ai-hist">
              <div class="ai-hist-head">
                <span class="ai-hist-label">历史</span>
                <button type="button" class="ai-hist-clear" @click="clearHistory('ai_qa_history', 'qa')">清空</button>
              </div>
              <div class="ai-hist-chips">
                <span v-for="(h, i) in qaHistory" :key="i" class="ai-hist-item">
                  <span class="ai-hist-text" @click="useHistory('qa', h)">{{ h }}</span>
                  <button type="button" class="ai-hist-del" title="删除" @click="removeHistory('ai_qa_history', i, 'qa')">×</button>
                </span>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" :disabled="qa.loading" @click="ask">{{ qa.loading ? '思考中…' : '提问' }}</button>
          <div class="ai-out">
            <div v-if="qa.loading" class="ai-loading">思考中…</div>
            <template v-else-if="qa.answer">
              <div v-if="qa.fallback" class="ai-fallback">⚠ LLM 失败，已回退规则版</div>
              <div class="ai-answer" v-html="qaAnswerHtml"></div>
              <div v-if="qa.sources.length" class="hint">
                来源：<span v-for="(s, i) in qa.sources" :key="i" class="ai-src">{{ s }}</span>（{{ qa.mode === 'llm' ? '大模型' : '规则引擎' }}）
              </div>
              <button type="button" class="ai-copy" @click="copyAnswer">复制</button>
            </template>
          </div>
        </div>

        <!-- 智能填单 -->
        <div v-if="!isApprover" class="ai-card">
          <h3>智能填单</h3>
          <div class="field">
            <input v-model="parse.text" class="ai-input" autocomplete="off"
                   placeholder="例如：下周三到周五休年假" @keydown.enter.prevent="runParse">
            <div v-if="parseHistory.length" class="ai-hist">
              <div class="ai-hist-head">
                <span class="ai-hist-label">历史</span>
                <button type="button" class="ai-hist-clear" @click="clearHistory('ai_parse_history', 'parse')">清空</button>
              </div>
              <div class="ai-hist-chips">
                <span v-for="(h, i) in parseHistory" :key="i" class="ai-hist-item">
                  <span class="ai-hist-text" @click="useHistory('parse', h)">{{ h }}</span>
                  <button type="button" class="ai-hist-del" title="删除" @click="removeHistory('ai_parse_history', i, 'parse')">×</button>
                </span>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" :disabled="parse.loading" @click="runParse">{{ parse.loading ? '解析中…' : '解析' }}</button>
          <div class="ai-out">
            <div v-if="parse.loading" class="ai-loading">解析中…</div>
            <template v-else-if="parsed">
              <div class="ai-preview-card">
                <div class="ai-pc-head">
                  <strong class="ai-pc-type">{{ parsed.leave_type || '请先选择假种，我来推荐' }}</strong>
                  <span v-if="confidenceText" class="ai-conf" :class="confidenceClass">置信度 {{ confidenceText }}</span>
                </div>
                <div class="ai-pc-rows">
                  <div v-if="parsed.start_date" class="ai-pc-row"><span>开始</span><strong>{{ parsed.start_date }}</strong></div>
                  <div v-if="parsed.end_date" class="ai-pc-row"><span>结束</span><strong>{{ parsed.end_date }}</strong></div>
                  <div v-if="parsed.days != null" class="ai-pc-row"><span>天数</span><strong>{{ parsed.days }}</strong></div>
                </div>
                <div v-if="parsed.reason" class="ai-pc-row">
                  <span>事由</span><strong>{{ parsed.reason }}</strong>
                </div>
                <div v-if="parsed.reason_valid === '不合理'" class="ai-confirm-warn">
                  事由不合理：{{ parsed.reason_note || '请补充具体说明' }}
                </div>
                <div v-else-if="parsed.reason_valid === '存疑'" class="ai-confirm-warn" style="background:#fff4e5;color:#b56908">
                  事由存疑：{{ parsed.reason_note || '请确认或补充' }}
                </div>
                <div v-if="parsed.emergency_report || parsed.pending_material" class="ai-pc-flags">
                  <span v-if="parsed.emergency_report" class="ai-flag">突发情况报备</span>
                  <span v-if="parsed.pending_material" class="ai-flag">证明材料待补交</span>
                </div>
                <div v-if="parsed.llm_fallback" class="ai-fallback">⚠ LLM 失败，已回退规则版</div>
              </div>
              <div v-if="parsed.guidance" class="ai-guide">{{ parsed.guidance }}</div>
              <div v-if="parsed.options && parsed.options.length" style="margin-top:10px">
                <button v-for="(o, i) in parsed.options" :key="i" type="button"
                        class="btn" :class="o.primary ? 'ai-opt-primary' : 'ai-opt-alt'"
                        @click="chooseOption(o.leave_type)">
                  {{ o.primary ? '✓ ' : '' }}{{ o.leave_type }}{{ o.primary ? ' · 去填写' : '' }}
                </button>
              </div>
              <div v-if="needConfirm" class="ai-confirm-warn">识别信息需人工确认，请核对无误</div>
              <label v-if="needConfirm" class="ai-confirm-check">
                <input type="checkbox" v-model="confirmChecked"> 我已确认信息无误
              </label>
              <button v-if="canSubmit" class="btn btn-primary" style="margin-top:10px" @click="submitLeave">
                一键发起请假（无需附件）
              </button>
              <div v-if="parsed.follow_up" class="hint" style="margin-top:6px">{{ parsed.follow_up }}</div>
              <div v-if="parsed.suggestion" class="ai-guide" style="margin-top:10px" v-html="suggestionHtml"></div>
            </template>
          </div>
        </div>

        <!-- 审批智能校验 / 我的申请预审 -->
        <div class="ai-card">
          <h3>{{ isApprover ? '审批智能校验' : '我的申请预审' }}</h3>
          <div class="ai-req-list">
            <div v-for="x in reqs" :key="x.id" class="ai-req-item" :class="{'ai-req-overdue': x.overdue}">
              <div class="ai-req-info">
                <strong>{{ x.request_no }}</strong> · {{ x.leave_type }}<template v-if="x.name"> · {{ x.name }}</template>
              </div>
              <div>
                <span v-if="x.overdue" class="ai-badge danger">超时</span>
                <span v-if="x.status === 'supplement_required' || x.status === 'returned'" class="ai-badge warn">{{ labels[x.status] || x.status }}</span>
                <span v-else class="ai-badge">{{ labels[x.status] || x.status }}</span>
              </div>
              <button type="button" class="btn btn-primary ai-req-go" @click="reviewRequest(x.id)">预审</button>
            </div>
            <div v-if="!reqs.length" class="hint">暂无待处理申请</div>
          </div>
          <button v-if="isApprover" class="btn btn-primary" style="margin-top:8px" @click="runBatch">
            {{ batch.loading ? '批量预审中…' : '批量预审待办' }}
          </button>
          <div class="ai-out">
            <div v-if="review.loading" class="ai-loading">预审中…</div>
            <template v-else-if="review.result">
              <div class="ai-review-head">
                <span class="badge" :class="verdictClass(review.result.verdict)">{{ review.result.verdict }}</span>
                <span v-if="typeof review.result.score === 'number'" class="ai-conf ai-conf-mid">智能评分 {{ review.result.score }}</span>
                <span v-if="review.result.request_no" class="hint">{{ review.result.request_no }}</span>
              </div>
              <div v-if="review.result.applicant && review.result.applicant.name" class="ai-applicant">
                申请人：{{ review.result.applicant.name }} · {{ review.result.applicant.department || '综合管理部' }}
              </div>
              <div v-if="review.result.history_count != null" class="hint">同类假期已批准记录：{{ review.result.history_count }} 笔</div>
              <p>{{ review.result.summary }}</p>
              <div v-if="review.result.risk_details && review.result.risk_details.length" class="ai-risk-list">
                <div v-for="(r, i) in review.result.risk_details" :key="i" class="ai-risk-item">
                  <span class="ai-badge" :class="riskLevelClass(r.level)">{{ riskLevelText(r.level) }}</span>
                  <div><strong>{{ r.message }}</strong><small v-if="r.policy">{{ r.policy }}</small></div>
                </div>
              </div>
              <div v-if="review.result.suggested_action" class="ai-action-hint">建议操作：{{ review.result.suggested_action }}</div>
              <div v-if="review.result.comment_draft" class="ai-comment-box">
                <div class="ai-comment-title">审批意见草稿</div>
                <div>{{ review.result.comment_draft }}</div>
                <button type="button" class="btn btn-ghost" @click="copyComment(review.result.comment_draft)">复制意见</button>
              </div>
              <button v-if="review.result.request_id" type="button" class="btn btn-primary" @click="openDetail(review.result.request_id)">
                打开申请详情
              </button>
            </template>
            <template v-else-if="batch.result">
              <div class="hint">{{ batch.result.summary }}</div>
              <div v-for="x in batch.result.items" :key="x.request_id" class="ai-batch-item">
                <div class="ai-batch-head">
                  <span class="badge" :class="verdictClass(x.verdict)">{{ x.verdict }}</span>
                  <strong>{{ x.request_no }}</strong>
                  <span class="hint">{{ x.applicant && x.applicant.name }}</span>
                  <span class="ai-conf ai-conf-mid">评分 {{ x.score }}</span>
                </div>
                <p>{{ x.summary }}</p>
                <button type="button" class="btn btn-ghost" @click="reviewRequest(x.request_id)">查看完整预审</button>
              </div>
            </template>
          </div>
          <div class="hint">{{ statusLine }}</div>
          <button class="btn btn-ghost" @click="testLLM">测试大模型连接</button>
        </div>
      </div>`
  };
})(window);
