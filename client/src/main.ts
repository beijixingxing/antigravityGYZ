import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { MotionPlugin } from '@vueuse/motion';
import App from './App.vue';
import LoginView from './views/LoginView.vue';
import NewDashboard from './views/NewDashboard.vue';

// Router Setup
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginView },
    { path: '/dashboard', component: NewDashboard, meta: { requiresAuth: true } }
  ]
});

// Auth Guard
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else {
    next();
  }
});

createApp(App)
  .use(router)
  .use(MotionPlugin)
  .mount('#app');