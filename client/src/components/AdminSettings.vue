<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../utils/api';
const isSharedMode = ref(true);
const antigravityStrictMode = ref(false);
const forceDiscordBind = ref(false);
const gemini3OpenAccess = ref(false);
const isLoading = ref(false);
const message = ref('');

// Health Check
const healthCheckLoading = ref<'cli' | 'antigravity' | null>(null);
const healthCheckResult = ref<any>(null);

onMounted(async () => {
  await fetchSettings();
});

const fetchSettings = async () => {
  try {
    const res = await api.get('/admin/settings');
    isSharedMode.value = res.data.enable_cli_shared_mode ?? res.data.enable_shared_mode;
    antigravityStrictMode.value = !!res.data.antigravity_strict_mode;
    forceDiscordBind.value = !!res.data.force_discord_bind;
    gemini3OpenAccess.value = !!res.data.enable_gemini3_open_access;
  } catch (e) {
    console.error('Failed to fetch settings', e);
  }
};

const toggleMode = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    // Toggle the value
    const newValue = !isSharedMode.value;
    await api.post('/admin/settings', { enable_cli_shared_mode: newValue });
    isSharedMode.value = newValue;
    message.value = newValue ? '已开启 CLI 共享模式：所有用户可用 Cloud Code 渠道' : '已关闭 CLI 共享模式：仅上传 CLI 凭证用户可用 Cloud Code';
  } catch (e) {
    message.value = '设置更新失败';
  } finally {
    isLoading.value = false;
  }
};

const toggleAntigravityMode = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    const newValue = !antigravityStrictMode.value;
    await api.post('/admin/settings', { antigravity_strict_mode: newValue });
    antigravityStrictMode.value = newValue;
    message.value = newValue ? '反重力渠道已开启严格模式：仅上传 Token 用户可使用' : '反重力渠道已开启共享模式：所有用户均可使用';
  } catch (e) {
    message.value = '设置更新失败';
  } finally {
    isLoading.value = false;
  }
};

const toggleForceDiscordBind = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    const newValue = !forceDiscordBind.value;
    await api.post('/admin/settings', { force_discord_bind: newValue });
    forceDiscordBind.value = newValue;
    message.value = newValue ? '已开启强制 Discord 授权' : '已关闭强制 Discord 授权';
  } catch (e) {
    message.value = '设置更新失败';
  } finally {
    isLoading.value = false;
  }
};
const toggleGemini3OpenAccess = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    const newValue = !gemini3OpenAccess.value;
    await api.post('/admin/settings', { enable_gemini3_open_access: newValue });
    gemini3OpenAccess.value = newValue;
    message.value = newValue ? '已开放 3.0 系列（CLI）给无凭证/无3.0权限用户' : '已关闭 3.0 系列开放访问（CLI）';
  } catch (e) {
    message.value = '设置更新失败';
  } finally {
    isLoading.value = false;
  }
};

// Health Check Functions
const runCliHealthCheck = async () => {
  healthCheckLoading.value = 'cli';
  healthCheckResult.value = null;
  try {
    const res = await api.post('/admin/health-check/cli');
    healthCheckResult.value = { type: 'cli', ...res.data };
    message.value = `CLI 检活完成: 健康 ${res.data.healthy}, 失效 ${res.data.dead}`;
  } catch (e: any) {
    message.value = 'CLI 检活失败: ' + (e.response?.data?.error || e.message);
  } finally {
    healthCheckLoading.value = null;
  }
};

const runAntigravityHealthCheck = async () => {
  healthCheckLoading.value = 'antigravity';
  healthCheckResult.value = null;
  try {
    const res = await api.post('/antigravity/health-check');
    healthCheckResult.value = { type: 'antigravity', ...res.data };
    message.value = `反重力检活完成: 健康 ${res.data.healthy}, 失效 ${res.data.dead}`;
  } catch (e: any) {
    message.value = '反重力检活失败: ' + (e.response?.data?.error || e.message);
  } finally {
    healthCheckLoading.value = null;
  }
};

const enableDeadCli = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    const res = await api.post('/admin/credentials/enable-dead');
    healthCheckResult.value = { type: 'cli-enable', ...res.data };
    message.value = `已尝试启用失效：激活 ${res.data.activated}, 冷却 ${res.data.cooled}, 仍失效 ${res.data.still_dead}`;
  } catch (e: any) {
    message.value = '启用失效失败: ' + (e.response?.data?.error || e.message);
  } finally {
    isLoading.value = false;
  }
};

const checkDeadCli = async () => {
  healthCheckLoading.value = 'cli';
  healthCheckResult.value = null;
  try {
    const res = await api.post('/admin/health-check/cli-dead');
    healthCheckResult.value = { type: 'cli-dead', ...res.data };
    message.value = `按失效检活完成: 健康 ${res.data.healthy}, 失效 ${res.data.dead}`;
  } catch (e: any) {
    message.value = '按失效检活失败: ' + (e.response?.data?.error || e.message);
  } finally {
    healthCheckLoading.value = null;
  }
};

const enableDeadAntigravity = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    const res = await api.post('/antigravity/tokens/enable-dead');
    healthCheckResult.value = { type: 'ag-enable', ...res.data };
    message.value = `已尝试启用失效：激活 ${res.data.activated}, 冷却 ${res.data.cooled}, 仍失效 ${res.data.still_dead}`;
  } catch (e: any) {
    message.value = '启用失效失败: ' + (e.response?.data?.error || e.message);
  } finally {
    isLoading.value = false;
  }
};

const checkDeadAntigravity = async () => {
  healthCheckLoading.value = 'antigravity';
  healthCheckResult.value = null;
  try {
    const res = await api.post('/antigravity/health-check/dead');
    healthCheckResult.value = { type: 'ag-dead', ...res.data };
    message.value = `按失效检活完成: 健康 ${res.data.healthy}, 失效 ${res.data.dead}`;
  } catch (e: any) {
    message.value = '按失效检活失败: ' + (e.response?.data?.error || e.message);
  } finally {
    healthCheckLoading.value = null;
  }
};
</script>

<template>
  <div class="space-y-3">
    <!-- CLI/Cloud Code Mode Settings -->
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
                <h2 class="text-lg font-bold text-[#C4B5FD] flex items-center gap-2 whitespace-nowrap">
                    <span>☁️ CLI/Cloud Code</span>
                </h2>
                <div class="h-4 w-[1px] bg-white/10"></div>
                <div class="flex flex-col">
                    <h3 class="font-medium text-sm" :class="isSharedMode ? 'text-green-400' : 'text-orange-400'">
                        {{ isSharedMode ? '共享模式 (所有用户)' : '严格模式 (仅贡献者)' }}
                    </h3>
                    <p class="text-xs text-[#A5B4FC] opacity-60">
                        {{ isSharedMode
                            ? '允许所有注册用户使用 Cloud Code 凭证池'
                            : '仅允许上传凭证用户使用 Cloud Code' }}
                    </p>
                </div>
            </div>

            <button
                @click="toggleMode"
                :disabled="isLoading"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
                :class="isSharedMode ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-white/10'"
            >
                <span class="sr-only">切换模式</span>
                <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow"
                :class="isSharedMode ? 'translate-x-6' : 'translate-x-1'"
                />
            </button>
        </div>
        
        <p v-if="message" class="mt-2 text-xs font-medium text-[#C4B5FD] animate-pulse pl-1">
        {{ message }}
        </p>
    </div>

    <!-- Antigravity Mode Settings -->
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
                <h2 class="text-lg font-bold text-[#C4B5FD] flex items-center gap-2 whitespace-nowrap">
                    <span>🚀 反重力渠道</span>
                </h2>
                <div class="h-4 w-[1px] bg-white/10"></div>
                <div class="flex flex-col">
                    <h3 class="font-medium text-sm" :class="antigravityStrictMode ? 'text-orange-400' : 'text-green-400'">
                        {{ antigravityStrictMode ? '严格模式 (仅贡献者)' : '共享模式 (所有用户)' }}
                    </h3>
                    <p class="text-xs text-[#A5B4FC] opacity-60">
                        {{ antigravityStrictMode
                            ? '仅上传过 Antigravity Token 的用户可使用'
                            : '允许所有注册用户使用反重力渠道' }}
                    </p>
                </div>
            </div>

            <button
                @click="toggleAntigravityMode"
                :disabled="isLoading"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
                :class="!antigravityStrictMode ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-white/10'"
            >
                <span class="sr-only">切换反重力模式</span>
                <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow"
                :class="!antigravityStrictMode ? 'translate-x-6' : 'translate-x-1'"
                />
            </button>
        </div>
    </div>

    <!-- Force Discord Bind -->
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
                <h2 class="text-lg font-bold text-[#C4B5FD] flex items-center gap-2 whitespace-nowrap">
                    <span>🔒 强制授权</span>
                </h2>
                <div class="h-4 w-[1px] bg-white/10"></div>
                <div class="flex flex-col">
                    <h3 class="font-medium text-sm" :class="forceDiscordBind ? 'text-red-400' : 'text-[#A5B4FC]'">
                        {{ forceDiscordBind ? '已开启：未授权用户将被拦截' : '已关闭：不强制弹窗' }}
                    </h3>
                    <p class="text-xs text-[#A5B4FC] opacity-60">
                        开启后，普通用户首次进入控制台会强制弹出 Discord 授权提示
                    </p>
                </div>
            </div>

            <button
                @click="toggleForceDiscordBind"
                :disabled="isLoading"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
                :class="forceDiscordBind ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-white/10'"
            >
                <span class="sr-only">切换强制授权</span>
                <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow"
                :class="forceDiscordBind ? 'translate-x-6' : 'translate-x-1'"
                />
            </button>
        </div>
    </div>

    <!-- Health Check Section -->
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <div class="flex items-center gap-4 mb-4">
            <h2 class="text-lg font-bold text-[#C4B5FD] flex items-center gap-2 whitespace-nowrap">
                <span>🔍 凭证检活 & 访问开关</span>
            </h2>
            <div class="h-4 w-[1px] bg-white/10"></div>
            <p class="text-xs text-[#A5B4FC] opacity-60">验证所有凭证有效性；可开放 3.0 系列（CLI）给无凭证/无3.0权限用户</p>
        </div>
        
        <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <span class="text-xs text-[#A5B4FC]">3.0 系列开放（CLI）</span>
                <button
                    @click="toggleGemini3OpenAccess"
                    :disabled="isLoading"
                    class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
                    :class="gemini3OpenAccess ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-white/10'"
                >
                    <span class="sr-only">切换 3.0 系列开放</span>
                    <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow"
                    :class="gemini3OpenAccess ? 'translate-x-6' : 'translate-x-1'"
                    />
                </button>
            </div>
            <button
                @click="runCliHealthCheck"
                :disabled="healthCheckLoading !== null"
                class="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                <span v-if="healthCheckLoading === 'cli'" class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                {{ healthCheckLoading === 'cli' ? '检测中...' : '☁️ CLI 凭证检活' }}
            </button>
            <button
                @click="checkDeadCli"
                :disabled="healthCheckLoading !== null"
                class="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                {{ healthCheckLoading === 'cli' ? '检测中...' : '☁️ 按失效检活 (CLI)' }}
            </button>
            <button
                @click="enableDeadCli"
                :disabled="isLoading"
                class="px-4 py-2 bg-gradient-to-r from-indigo-500 to-blue-600 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                一键启用失效 (CLI)
            </button>
            
            <button
                @click="runAntigravityHealthCheck"
                :disabled="healthCheckLoading !== null"
                class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                <span v-if="healthCheckLoading === 'antigravity'" class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                {{ healthCheckLoading === 'antigravity' ? '检测中...' : '🚀 反重力检活' }}
            </button>
            <button
                @click="checkDeadAntigravity"
                :disabled="healthCheckLoading !== null"
                class="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                {{ healthCheckLoading === 'antigravity' ? '检测中...' : '🚀 按失效检活 (反重力)' }}
            </button>
            <button
                @click="enableDeadAntigravity"
                :disabled="isLoading"
                class="px-4 py-2 bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
            >
                一键启用失效 (反重力)
            </button>
        </div>
        
        <!-- Health Check Results -->
        <div v-if="healthCheckResult" class="mt-4 p-3 bg-black/20 rounded-xl">
            <div class="flex items-center gap-4 text-sm mb-2">
                <span class="text-white/70">总数: {{ healthCheckResult.total }}</span>
                <span class="text-green-400">健康: {{ healthCheckResult.healthy }}</span>
                <span class="text-red-400">失效: {{ healthCheckResult.dead }}</span>
                <span v-if="healthCheckResult.cooled" class="text-yellow-400">冷却: {{ healthCheckResult.cooled }}</span>
            </div>
            <div v-if="healthCheckResult.errors && healthCheckResult.errors.length > 0" class="text-xs text-red-300 space-y-1 max-h-32 overflow-y-auto">
                <div v-for="err in healthCheckResult.errors" :key="err.id" class="opacity-80">
                    #{{ err.id }} {{ err.email || 'unknown' }} - {{ err.error }}
                </div>
            </div>
        </div>
    </div>
  </div>
</template>
