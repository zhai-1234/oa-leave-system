/* 智审 OA · Vue 应用引导与路由 */
(function (window) {
  'use strict';

  var Vue = window.Vue;
  var VueRouter = window.VueRouter;
  var VP = window.VP;
  var C = VP.components;

  var routes = [
    { path: '/login', name: 'login', component: C.LoginView, meta: { public: true } },
    { path: '/enter', name: 'enter', component: { template: '<div></div>' } },
    { path: '/detail', name: 'detail', component: C.DetailOnlyView, props: function (route) { return { id: route.query.id }; } },
    {
      path: '/', component: C.AppShell,
      children: [
        { path: 'home', component: C.HomeView, meta: { page: 'home' } },
        { path: 'apply', component: C.ApplyView, meta: { page: 'apply' } },
        { path: 'profile', component: C.ProfileView, meta: { page: 'profile' } },
        { path: 'records', component: C.RecordsView, meta: { page: 'records' } },
        { path: 'guide', component: C.GuideView, meta: { page: 'guide' } },
        { path: 'notifications', component: C.NotificationsView, meta: { page: 'notifications' } },
        { path: 'requests/:id', component: C.EmployeeDetailView, props: true, meta: { page: 'records' } },
        { path: 'admin', component: C.AdminView, props: { mode: 'admin' }, meta: { page: 'admin' } },
        { path: 'history', component: C.AdminView, props: { mode: 'history' }, meta: { page: 'history' } },
        { path: 'admin/requests/:id', component: C.AdminDetailView, props: function (route) { return { id: route.params.id, all: '' }; }, meta: { page: 'admin' } },
        { path: 'history/requests/:id', component: C.AdminDetailView, props: function (route) { return { id: route.params.id, all: '1' }; }, meta: { page: 'history' } },
        { path: 'adjustments', component: C.AdjustmentsView, meta: { page: 'adjustments' } },
        { path: 'hr', component: C.HrView, meta: { page: 'hr' } },
        { path: 'delegation', component: C.DelegationView, meta: { page: 'delegation' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/enter' }
  ];

  var router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes: routes
  });

  /* 登录守卫：未登录先尝试恢复会话，失败则回到登录页 */
  router.beforeEach(async function (to) {
    if (to.path === '/login') { return true; }
    if (!VP.store.me) {
      try {
        await VP.loadSession();
        VP.startNotifyTimer();
      } catch (e) {
        return '/login';
      }
    }
    if (to.path === '/enter') {
      return VP.isApprover() ? '/admin' : '/home';
    }
    var page = to.meta && to.meta.page;
    if (page === 'hr' && !VP.isHrOrAdmin()) {
      return '/enter';
    }
    if (['admin', 'adjustments', 'history', 'delegation', 'hr'].indexOf(page) >= 0 && !VP.isApprover()) {
      return '/home';
    }
    return true;
  });

  /* 顶栏标题与副标题 */
  router.afterEach(function (to) {
    var page = to.meta && to.meta.page;
    VP.store.page = page || '';
    var meta = page ? VP.pageMeta[page] : null;
    if (page === 'history' && VP.isAdmin()) {
      meta = ['全部请假记录', '查看公司全部请假申请与审批结果'];
    }
    if (meta) {
      VP.store.title = meta[0];
      VP.store.subtitle = meta[1];
    }
  });

  /* 注意：Vue 3 的全局组件注册在 app 实例上（Vue.component 不存在） */
  var app = Vue.createApp({
    template: '<router-view></router-view>'
  });

  Object.keys(C).forEach(function (name) {
    app.component(name, C[name]);
  });

  app.use(router);

  /* 深链兼容：/index.html?request=12 → 详情独立页 */
  var requestId = new URLSearchParams(location.search).get('request');
  if (requestId) {
    router.replace({ path: '/detail', query: { id: requestId } });
  } else {
    router.replace('/login');
  }

  app.mount('#app');
})(window);
