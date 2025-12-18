<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../utils/api';

const config = ref({
  enable_registration: true,
  quota: {
    newbie: {
      base: { flash: 0, pro: 0, v3: 0 },
      increment: { flash: 0, pro: 0, v3: 0 }
    },
    contributor: {
      base: { flash: 0, pro: 0, v3: 0 },
      increment: { flash: 0, pro: 0, v3: 0 }
    },
    v3_contributor: {
      base: { flash: 0, pro: 0, v3: 0 },
      increment: { flash: 0, pro: 0, v3: 0 }
    }
  },
  rate_limit: {
    newbie: 0,
    contributor: 0,
    v3_contributor: 0
  },
  antigravity: {
    claude_limit: 0,
    gemini3_limit: 0,
    rate_limit: 0,
    use_token_quota: false,
    claude_token_quota: 0,
    gemini3_token_quota: 0,
    increment_per_token_claude: 0,
    increment_per_token_gemini3: 0,
    increment_token_per_token_claude: 0,
    increment_token_per_token_gemini3: 0
  }
});

const isLoading = ref(false);
const message = ref('');

const antigravityStats = ref<any>(null);

const formatNumber = (num: number) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
};

const fetchSettings = async () => {
  try {
    const [res, agRes, agStatsRes] = await Promise.all([
      api.get('/admin/settings'),
      api.get('/antigravity/config'),
      api.get('/antigravity/stats')
    ]);
    
    // System Settings
    config.value.enable_registration = res.data.enable_registration ?? true;
    if (res.data.quota) config.value.quota = { ...config.value.quota, ...res.data.quota };
    if (res.data.rate_limit) config.value.rate_limit = { ...config.value.rate_limit, ...res.data.rate_limit };

    // Antigravity Settings
    if (agRes.data) {
        config.value.antigravity = { ...config.value.antigravity, ...agRes.data };
    }
    
    // Antigravity Stats
    if (agStatsRes.data) {
        antigravityStats.value = agStatsRes.data;
    }
  } catch (e) {
    console.error('Failed to fetch settings', e);
  }
};

const emit = defineEmits(['saved']);

const saveSettings = async () => {
  isLoading.value = true;
  message.value = '';
  try {
    await Promise.all([
        api.post('/admin/settings', {
            enable_registration: config.value.enable_registration,
            quota: config.value.quota,
            rate_limit: config.value.rate_limit
        }),
        api.post('/antigravity/config', config.value.antigravity)
    ]);
    message.value = '配置已保存 ✅';
    emit('saved');
    setTimeout(() => message.value = '', 3000);
  } catch (e) {
    message.value = '保存失败 ❌';
  } finally {
    isLoading.value = false;
  }
};

defineExpose({ saveSettings, message });

onMounted(fetchSettings);
</script>

<template>
  <div class="space-y-6 text-white">
    
    <!-- Unified Quota Settings Card -->
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 relative overflow-hidden shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent flex items-center gap-2">
                <span>⚖️ 用户配额设置</span>
            </h3>
            <div class="text-xs text-[#94A3B8] bg-black/20 px-3 py-1 rounded-full border border-white/5">
                配置不同等级用户的每日额度与速率限制
            </div>
        </div>

        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="text-xs text-[#94A3B8] border-b border-white/10">
                        <th class="py-3 px-2 font-medium">等级 / 项目</th>
                        <th class="py-3 px-2 font-medium text-center w-24">Flash 基础</th>
                        <th class="py-3 px-2 font-medium text-center w-24">Pro 基础</th>
                        <th class="py-3 px-2 font-medium text-center w-24">V3 基础</th>
                        <th class="py-3 px-2 font-medium text-center w-24">速率 (RPM)</th>
                        <th class="py-3 px-2 font-medium text-center w-24 border-l border-white/10">Flash 增量</th>
                        <th class="py-3 px-2 font-medium text-center w-24">Pro 增量</th>
                        <th class="py-3 px-2 font-medium text-center w-24">V3 增量</th>
                    </tr>
                </thead>
                <tbody class="text-sm">
                    <!-- Newbie Row -->
                    <tr class="group hover:bg-white/5 transition-colors">
                        <td class="py-3 px-2 flex items-center gap-2">
                            <span class="text-lg">🌱</span>
                            <span class="font-bold text-green-400">萌新</span>
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.newbie.base.flash" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-green-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.newbie.base.pro" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-green-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.newbie.base.v3" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-green-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.rate_limit.newbie" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-green-500 outline-none transition">
                        </td>
                        <!-- Increments (Disabled/Hidden for Newbie) -->
                        <td class="py-2 px-1 text-center border-l border-white/10 opacity-30">-</td>
                        <td class="py-2 px-1 text-center opacity-30">-</td>
                        <td class="py-2 px-1 text-center opacity-30">-</td>
                    </tr>

                    <!-- Contributor Row -->
                    <tr class="group hover:bg-white/5 transition-colors border-t border-white/5">
                        <td class="py-3 px-2 flex items-center gap-2">
                            <span class="text-lg">👑</span>
                            <span class="font-bold text-yellow-400">大佬</span>
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.contributor.base.flash" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.contributor.base.pro" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.contributor.base.v3" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.rate_limit.contributor" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center border-l border-white/10">
                            <input type="number" v-model.number="config.quota.contributor.increment.flash" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.contributor.increment.pro" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.contributor.increment.v3" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-yellow-500 outline-none transition">
                        </td>
                    </tr>

                    <!-- V3 Contributor Row -->
                    <tr class="group hover:bg-white/5 transition-colors border-t border-white/5">
                        <td class="py-3 px-2 flex items-center gap-2">
                            <span class="text-lg">💎</span>
                            <span class="font-bold text-purple-400">至臻</span>
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.v3_contributor.base.flash" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.v3_contributor.base.pro" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.v3_contributor.base.v3" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.rate_limit.v3_contributor" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center border-l border-white/10">
                            <input type="number" v-model.number="config.quota.v3_contributor.increment.flash" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.v3_contributor.increment.pro" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                        <td class="py-2 px-1 text-center">
                            <input type="number" v-model.number="config.quota.v3_contributor.increment.v3" class="w-20 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-purple-500 outline-none transition">
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- Antigravity & Announcement Row -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Antigravity Settings -->
        <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 relative overflow-hidden shadow-[0_0_15px_rgba(139,92,246,0.1)] h-full flex flex-col justify-between">
            <div class="absolute top-0 right-0 p-3 opacity-20 text-4xl drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]">🌌</div>
            <h3 class="font-bold text-base bg-gradient-to-r from-blue-400 to-cyan-500 bg-clip-text text-transparent mb-3">反重力 (Antigravity)</h3>
            
            <div class="space-y-3">
                <!-- Stats Row (Split Layout) -->
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div class="bg-black/20 rounded-lg p-2 border border-white/5 flex flex-col justify-center">
                        <span class="text-[#94A3B8] scale-90 origin-left mb-1">有效账号数</span>
                        <span class="font-bold text-white text-lg">{{ antigravityStats?.meta?.active_accounts ?? antigravityStats?.meta?.active_tokens ?? 0 }}</span>
                    </div>
                    <div class="flex flex-col gap-1">
                        <div class="bg-blue-500/10 rounded-lg p-1.5 border border-blue-500/20 flex flex-col">
                            <span class="text-blue-300 scale-75 origin-left font-bold">Claude</span>
                            <div class="flex justify-between items-end">
                                <span class="text-blue-200 font-mono scale-90 origin-left">{{ config.antigravity.use_token_quota ? formatNumber(antigravityStats?.usage?.tokens?.claude) : antigravityStats?.usage?.requests?.claude }}</span>
                                <span class="text-white/30 scale-75 origin-right">/ {{ config.antigravity.use_token_quota ? formatNumber(antigravityStats?.capacity?.tokens?.claude) : antigravityStats?.capacity?.requests?.claude }}</span>
                            </div>
                        </div>
                        <div class="bg-purple-500/10 rounded-lg p-1.5 border border-purple-500/20 flex flex-col">
                            <span class="text-purple-300 scale-75 origin-left font-bold">Gemini 3</span>
                            <div class="flex justify-between items-end">
                                <span class="text-purple-200 font-mono scale-90 origin-left">{{ config.antigravity.use_token_quota ? formatNumber(antigravityStats?.usage?.tokens?.gemini3) : antigravityStats?.usage?.requests?.gemini3 }}</span>
                                <span class="text-white/30 scale-75 origin-right">/ {{ config.antigravity.use_token_quota ? formatNumber(antigravityStats?.capacity?.tokens?.gemini3) : antigravityStats?.capacity?.requests?.gemini3 }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Token Mode Switch -->
                <div class="flex items-center justify-between">
                    <div class="flex flex-col">
                        <span class="text-xs text-[#94A3B8]">Token 计费模式</span>
                        <span class="text-[10px] text-[#A5B4FC] opacity-50 scale-90 origin-left">按Token数计算配额</span>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer scale-75 origin-right">
                        <input type="checkbox" v-model="config.antigravity.use_token_quota" class="sr-only peer">
                        <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-[#8B5CF6] peer-checked:to-[#4338CA]"></div>
                    </label>
                </div>

                <!-- Limits -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="text-xs text-[#94A3B8]">速率 (RPM)</label>
                        <input type="number" v-model.number="config.antigravity.rate_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-bold text-white focus:border-cyan-500 outline-none transition">
                    </div>
                    <div class="flex items-center justify-between">
                        <label class="text-xs text-[#94A3B8]">Claude 限额</label>
                        <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.claude_token_quota" class="w-32 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                        <input v-else type="number" v-model.number="config.antigravity.claude_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                    </div>
                    <div class="flex items-center justify-between">
                        <label class="text-xs text-[#94A3B8]">Gemini 3 限额</label>
                        <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.gemini3_token_quota" class="w-32 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                        <input v-else type="number" v-model.number="config.antigravity.gemini3_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                    </div>
                </div>

                <!-- Increments (New Section) -->
                <div class="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] text-[#94A3B8] scale-90 origin-left">Claude 增量</label>
                        <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_claude" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-xs font-bold text-white focus:border-blue-500 outline-none transition">
                        <input v-else type="number" v-model.number="config.antigravity.increment_per_token_claude" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-xs font-bold text-white focus:border-blue-500 outline-none transition">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] text-[#94A3B8] scale-90 origin-left">Gemini 3 增量</label>
                        <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_gemini3" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-xs font-bold text-white focus:border-blue-500 outline-none transition">
                        <input v-else type="number" v-model.number="config.antigravity.increment_per_token_gemini3" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-right text-xs font-bold text-white focus:border-blue-500 outline-none transition">
                    </div>
                </div>
            </div>
        </div>

    </div>
    
    <!-- Save Config Button -->
    <div class="flex justify-end items-center gap-4 pt-4 border-t border-white/10">
        <span v-if="message" class="text-sm font-bold animate-pulse" :class="message.includes('失败') ? 'text-red-400' : 'text-green-400'">
            {{ message }}
        </span>
        <button
            @click="saveSettings"
            :disabled="isLoading"
            class="px-8 py-3 bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] hover:opacity-90 text-white font-bold rounded-full shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50 hover:scale-105 hover:shadow-[0_0_20px_rgba(139,92,246,0.5)] duration-300"
        >
            <span v-if="isLoading" class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
            {{ isLoading ? '保存中...' : '保存配置' }}
        </button>
    </div>
  </div>
</template>

<style scoped>
/* Hide spin buttons for input type number */
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type=number] {
  -moz-appearance: textfield;
}
</style>
