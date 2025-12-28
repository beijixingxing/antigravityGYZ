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
    claude_limit: 100,
    gemini3_limit: 200,
    rate_limit: 30,
    rate_limit_increment: 0,
    pool_round_robin: true
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

// Helper function to safely merge quota data with proper structure
const mergeQuotaData = (target: any, source: any) => {
  if (!source) return target;
  
  const result = { ...target };
  
  for (const level of ['newbie', 'contributor', 'v3_contributor']) {
    if (source[level] !== undefined) {
      // If source value is a number (legacy format), ignore it and keep the default structure
      if (typeof source[level] === 'number') {
        // Skip - we keep the existing structured format
        continue;
      }
      // If source value is an object with base/increment structure, merge it
      if (typeof source[level] === 'object' && source[level] !== null) {
        result[level] = {
          base: { ...result[level]?.base, ...source[level]?.base },
          increment: { ...result[level]?.increment, ...source[level]?.increment }
        };
      }
    }
  }
  
  return result;
};

const fetchSettings = async () => {
  try {
    // Fetch settings separately to handle individual failures
    const [settingsResult, agConfigResult, agStatsResult] = await Promise.allSettled([
      api.get('/admin/settings'),
      api.get('/antigravity/config'),
      api.get('/antigravity/stats')
    ]);
    
    // System Settings
    if (settingsResult.status === 'fulfilled') {
      const res = settingsResult.value;
      config.value.enable_registration = res.data?.enable_registration ?? true;
      // Use safe merge for quota to handle legacy format
      if (res.data?.quota) {
        config.value.quota = mergeQuotaData(config.value.quota, res.data.quota);
      }
      if (res.data?.rate_limit) config.value.rate_limit = { ...config.value.rate_limit, ...res.data.rate_limit };
    } else {
      console.error('Failed to fetch admin settings:', settingsResult.reason);
    }

    // Antigravity Settings
    if (agConfigResult.status === 'fulfilled') {
      const agRes = agConfigResult.value;
      if (agRes.data) {
        config.value.antigravity = { ...config.value.antigravity, ...agRes.data };
      }
    } else {
      console.error('Failed to fetch antigravity config:', agConfigResult.reason);
    }
    
    // Antigravity Stats
    if (agStatsResult.status === 'fulfilled') {
      const agStatsRes = agStatsResult.value;
      if (agStatsRes.data) {
        antigravityStats.value = agStatsRes.data;
      }
    } else {
      console.error('Failed to fetch antigravity stats:', agStatsResult.reason);
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
    // 保存成功后重新获取配置，确保前端显示最新数据
    await fetchSettings();
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

    <!-- Antigravity Row -->
    <div class="grid grid-cols-1 gap-3">
        <!-- Antigravity Settings -->
        <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 relative overflow-hidden shadow-[0_0_15px_rgba(139,92,246,0.1)]">
            <div class="absolute top-0 right-0 p-4 opacity-20 text-4xl drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]">🌌</div>
            <h3 class="font-bold text-lg bg-gradient-to-r from-blue-400 to-cyan-500 bg-clip-text text-transparent mb-4">反重力 (Antigravity)</h3>
            
            <div class="antigravity-container">
                <!-- Settings Grid Layout -->
                <div class="space-y-3 antigravity-right-panel">
                    <!-- Row 1: Token Mode + Rate Limits -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <!-- Token Mode Switch -->
                        <div class="flex items-center justify-between p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <div class="flex flex-col">
                                <span class="text-sm text-white font-medium">Token 计费模式</span>
                                <span class="text-xs text-[#94A3B8]">按Token数计算配额</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" v-model="config.antigravity.use_token_quota" class="sr-only peer">
                                <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-[#8B5CF6] peer-checked:to-[#4338CA]"></div>
                            </label>
                        </div>

                        <!-- Pool Round Robin Switch -->
                        <div class="flex items-center justify-between p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <div class="flex flex-col">
                                <span class="text-sm text-white font-medium">分池轮询</span>
                                <span class="text-xs text-[#94A3B8]">关闭则全部轮询</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" v-model="config.antigravity.pool_round_robin" class="sr-only peer">
                                <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-[#8B5CF6] peer-checked:to-[#4338CA]"></div>
                            </label>
                        </div>
                        
                        <!-- 初始速率 -->
                        <div class="flex items-center justify-between p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <div class="flex flex-col">
                                <label class="text-sm text-white font-medium">初始速率 (RPM)</label>
                                <span class="text-xs text-[#94A3B8]">未上传凭证</span>
                            </div>
                            <input type="number" v-model.number="config.antigravity.rate_limit" class="w-24 bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                        
                        <!-- 增量速率 -->
                        <div class="flex items-center justify-between p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <div class="flex flex-col">
                                <label class="text-sm text-white font-medium">增量速率 (RPM)</label>
                                <span class="text-xs text-[#94A3B8]">已上传凭证</span>
                            </div>
                            <input type="number" v-model.number="config.antigravity.rate_limit_increment" class="w-24 bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                    </div>

                    <!-- Row 2: Limits & Increments in 2x2 Grid -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <!-- Claude 限额 -->
                        <div class="flex flex-col gap-1 p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <label class="text-xs text-[#94A3B8]">Claude 限额</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.claude_token_quota" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.claude_limit" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                        
                        <!-- Gemini 3 限额 -->
                        <div class="flex flex-col gap-1 p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <label class="text-xs text-[#94A3B8]">Gemini 3 限额</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.gemini3_token_quota" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.gemini3_limit" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                        
                        <!-- Claude 增量 -->
                        <div class="flex flex-col gap-1 p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <label class="text-xs text-[#94A3B8]">Claude 增量</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_claude" min="0" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.increment_per_token_claude" min="0" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                        
                        <!-- Gemini 3 增量 -->
                        <div class="flex flex-col gap-1 p-3 bg-slate-700/30 rounded-xl border border-white/10 hover:bg-slate-700/40 transition-colors">
                            <label class="text-xs text-[#94A3B8]">Gemini 3 增量</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_gemini3" min="0" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.increment_per_token_gemini3" min="0" class="w-full bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-center font-bold text-white focus:border-cyan-400 outline-none transition">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Floating Action Bar -->
    <div class="sticky bottom-4 z-50 flex justify-end gap-4 p-4 rounded-2xl floating-bar-style backdrop-blur-md shadow-2xl transition-all duration-300 transform translate-y-0 opacity-100">
        <div v-if="message" class="flex items-center text-sm font-bold animate-pulse" :class="message.includes('失败') ? 'text-red-400' : 'text-green-400'">
            {{ message }}
        </div>
        <button
            @click="saveSettings"
            :disabled="isLoading"
            class="save-config-btn px-8 py-3 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <span v-if="isLoading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            {{ isLoading ? '保存中...' : '保存配置' }}
        </button>
    </div>
  </div>
</template>

<style scoped>
/* 反重力模块容器 - 紧凑布局 */
.antigravity-container {
  padding: 0; /* 移除额外内边距，由子元素控制 */
}

/* 右侧面板 */
.antigravity-right-panel {
  margin-top: 0;
}

/* 保存配置按钮样式 */
.save-config-btn {
  /* 背景：加深紫色渐变，增强对比度 */
  background: linear-gradient(90deg, #7c3aed, #8b5cf6);
  /* 边框：浅紫透明，增强融合感 */
  border: 1px solid rgba(167, 139, 250, 0.3);
  /* 文字：白色+加粗，与背景对比清晰 */
  color: #ffffff;
  font-weight: 600;
  /* 圆角：与站点其他按钮统一（建议8px） */
  border-radius: 8px;
  /* 阴影：轻微发光，突出可点击性 */
  box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.1), 0 0 8px rgba(139, 92, 246, 0.4);
  /* 交互：hover时亮度提升 */
  transition: all 0.2s ease;
}

.save-config-btn:hover {
  background: linear-gradient(90deg, #8b5cf6, #a78bfa);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.6);
}

.floating-bar-style {
  background: linear-gradient(135deg, #3a2270, #2d1b5a);
  border: 1px solid rgba(139, 92, 246, 0.2);
}
</style>
