<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { api } from '../utils/api';
import GaugeChart from './GaugeChart.vue';

const props = defineProps<{
    config?: any;
}>();

const users = ref<any[]>([]);
const pagination = ref({ page: 1, limit: 10, total: 0, total_pages: 1 });
const search = ref('');
const loading = ref(false);

// Modals
const showQuotaModal = ref(false);
const showPasswordModal = ref(false);
const showAgLimitModal = ref(false);
const selectedUser = ref<any>(null);
const newQuota = ref(0);
const newPassword = ref('');
const newAgClaudeLimit = ref<number>(0);
const newAgGeminiLimit = ref<number>(0);

const fetchUsers = async () => {
  loading.value = true;
  try {
    const res = await api.get('/admin/users', { 
      params: { 
        page: pagination.value.page, 
        limit: pagination.value.limit,
        search: search.value 
      } 
    });
    users.value = res.data.data;
    pagination.value = res.data.meta;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

watch(() => pagination.value.page, fetchUsers);

const handleSearch = () => {
    pagination.value.page = 1;
    fetchUsers();
};

const toggleUserStatus = async (user: any) => {
    if (!confirm(user.is_active ? '⚠️ 确定要禁用该用户吗？这将同时禁用其所有 API 密钥。' : '确定要启用该用户吗？')) return;
    
    try {
        await api.patch(`/admin/users/${user.id}/toggle`, { is_active: !user.is_active });
        user.is_active = !user.is_active;
    } catch (e: any) {
        alert('操作失败: ' + (e.response?.data?.error || e.message));
    }
};

const openQuotaModal = (user: any) => {
    selectedUser.value = user;
    newQuota.value = user.daily_limit;
    showQuotaModal.value = true;
};

const openAgLimitModal = (user: any) => {
    selectedUser.value = user;
    newAgClaudeLimit.value = Number(user.ag_claude_limit || 0);
    newAgGeminiLimit.value = Number(user.ag_gemini3_limit || 0);
    showAgLimitModal.value = true;
};

const confirmAgLimits = async () => {
    try {
        await api.patch(`/admin/users/${selectedUser.value.id}/antigravity-limits`, { 
            claude_limit: Number(newAgClaudeLimit.value), 
            gemini3_limit: Number(newAgGeminiLimit.value) 
        });
        selectedUser.value.ag_claude_limit = Number(newAgClaudeLimit.value);
        selectedUser.value.ag_gemini3_limit = Number(newAgGeminiLimit.value);
        showAgLimitModal.value = false;
    } catch (e: any) {
        alert('更新失败: ' + (e.response?.data?.error || e.message));
    }
};

const confirmQuota = async () => {
    try {
        await api.patch(`/admin/users/${selectedUser.value.id}/quota`, { daily_limit: Number(newQuota.value) });
        selectedUser.value.daily_limit = Number(newQuota.value);
        showQuotaModal.value = false;
    } catch (e) {
        alert('更新失败');
    }
};

const openPasswordModal = (user: any) => {
    selectedUser.value = user;
    newPassword.value = '';
    showPasswordModal.value = true;
};

const isTokenMode = computed(() => !!props.config?.antigravity?.use_token_quota);

const formatNumber = (num: number) => {
    if (!isTokenMode.value) return num;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num;
};

const confirmPasswordReset = async () => {
    if (newPassword.value.length < 6) return alert('密码至少6位');
    try {
        await api.post(`/admin/users/${selectedUser.value.id}/reset-password`, { password: newPassword.value });
        alert('密码重置成功 ✅');
        showPasswordModal.value = false;
    } catch (e) {
        alert('重置失败');
    }
};

onMounted(fetchUsers);
</script>

<template>
  <div class="space-y-4">
    <!-- Header & Search -->
    <div class="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/5 backdrop-blur-xl p-4 rounded-2xl border border-purple-500/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
        <h3 class="text-xl font-bold text-[#C4B5FD] flex items-center gap-2">
            <span>👥 用户管理</span>
            <span class="text-xs bg-white/10 text-white px-2 py-1 rounded-full border border-white/10">{{ pagination.total }}</span>
        </h3>
        <div class="relative w-full md:w-64">
            <input
                v-model="search"
                @keyup.enter="handleSearch"
                placeholder="🔍 搜索邮箱..."
                class="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 pl-10 text-sm text-white focus:outline-none focus:border-[#8B5CF6] transition-all placeholder-[#A5B4FC]/50"
            >
            <span class="absolute left-3 top-2.5 text-xs text-[#A5B4FC]">🔎</span>
        </div>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto bg-white/5 backdrop-blur-xl rounded-3xl border border-purple-500/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="text-[#A5B4FC] text-xs uppercase tracking-wider border-b border-white/10 bg-white/5">
            <th class="p-4 font-bold">用户</th>
            <th class="p-4 font-bold text-center">状态</th>
            <th class="p-4 font-bold">用量统计</th>
            <th class="p-4 font-bold text-center">Discord</th>
            <th class="p-4 font-bold text-right">操作</th>
          </tr>
        </thead>
        <tbody class="text-sm divide-y divide-white/5">
          <tr v-for="user in users" :key="user.id" class="hover:bg-white/5 transition-colors group hover:shadow-[0_0_15px_rgba(139,92,246,0.05)]">
            
            <!-- User Info -->
            <td class="p-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center overflow-hidden shadow-sm border border-white/10 shrink-0">
                        <div class="w-full h-full bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] flex items-center justify-center text-white font-bold text-sm">
                            {{ user.email.charAt(0).toUpperCase() }}
                        </div>
                    </div>
                    <div>
                        <div class="font-bold text-white flex items-center gap-2">
                            {{ user.username || user.discordUsername || user.email }}
                            
                            <!-- Role Badge -->
                            <div v-if="user.role === 'ADMIN'" class="group/role flex items-center">
                                <div class="flex items-center bg-yellow-500/20 text-yellow-300 rounded-full border border-yellow-500/30 transition-all duration-300 h-5 px-1.5 gap-0 hover:gap-1 hover:pr-2 md:gap-1 md:pr-2 cursor-help">
                                    <span class="text-[10px]">👑</span>
                                    <span class="text-[10px] font-bold whitespace-nowrap max-w-0 group-hover/role:max-w-[50px] md:max-w-[50px] overflow-hidden transition-all duration-300 opacity-0 group-hover/role:opacity-100 md:opacity-100">ADMIN</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-xs text-[#A5B4FC] font-mono mt-0.5 opacity-70">ID: {{ user.id }} • {{ new Date(user.created_at).toLocaleDateString() }}</div>
                    </div>
                </div>
            </td>


            <!-- Status -->
            <td class="p-4 text-center">
                <div class="flex justify-center">
                    <span v-if="user.is_active" class="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-emerald-500/30">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> 正常
                    </span>
                    <span v-else class="bg-rose-500/20 text-rose-400 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-rose-500/30">
                        🚫 已禁用
                    </span>
                </div>
            </td>

            <!-- Usage (Combined) -->
            <td class="p-4 w-80">
                <div class="flex flex-col gap-3">
                    <!-- Daily Usage -->
                    <div class="flex items-center gap-2 text-xs">
                        <span class="w-12 text-[#A5B4FC] font-bold">今日</span>
                        <div class="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                             <div class="h-full bg-gradient-to-r from-[#8B5CF6] to-[#4338CA]" :style="{ width: Math.min((user.today_used / (user.daily_limit || 1)) * 100, 100) + '%' }"></div>
                        </div>
                        <span class="text-white font-mono text-[10px]">
                            {{ user.today_used }} / {{ user.daily_limit }}
                        </span>
                    </div>
                    
                    <!-- Antigravity Usage -->
                    <div class="flex items-center gap-2 text-xs">
                        <span class="w-12 text-[#A5B4FC] font-bold">反重力</span>
                        <div class="flex flex-col gap-1 flex-1">
                            <div class="flex items-center gap-1">
                                <span class="text-[9px] text-blue-400 w-4">C</span>
                                <div class="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                    <div class="h-full bg-blue-400" :style="{ width: Math.min(((isTokenMode ? user.ag_claude_used_tokens : user.ag_claude_used_requests) / (isTokenMode ? user.ag_claude_token_limit : user.ag_claude_limit || 100)) * 100, 100) + '%' }"></div>
                                </div>
                                <span class="text-[9px] text-[#A5B4FC] font-mono">{{ formatNumber(isTokenMode ? user.ag_claude_used_tokens : user.ag_claude_used_requests) }}/{{ formatNumber(isTokenMode ? user.ag_claude_token_limit : user.ag_claude_limit || 100) }}</span>
                            </div>
                            <div class="flex items-center gap-1">
                                <span class="text-[9px] text-purple-400 w-4">G3</span>
                                <div class="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                    <div class="h-full bg-purple-400" :style="{ width: Math.min(((isTokenMode ? user.ag_gemini3_used_tokens : user.ag_gemini3_used_requests) / (isTokenMode ? user.ag_gemini3_token_limit : user.ag_gemini3_limit || 200)) * 100, 100) + '%' }"></div>
                                </div>
                                <span class="text-[9px] text-[#A5B4FC] font-mono">{{ formatNumber(isTokenMode ? user.ag_gemini3_used_tokens : user.ag_gemini3_used_requests) }}/{{ formatNumber(isTokenMode ? user.ag_gemini3_token_limit : user.ag_gemini3_limit || 200) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
            
            <!-- Discord Info (Combined) -->
            <td class="p-4 text-center">
                <div class="flex flex-col items-center gap-1" v-if="user.discordId">
                    <div class="flex items-center gap-2">
                        <div class="w-5 h-5 rounded-full overflow-hidden border border-white/20">
                            <img v-if="user.discordAvatar" :src="user.discordAvatar" class="w-full h-full object-cover" alt="Avatar">
                            <span v-else class="text-[8px] flex items-center justify-center h-full bg-white/10 text-white">?</span>
                        </div>
                        <span class="text-xs font-bold text-white">{{ user.discordUsername }}</span>
                    </div>
                    <span class="text-[10px] font-mono text-[#A5B4FC] opacity-60">{{ user.discordId }}</span>
                </div>
                <span v-else class="text-xs text-[#A5B4FC] opacity-50">未绑定</span>
            </td>

            <!-- Actions -->
            <td class="p-4 text-right">
                <div class="flex items-center justify-end gap-2">
                    <button @click="openAgLimitModal(user)" title="反重力模型限额" class="w-8 h-8 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 flex items-center justify-center transition-colors border border-purple-500/20">
                        🚀
                    </button>
                    <button @click="openQuotaModal(user)" title="修改额度" class="w-8 h-8 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 flex items-center justify-center transition-colors border border-indigo-500/20">
                        ⚖️
                    </button>
                    <button @click="openPasswordModal(user)" title="重置密码" class="w-8 h-8 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 flex items-center justify-center transition-colors border border-yellow-500/20">
                        🔑
                    </button>
                    <button @click="toggleUserStatus(user)" :title="user.is_active ? '禁用' : '启用'" class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-[#A5B4FC] flex items-center justify-center transition-colors text-lg border border-white/10">
                        {{ user.is_active ? '🛑' : '✅' }}
                    </button>
                </div>
            </td>

          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex justify-center mt-6 gap-2" v-if="pagination.total_pages > 1">
        <button
            @click="pagination.page--"
            :disabled="pagination.page === 1"
            class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold text-[#C4B5FD] shadow-sm"
        >
            ← 上一页
        </button>
        <span class="px-4 py-2 text-sm text-[#A5B4FC] font-mono">{{ pagination.page }} / {{ pagination.total_pages }}</span>
        <button
            @click="pagination.page++"
            :disabled="pagination.page === pagination.total_pages"
            class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold text-[#C4B5FD] shadow-sm"
        >
            下一页 →
        </button>
    </div>

    <!-- Quota Modal -->
    <div v-if="showQuotaModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white border border-gray-100 p-8 rounded-3xl w-full max-w-sm shadow-2xl" v-motion-pop>
            <h3 class="text-xl font-bold mb-6 text-gray-900">⚖️ 修改额度</h3>
            <p class="text-sm text-gray-500 mb-4">修改用户 <span class="font-mono text-gray-700">{{ selectedUser.email }}</span> 的每日请求限制。</p>
            <input type="number" v-model="newQuota" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-6 text-gray-900 font-mono text-xl text-center focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all">
            <div class="flex justify-end gap-3">
                <button @click="showQuotaModal = false" class="px-5 py-2 rounded-xl hover:bg-gray-100 text-sm text-gray-600">取消</button>
                <button @click="confirmQuota" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200">保存</button>
            </div>
        </div>
    </div>

    <!-- Antigravity Limits Modal -->
    <div v-if="showAgLimitModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white border border-gray-100 p-8 rounded-3xl w-full max-w-sm shadow-2xl" v-motion-pop>
            <h3 class="text-xl font-bold mb-6 text-gray-900">🚀 反重力模型限额</h3>
            <p class="text-sm text-gray-500 mb-4">为用户 <span class="font-mono text-gray-700">{{ selectedUser.email }}</span> 设置每日模型使用次数。</p>
            <div class="space-y-4">
                <div>
                    <label class="block text-xs text-gray-500 mb-1">Claude (每日次数)</label>
                    <input type="number" v-model.number="newAgClaudeLimit" min="0" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition-all">
                </div>
                <div>
                    <label class="block text-xs text-gray-500 mb-1">Gemini 3 (每日次数)</label>
                    <input type="number" v-model.number="newAgGeminiLimit" min="0" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition-all">
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button @click="showAgLimitModal = false" class="px-5 py-2 rounded-xl hover:bg-gray-100 text-sm text-gray-600">取消</button>
                <button @click="confirmAgLimits" class="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-200">保存</button>
            </div>
        </div>
    </div>

    <!-- Password Modal -->
    <div v-if="showPasswordModal" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white border border-gray-100 p-8 rounded-3xl w-full max-w-sm shadow-2xl" v-motion-pop>
            <h3 class="text-xl font-bold mb-6 text-gray-900">🔑 重置密码</h3>
            <p class="text-sm text-gray-500 mb-4">为用户 <span class="font-mono text-gray-700">{{ selectedUser.email }}</span> 设置新密码。</p>
            <input type="text" v-model="newPassword" placeholder="输入新密码..." class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-6 text-gray-900 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-100 transition-all">
            <div class="flex justify-end gap-3">
                <button @click="showPasswordModal = false" class="px-5 py-2 rounded-xl hover:bg-gray-100 text-sm text-gray-600">取消</button>
                <button @click="confirmPassword" class="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 text-white rounded-xl font-bold text-sm shadow-lg shadow-yellow-200">重置</button>
            </div>
        </div>
    </div>

  </div>
</template>
