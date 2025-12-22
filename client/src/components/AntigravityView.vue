<template>
  <div class="antigravity-container relative min-h-[600px] md:min-h-[800px] overflow-hidden rounded-[30px] md:rounded-[40px]">
    
    <!-- Cosmic Background -->
    <div class="absolute inset-0 bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 overflow-hidden">
      <div v-for="i in 50" :key="'star-'+i" class="star absolute rounded-full bg-white" :style="starStyle(i)"></div>
      <div class="meteor meteor-1"></div>
      <div class="meteor meteor-2"></div>
      <div class="meteor meteor-3"></div>
      <div class="nebula nebula-1"></div>
      <div class="nebula nebula-2"></div>
      <div class="orbit orbit-1"></div>
      <div class="orbit orbit-2"></div>
    </div>

    <!-- Content -->
    <div class="relative z-10 p-4 md:p-8 space-y-6 md:space-y-8">
      
      <!-- Title -->
      <div class="text-center mb-6 md:mb-10">
        <h2 class="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 mb-2 md:mb-3 animate-pulse-slow">
          &#128640; Antigravity
        </h2>
        <p class="text-purple-300/70 text-sm md:text-base">支持模型：Claude Opus 4.5, Gemini 3.0 Pro, Claude Sonnet 4.5</p>
      </div>

      <!-- Usage Dashboard removed -->

      <!-- OAuth Card -->
      <div id="oauth-card" class="glow-card bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl md:rounded-3xl overflow-hidden transition-all duration-500 group">
        <div
          @click="isOAuthExpanded = !isOAuthExpanded"
          class="p-5 md:p-8 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div class="flex flex-col md:flex-row md:items-center gap-4">
            <div>
              <h3 class="text-xl md:text-2xl font-black text-white flex items-center gap-2 md:gap-3">
                <span class="text-2xl md:text-3xl animate-bounce-slow">&#128274;</span>
                <span class="neon-text">获取授权凭证</span>
              </h3>
              <p class="text-purple-300/60 text-xs md:text-sm mt-1 md:mt-2">通过 Google OAuth 授权获取反重力渠道访问凭证</p>
            </div>
          </div>
          <button class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white transition-transform duration-300"
            :class="{ 'rotate-180': isOAuthExpanded }">
            &#9660;
          </button>
        </div>

        <!-- Steps -->
        <div v-show="isOAuthExpanded" class="px-5 md:px-8 pb-5 md:pb-8 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 border-t border-purple-500/20 pt-6">
          <!-- Step 1 -->
          <div class="step-card bg-gradient-to-br from-purple-900/50 to-indigo-900/50 border border-purple-500/20 rounded-xl md:rounded-2xl p-4 md:p-6">
            <div class="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
              <span class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-sm md:text-base pulse-ring">1</span>
              <span class="text-white font-bold text-sm md:text-base">获取授权链接</span>
            </div>
            <button @click="getOAuthUrl" :disabled="loadingUrl"
              class="w-full py-3 md:py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-sm md:text-base hover:from-purple-500 hover:to-pink-500 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-purple-500/30 neon-button">
              <span v-if="loadingUrl" class="flex items-center justify-center gap-2">
                <span class="animate-spin">&#9881;</span> 加载中...
              </span>
              <span v-else class="flex items-center justify-center gap-2">
                &#128279; 点击获取授权链接
              </span>
            </button>

            <div v-if="oauthUrl" class="mt-3 md:mt-4 p-3 md:p-4 bg-black/40 rounded-xl border border-purple-500/30 break-all">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-purple-300/70">授权链接已生成</span>
                <button @click="copyUrl" class="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                  {{ copied ? '已复制' : '复制' }}
                </button>
              </div>
              <a :href="oauthUrl" target="_blank" class="text-xs md:text-sm text-cyan-400 hover:text-cyan-300 underline transition-colors">
                👉 点击此链接打开授权页面
              </a>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="step-card bg-gradient-to-br from-indigo-900/50 to-cyan-900/50 border border-cyan-500/20 rounded-xl md:rounded-2xl p-4 md:p-6 space-y-4">
            <div>
              <div class="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                <span class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-cyan-500 flex items-center justify-center text-white font-bold text-sm md:text-base pulse-ring-cyan">2</span>
                <span class="text-white font-bold text-sm md:text-base">提交授权码</span>
              </div>
              <div class="mb-2 text-xs text-cyan-200/80 leading-relaxed break-words">
                请在完成Google授权后, 从打开的显示无法访问的页面的地址栏中完整复制整个网址并粘贴到下方。
              </div>
              <textarea v-model="authCode" rows="3" placeholder="粘贴完整网址..."
                class="w-full px-4 py-3 rounded-xl bg-black/40 border border-cyan-500/30 text-white placeholder-white/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 outline-none transition-all text-xs resize-none"></textarea>
              <div class="mt-2 flex items-center gap-2 text-white/70 text-xs md:text-sm">
                <input type="checkbox" id="skipProjectId" v-model="skipProjectId" class="rounded border-cyan-500/30 bg-black/40 text-cyan-500 focus:ring-cyan-500/50">
                <label for="skipProjectId" class="cursor-pointer hover:text-cyan-300 transition-colors">如果是家庭共享账号，请勾选此项以跳过 Project ID 认证</label>
              </div>
              <button @click="submitAuthCode" :disabled="!authCode || submitting"
                class="w-full mt-3 md:mt-4 py-3 md:py-4 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold text-sm md:text-base hover:from-cyan-500 hover:to-teal-500 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/30 neon-button-cyan">
                <span v-if="submitting && uploadMode==='oauth'" class="flex items-center justify-center gap-2">
                  <span class="animate-spin">&#9881;</span> 验证中...
                </span>
                <span v-else class="flex items-center justify-center gap-2">
                  &#10024; 提交授权码
                </span>
              </button>
            </div>

            <div class="pt-3 border-t border-cyan-500/20 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-white font-bold text-xs md:text-sm flex items-center gap-2">
                  <span class="text-base md:text-lg">&#128190;</span> 本地 JSON 凭证上传
                </span>
                <span class="text-[10px] md:text-xs text-cyan-200/70">用于已导出 OAuth JSON 的账号</span>
              </div>
              <div class="flex flex-col md:flex-row md:items-center gap-2">
                <input
                  ref="fileInput"
                  type="file"
                  accept=".json,application/json"
                  class="block w-full text-xs md:text-sm text-cyan-100 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs md:file:text-sm file:font-semibold file:bg-cyan-500/20 file:text-cyan-100 hover:file:bg-cyan-500/30 cursor-pointer bg-black/30 rounded-lg border border-cyan-500/30"
                  @change="handleFileChange"
                >
                <button
                  @click="uploadLocalCredential"
                  :disabled="!localJsonContent || submitting"
                  class="flex-1 md:flex-none md:w-40 py-2.5 md:py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold text-xs md:text-sm hover:from-emerald-400 hover:to-cyan-400 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30"
                >
                  <span v-if="submitting && uploadMode==='local'" class="flex items-center justify-center gap-2">
                    <span class="animate-spin">&#9881;</span> 上传中...
                  </span>
                  <span v-else class="flex items-center justify-center gap-2">
                    &#128640; 上传本地凭证
                  </span>
                </button>
              </div>
              <div v-if="localFileName" class="text-[10px] md:text-xs text-cyan-200/80 truncate">
                已选择：{{ localFileName }}
              </div>
            </div>
          </div>

          <!-- Message -->
          <div v-if="message" class="col-span-1 md:col-span-2 mt-2 p-3 md:p-4 rounded-xl text-center text-sm md:text-base font-bold animate-fade-in"
               :class="messageType === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'">
            {{ message }}
          </div>
        </div>
      </div>

      <!-- 我的凭证 -->
      <div class="glow-card bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl md:rounded-3xl p-5 md:p-8">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg md:text-xl font-black text-white flex items-center gap-2">
            <span class="text-xl md:text-2xl">&#128100;</span> 我的凭证
          </h3>
          <div class="flex items-center gap-2">
            <div class="text-xs text-purple-300/70">第 {{ page }} / {{ pageCount }} 页</div>
            <button @click="prevPage" :disabled="page<=1" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold"><</button>
            <button @click="nextPage" :disabled="page>=pageCount" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold">></button>
            <button @click="fetchMyTokens" class="px-3 py-2 bg-purple-600/50 hover:bg-purple-600/70 rounded-xl text-white text-xs md:text-sm font-bold transition-all flex items-center justify-center gap-2">
            <span :class="{ 'animate-spin': loadingMyTokens }">&#8635;</span> 刷新
            </button>
          </div>
        </div>
        <div v-if="myTokens.length === 0" class="text-purple-300/60 text-sm">暂无凭证</div>
        <div v-else class="space-y-3">
          <div v-for="t in myTokens" :key="t.id" class="stat-card bg-gradient-to-br from-purple-900/40 to-fuchsia-900/40 border border-purple-500/30 rounded-xl p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <div class="text-xs text-purple-300/70">#{{ t.id }}</div>
                <div class="text-sm text-white">{{ t.email || '未知邮箱' }}</div>
                <div class="text-xs">
                  <span v-if="t.status==='ACTIVE'" class="px-2 py-1 bg-green-500/20 text-green-400 rounded-full font-bold">活跃</span>
                  <span v-else-if="t.status==='COOLING'" class="px-2 py-1 bg-amber-500/20 text-amber-400 rounded-full font-bold">冷却中</span>
                  <span v-else class="px-2 py-1 bg-gray-500/20 text-gray-400 rounded-full font-bold">失效</span>
                  <span class="ml-2 px-2 py-1" :class="t.is_enabled ? 'bg-emerald-500/20 text-emerald-300 rounded-full' : 'bg-gray-500/20 text-gray-300 rounded-full'">
                    {{ t.is_enabled ? '已启用' : '已禁用' }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button @click="toggleMyToken(t)"
                  class="px-3 py-2 rounded-lg text-xs font-bold"
                  :class="t.is_enabled ? 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-300' : 'bg-green-500/20 hover:bg-green-500/40 text-green-300'">
                  {{ t.is_enabled ? '禁用' : '启用' }}
                </button>
                <button @click="deleteMyToken(t)" class="px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs font-bold">
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Admin Section -->
      <div v-if="isAdmin" class="space-y-6 md:space-y-8">
        
        <!-- Divider -->
        <div class="flex items-center gap-4">
          <div class="h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent flex-1"></div>
          <span class="text-purple-400/80 text-xs md:text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <span class="animate-pulse">&#128081;</span> 管理员控制台
          </span>
          <div class="h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent flex-1"></div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { api } from '@/utils/api';

const props = defineProps<{ isAdmin?: boolean; initialExpandOAuth?: boolean }>();
const isAdmin = computed(() => props.isAdmin ?? false);

const oauthUrl = ref('');
const oauthPort = ref<number | null>(null);
const authCode = ref('');
const loadingUrl = ref(false);
const submitting = ref(false);
const copied = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const skipProjectId = ref(false);
const isOAuthExpanded = ref(true);

watch(() => props.initialExpandOAuth, (newVal) => {
    if (newVal) {
        isOAuthExpanded.value = true;
        // Scroll to OAuth card
        setTimeout(() => {
            const el = document.getElementById('oauth-card');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
});

const uploadMode = ref<'oauth' | 'local'>('oauth');
const fileInput = ref<HTMLInputElement | null>(null);
const localJsonContent = ref('');
const localFileName = ref('');

const myTokens = ref<any[]>([]);
const loadingMyTokens = ref(false);
const page = ref(1);
const limit = ref(10);
const total = ref(0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

const stats = ref({ total: 0, active: 0, inactive: 0, total_capacity: 0, personal_max_usage: 0 });
// agStrictMode 和 togglingStrict 已移至【管理设置】页面

const starStyle = (i: number) => {
  const size = Math.random() * 3 + 1;
  return {
    width: `${size}px`,
    height: `${size}px`,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 3}s`,
    animationDuration: `${2 + Math.random() * 3}s`
  };
};

const getOAuthUrl = async () => {
  loadingUrl.value = true;
  message.value = '';
  try {
    const res = await api.get('/antigravity/oauth/url');
    oauthUrl.value = res.data.url;
    oauthPort.value = res.data.port;
  } catch (e: any) {
    message.value = ' 失败: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    loadingUrl.value = false;
  }
};

const copyUrl = async () => {
  try {
    await navigator.clipboard.writeText(oauthUrl.value);
    copied.value = true;
    setTimeout(() => copied.value = false, 2000);
  } catch (e) {
    const input = document.createElement('input');
    input.value = oauthUrl.value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    copied.value = true;
    setTimeout(() => copied.value = false, 2000);
  }
};

const submitAuthCode = async () => {
  if (!authCode.value) return;
  submitting.value = true;
  uploadMode.value = 'oauth';
  message.value = '';
  try {
    // Extract code and port from callback URL
    let code = authCode.value;
    let port = oauthPort.value;
    
    // If user pasted full URL, extract code and port
    if (authCode.value.includes('code=')) {
      try {
        const url = new URL(authCode.value);
        code = url.searchParams.get('code') || authCode.value;
        // Extract port from URL - use url.port directly or parse from origin
        const portMatch = url.origin.match(/:(\d+)/);
        const urlPort = url.port || (portMatch ? portMatch[1] : null);
        if (urlPort) port = parseInt(urlPort);
      } catch (e) {
        // Not a valid URL, use as-is
      }
    }
    
    if (!port) {
      message.value = 'Please get OAuth URL first';
      messageType.value = 'error';
      submitting.value = false;
      return;
    }
    
    const res = await api.post('/antigravity/oauth/exchange', { code, port, skip_project_id: skipProjectId.value });
    message.value = ' 添加成功！ ' + (res.data.token?.email ? '邮箱: ' + res.data.token.email : '');
    messageType.value = 'success';
    authCode.value = '';
    oauthUrl.value = '';
    fetchMyTokens();
  } catch (e: any) {
    message.value = 'Failed: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    submitting.value = false;
  }
};

const handleFileChange = async (e: Event) => {
  localJsonContent.value = '';
  localFileName.value = '';
  const target = e.target as HTMLInputElement;
  const file = target.files && target.files[0];
  if (!file) return;
  localFileName.value = file.name;
  try {
    const text = await file.text();
    localJsonContent.value = text;
  } catch (err: any) {
    message.value = '读取文件失败: ' + err.message;
    messageType.value = 'error';
  }
};

const uploadLocalCredential = async () => {
  if (!localJsonContent.value) return;
  submitting.value = true;
  uploadMode.value = 'local';
  message.value = '';
  try {
    const res = await api.post('/antigravity/upload-local', {
      json_content: localJsonContent.value,
      skip_project_id: skipProjectId.value
    });
    message.value = '🚀 反重力凭证上传成功！';
    messageType.value = 'success';
    localJsonContent.value = '';
    localFileName.value = '';
    if (fileInput.value) {
      fileInput.value.value = '';
    }
    // 刷新凭证列表
    fetchMyTokens();
  } catch (e: any) {
    message.value = '本地上传失败: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    submitting.value = false;
    uploadMode.value = 'oauth';
  }
};

const fetchMyTokens = async () => {
  loadingMyTokens.value = true;
  try {
    const res = await api.get('/antigravity/my-tokens', { params: { page: page.value, limit: limit.value } });
    myTokens.value = res.data.tokens || [];
    total.value = res.data.total || 0;
    // Auto-collapse if user has tokens
    if (myTokens.value.length > 0) {
        isOAuthExpanded.value = false;
    }
  } catch (e) {
  } finally {
    loadingMyTokens.value = false;
  }
};

const prevPage = () => { if (page.value > 1) { page.value -= 1; fetchMyTokens(); } };
const nextPage = () => { if (page.value < pageCount.value) { page.value += 1; fetchMyTokens(); } };

const toggleMyToken = async (t: any) => {
  try {
    await api.put(`/antigravity/my-tokens/${t.id}`, { is_enabled: !t.is_enabled });
    t.is_enabled = !t.is_enabled;
  } catch (e: any) {
    alert('操作失败: ' + (e.response?.data?.error || e.message));
  }
};

const deleteMyToken = async (t: any) => {
  const created = t.created_at ? new Date(t.created_at).toLocaleString() : '';
  const email = t.email || '未知邮箱';
  const msg = `确认删除凭证 #${t.id}
邮箱：${email}
创建时间：${created}
此操作不可恢复，继续吗？`;
  if (!confirm(msg)) return;
  try {
    await api.delete(`/antigravity/my-tokens/${t.id}`);
    fetchMyTokens();
  } catch (e: any) {
    alert('删除失败: ' + (e.response?.data?.error || e.message));
  }
};

onMounted(() => {
  fetchMyTokens();
});
</script>

<style scoped>
.star { animation: twinkle 3s infinite alternate; }
@keyframes twinkle { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }

.meteor { position: absolute; width: 2px; height: 80px; background: linear-gradient(to bottom, rgba(255,255,255,0.8), transparent); transform: rotate(45deg); animation: meteor 3s linear infinite; }
.meteor-1 { top: 10%; left: 20%; animation-delay: 0s; }
.meteor-2 { top: 30%; left: 60%; animation-delay: 1s; }
.meteor-3 { top: 5%; left: 80%; animation-delay: 2s; }
@keyframes meteor { 0% { transform: translateX(-100px) translateY(-100px) rotate(45deg); opacity: 1; } 70% { opacity: 1; } 100% { transform: translateX(300px) translateY(300px) rotate(45deg); opacity: 0; } }

.nebula { position: absolute; border-radius: 50%; filter: blur(60px); animation: nebula-drift 20s infinite alternate; }
.nebula-1 { width: 300px; height: 300px; background: radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent); top: -50px; right: -50px; }
.nebula-2 { width: 400px; height: 400px; background: radial-gradient(circle, rgba(236, 72, 153, 0.2), transparent); bottom: -100px; left: -100px; animation-delay: -10s; }
@keyframes nebula-drift { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(30px, 30px) scale(1.1); } }

.orbit { position: absolute; border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 50%; animation: orbit-rotate 30s linear infinite; }
.orbit-1 { width: 500px; height: 500px; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.orbit-2 { width: 700px; height: 700px; top: 50%; left: 50%; transform: translate(-50%, -50%); animation-direction: reverse; animation-duration: 40s; }
@keyframes orbit-rotate { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }

.glow-card { box-shadow: 0 0 30px rgba(139, 92, 246, 0.1), inset 0 0 30px rgba(139, 92, 246, 0.05); }
.glow-card:hover { box-shadow: 0 0 50px rgba(139, 92, 246, 0.2), inset 0 0 50px rgba(139, 92, 246, 0.1); }
.neon-text { text-shadow: 0 0 10px rgba(192, 132, 252, 0.8), 0 0 20px rgba(192, 132, 252, 0.5); }

.pulse-ring { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4); animation: pulse-ring 2s infinite; }
.pulse-ring-cyan { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); animation: pulse-ring-cyan 2s infinite; }
@keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(168, 85, 247, 0); } 100% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0); } }
@keyframes pulse-ring-cyan { 0% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(34, 211, 238, 0); } 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); } }

.neon-button { box-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
.neon-button:hover { box-shadow: 0 0 30px rgba(168, 85, 247, 0.6); }
.neon-button-cyan { box-shadow: 0 0 20px rgba(34, 211, 238, 0.4); }
.neon-button-cyan:hover { box-shadow: 0 0 30px rgba(34, 211, 238, 0.6); }

.stat-card { transition: all 0.3s ease; }
.stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
.animate-pulse-slow { animation: pulse 3s infinite; }
.animate-bounce-slow { animation: bounce 2s infinite; }
.animate-fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.step-card { transition: all 0.3s ease; }
.step-card:hover { transform: translateY(-3px); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); }
</style>
