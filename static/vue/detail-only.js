/* 智审 OA · Vue 详情独立页（新标签打开） */
(function (window) {
  'use strict';
  var VP = window.VP = window.VP || {};
  var C = (VP.components = VP.components || {});

  C.DetailOnlyView = {
    name: 'DetailOnlyView',
    props: { id: { type: [String, Number], required: true } },
    computed: { isApprover: function () { return VP.isApprover(); } },
    mounted: function () { document.body.classList.add('detail-only'); },
    beforeUnmount: function () { document.body.classList.remove('detail-only'); },
    methods: {
      finish: function () {
        window.close();
        setTimeout(function () {
          location.replace(location.origin + location.pathname);
        }, 300);
      }
    },
    template: `
      <div>
        <div class="toolbar" style="padding:16px 20px 0">
          <button class="btn btn-ghost" @click="finish">返回</button>
          <span class="hint">完成查看后点击返回关闭本页</span>
        </div>
        <main class="page">
          <EmployeeDetailView v-if="!isApprover" :id="id"></EmployeeDetailView>
          <AdminDetailView v-else :id="id" all="1"></AdminDetailView>
        </main>
      </div>`
  };
})(window);
