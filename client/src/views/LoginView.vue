<template>
  <div class="min-h-screen flex items-center justify-center p-4 relative font-sans text-white">
    <AnimatedBackground />

    <!-- 装饰：漂浮的星星 (CSS动画) -->
    <div class="absolute top-20 left-20 text-yellow-300 opacity-60 animate-float hidden md:flex items-center justify-center w-12 h-12">
      <svg class="w-full h-full absolute" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.869 1.4-8.168-5.934-5.787 8.2-1.192z"/></svg>
      <span class="relative z-10 text-yellow-600 font-black text-xs transform rotate-12 select-none">芥</span>
    </div>
    <div class="absolute bottom-40 right-40 text-pink-300 opacity-50 animate-float animation-delay-2000 hidden md:flex items-center justify-center w-16 h-16">
      <svg class="w-full h-full absolute" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.869 1.4-8.168-5.934-5.787 8.2-1.192z"/></svg>
      <span class="relative z-10 text-pink-600 font-black text-sm -rotate-12 select-none">芥</span>
    </div>

    <div class="relative w-full max-w-[420px]"
         v-motion
         :initial="{ opacity: 0, y: 100 }"
         :enter="{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20 } }"
    >
      <div class="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-[40px] p-10 shadow-2xl relative overflow-hidden group">
        
        <div class="relative z-10 text-center">
          <h2 class="text-4xl font-black tracking-tight mb-2 text-yellow-300 drop-shadow-md">
            星星人民公益站
          </h2>
          <p class="text-white/70 text-lg font-medium mb-8">
            {{ isRegister ? '加入我们，共享算力 ☭' : '欢迎回来，同志 ✨' }}
          </p>

          <form class="space-y-5" @submit.prevent="handleSubmit">
            <div class="space-y-2">
              <input v-model="email" type="text" required 
                class="w-full px-6 py-4 bg-black/20 border border-white/10 rounded-full text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-pink-400/50 transition-all text-lg"
                placeholder="用户名">
            </div>
          <div class="space-y-2">
              <input v-model="password" type="password" required 
                class="w-full px-6 py-4 bg-black/20 border border-white/10 rounded-full text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-pink-400/50 transition-all text-lg"
                placeholder="密码">
              <div class="text-xs text-white/50 pl-2">{{ passwordStrength }}</div>
          </div>
            <div v-if="isRegister" class="space-y-2">
              <input v-model="confirmPassword" type="password" required 
                class="w-full px-6 py-4 bg-black/20 border border-white/10 rounded-full text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-pink-400/50 transition-all text-lg"
                placeholder="确认密码">
            </div>

            <button
              type="submit"
              class="w-full py-4 bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-400 hover:to-violet-500 text-white font-black text-xl rounded-full shadow-lg shadow-pink-500/30 flex items-center justify-center gap-2 transform transition-transform hover:scale-105 active:scale-95"
            >
              <span>{{ isRegister ? '立即注册' : '登 录' }}</span>
            </button>
            
            <div class="flex items-center gap-3 mt-3">
              <div class="flex-1 h-px bg-white/10"></div>
              <span class="text-xs text-white/50">或</span>
              <div class="flex-1 h-px bg-white/10"></div>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                @click="loginWithDiscordWeb"
                class="flex-1 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold rounded-l-full rounded-r-md flex items-center justify-center gap-2 transition-colors"
              >
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.446.864-.612 1.249a18.27 18.27 0 00-5.48 0 12.3 12.3 0 00-.62-1.249.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.033.027C1.6 9.046.955 13.58 1.017 18.063a.08.08 0 00.03.057 19.864 19.864 0 005.993 3.03.077.077 0 00.084-.03c.462-.63.874-1.295 1.23-1.994a.076.076 0 00-.041-.106 13.203 13.203 0 01-1.872-.918.077.077 0 01-.008-.126c.126-.095.252-.195.372-.296a.074.074 0 01.078-.01c3.928 1.789 8.17 1.789 12.062 0a.074.074 0 01.079.009c.12.101.245.201.372.296a.077.077 0 01-.006.126c-.6.35-1.225.66-1.873.918a.076.076 0 00-.04.107c.36.699.772 1.364 1.23 1.994a.077.077 0 00.084.03 19.868 19.868 0 005.993-3.03.077.077 0 00.03-.056c.1-6.599-1.116-11.103-4.696-13.667a.058.058 0 00-.033-.027zM8.02 15.304c-1.183 0-2.159-1.085-2.159-2.419 0-1.333.956-2.419 2.158-2.419 1.206 0 2.176 1.096 2.159 2.419 0 1.334-.956 2.419-2.158 2.419zm7.984 0c-1.183 0-2.159-1.085-2.159-2.419 0-1.333.956-2.419 2.159-2.419 1.206 0 2.176 1.096 2.159 2.419 0 1.334-.953 2.419-2.159 2.419z"/>
                </svg>
                <span>网页授权</span>
              </button>
              <button
                type="button"
                @click="loginWithDiscordApp"
                class="flex-1 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold rounded-r-full rounded-l-md flex items-center justify-center gap-2 transition-colors"
              >
                <span>App 授权</span>
              </button>
            </div>
          </form>

          <div class="mt-8 pt-6 border-t border-white/10">
            <button 
              @click="isRegister = !isRegister" 
              class="text-white/80 hover:text-white font-bold text-sm transition-colors"
            >
              {{ isRegister ? '已有账号？去登录' : '还没有账号？免费注册' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/utils/api';
import { useRouter } from 'vue-router';
import AnimatedBackground from '../components/AnimatedBackground.vue';

const isRegister = ref(false);
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const router = useRouter();

const passwordStrength = computed(() => {
  const p = password.value || '';
  let score = 0;
  if (p.length >= 8) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  if (score >= 3) return '密码强度：强';
  if (score === 2) return '密码强度：中';
  return '密码强度：弱';
});

const handleSubmit = async () => {
  console.log('Login/Register submitted');
  const endpoint = isRegister.value ? '/api/auth/register' : '/api/auth/login';
  try {
    if (isRegister.value && password.value !== confirmPassword.value) {
      alert('两次密码不一致');
      return;
    }
    console.log('Sending request to:', endpoint);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isRegister.value
        ? { username: email.value, password: password.value, confirmPassword: confirmPassword.value }
        : { username: email.value, password: password.value })
    });
    
    console.log('Response status:', res.status);
    const data = await res.json();
    console.log('Response data:', data);

    if (!res.ok) throw new Error(data.error || '请求失败');

    if (!isRegister.value) {
      console.log('Login successful, token:', data.token);
      sessionStorage.setItem('token', data.token);
      localStorage.setItem('token', data.token); // Also set in localStorage for router guard
      console.log('Redirecting to /dashboard');
      await router.push('/dashboard');
      console.log('Redirect called');
    } else {
      alert('注册成功！请登录。');
      isRegister.value = false;
    }
  } catch (err: any) {
    console.error('Login error:', err);
    alert(err.message);
  }
};

const openOAuth = (url: string) => {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = ua.includes('android');
  const isIOS = /iphone|ipad|ipod/.test(ua);
  if (isAndroid) {
    const noSchema = url.replace(/^https?:\/\//, '');
    const intent = `intent://${noSchema}#Intent;scheme=https;package=com.discord;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    location.href = intent;
    setTimeout(() => { location.href = url; }, 1200);
  } else {
    location.href = url;
  }
};

const loginWithDiscordWeb = async () => {
  try {
    const res = await api.get('/auth/discord/url', { params: { mode: 'login' } });
    const url = res.data?.url;
    if (!url) throw new Error('Discord OAuth 未配置');
    
    // Open popup
    const width = 600;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    const popup = window.open(url, 'Discord Login', `width=${width},height=${height},top=${top},left=${left}`);

    // Listen for message
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'discord-login-success' && event.data?.token) {
        window.removeEventListener('message', handleMessage);
        sessionStorage.setItem('token', event.data.token);
        localStorage.setItem('token', event.data.token);
        await router.push('/dashboard');
      }
    };
    window.addEventListener('message', handleMessage);

    // Check if popup closed manually
    const timer = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(timer);
        window.removeEventListener('message', handleMessage);
      }
    }, 1000);

  } catch (e: any) {
    alert(e.response?.data?.error || e.message);
  }
};

const loginWithDiscordApp = async () => {
  try {
    const res = await api.get('/auth/discord/url', { params: { mode: 'login' } });
    const url = res.data?.url;
    if (!url) throw new Error('Discord OAuth 未配置');
    openOAuth(url);
  } catch (e: any) {
    alert(e.response?.data?.error || e.message);
  }
};
</script>
