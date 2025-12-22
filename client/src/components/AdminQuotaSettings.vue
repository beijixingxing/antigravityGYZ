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
    rate_limit_increment: 30
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

    <!-- Antigravity Row -->
    <div class="grid grid-cols-1 gap-3">
        <!-- Antigravity Settings -->
        <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 relative overflow-hidden shadow-[0_0_15px_rgba(139,92,246,0.1)]">
            <div class="absolute top-0 right-0 p-6 opacity-20 text-6xl drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]">🌌</div>
            <h3 class="font-bold text-xl bg-gradient-to-r from-blue-400 to-cyan-500 bg-clip-text text-transparent mb-6">反重力 (Antigravity)</h3>
            
            <div class="antigravity-container">
                <!-- Right Column: Settings -->
                <div class="space-y-6 antigravity-right-panel">
                    <!-- Token Mode Switch -->
                    <div class="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5 antigravity-setting-item">
                        <div class="flex flex-col">
                            <span class="text-sm text-white font-medium">Token 计费模式</span>
                            <span class="text-xs text-[#A5B4FC] opacity-60">按Token数计算配额</span>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" v-model="config.antigravity.use_token_quota" class="sr-only peer">
                            <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-[#8B5CF6] peer-checked:to-[#4338CA]"></div>
                        </label>
                    </div>

                    <!-- Limits -->
                    <div class="space-y-6">
                        <!-- 双状态速率设置 -->
                        <div class="space-y-3 antigravity-setting-item">
                            <div class="flex items-center gap-2">
                                <div class="w-3 h-3 rounded-full bg-cyan-500"></div>
                                <span class="text-sm font-medium text-cyan-300">双状态速率限制 (RPM)</span>
                            </div>
                            <div class="text-xs text-[#94A3B8] pl-5">
                                系统会根据用户是否上传有效凭证自动切换速率限制
                            </div>
                            
                            <!-- 初始速率 -->
                            <div class="pl-5 space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="flex flex-col">
                                        <label class="text-sm text-white font-medium">初始速率</label>
                                        <span class="text-xs text-[#94A3B8]">未上传有效凭证的用户</span>
                                    </div>
                                    <input type="number" v-model.number="config.antigravity.rate_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-cyan-500 outline-none transition">
                                </div>
                            </div>
                            
                            <!-- 增量速率 -->
                            <div class="pl-5 space-y-2 pt-3 border-t border-white/5">
                                <div class="flex items-center justify-between">
                                    <div class="flex flex-col">
                                        <label class="text-sm text-white font-medium">增量速率</label>
                                        <span class="text-xs text-[#94A3B8]">上传有效凭证的用户</span>
                                    </div>
                                    <input type="number" v-model.number="config.antigravity.rate_limit_increment" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-cyan-500 outline-none transition">
                                </div>
                                <div class="text-xs text-[#94A3B8] italic">
                                    凭证无效或被禁用时自动降级为初始速率
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <label class="text-sm text-[#94A3B8]">Claude 限额</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.claude_token_quota" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-blue-500 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.claude_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-blue-500 outline-none transition">
                        </div>
                        <div class="flex items-center justify-between">
                            <label class="text-sm text-[#94A3B8]">Gemini 3 限额</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.gemini3_token_quota" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-blue-500 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.gemini3_limit" class="w-32 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-base font-bold text-white focus:border-blue-500 outline-none transition">
                        </div>
                    </div>

                    <!-- Increments -->
                    <div class="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                        <div class="flex flex-col gap-2">
                            <label class="text-xs text-[#94A3B8]">Claude 增量</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_claude" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.increment_per_token_claude" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                        </div>
                        <div class="flex flex-col gap-2">
                            <label class="text-xs text-[#94A3B8]">Gemini 3 增量</label>
                            <input v-if="config.antigravity.use_token_quota" type="number" v-model.number="config.antigravity.increment_token_per_token_gemini3" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
                            <input v-else type="number" v-model.number="config.antigravity.increment_per_token_gemini3" min="0" class="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-right text-sm font-bold text-white focus:border-blue-500 outline-none transition">
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
/* 调整反重力模块父容器：自适应剩余内容高度，消除空白 */
.antigravity-container {
  height: auto !important;
  min-height: unset;
  padding: 16px; /* 统一内边距，与页面其他模块一致 */
}

/* 右侧模块上移，与左侧剩余内容顶部对齐 */
.antigravity-right-panel {
  margin-top: 0 !important;
}

/* 剩余配置项（如速率限制、Token计费）增加间距，提升呼吸感 */
.antigravity-setting-item {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(139, 92, 246, 0.1); /* 浅紫分隔线，增强层级 */
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
