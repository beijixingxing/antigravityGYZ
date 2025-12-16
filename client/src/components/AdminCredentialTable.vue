<template>
  <div class="flex flex-col h-full space-y-4">
    <!-- Toolbar -->
    <div class="flex items-center justify-between bg-white/5 backdrop-blur-xl p-3 rounded-2xl border border-purple-500/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
      <div class="flex items-center gap-4">
        <!-- Filter Dropdown -->
        <div class="relative group">
          <select v-model="filterStatus" @change="page=1; fetchCredentials()"
            class="appearance-none bg-black/20 border border-white/10 pl-4 pr-10 py-1.5 text-[#C4B5FD] font-bold text-sm focus:outline-none focus:border-[#8B5CF6] cursor-pointer hover:bg-white/5 rounded-lg transition-all">
            <option value="ALL">📋 全部状态</option>
            <option value="ACTIVE">🟢 只看活跃</option>
            <option value="DEAD">🔴 只看失效</option>
            <option value="COOLING">🟡 冷却中</option>
            <option value="DUPLICATE">🔁 重复邮箱</option>
          </select>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#A5B4FC]">▼</div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-xs font-bold text-[#A5B4FC] bg-white/5 px-3 py-1 rounded-full border border-white/10">TOTAL: <span class="text-white">{{ meta.total }}</span></span>
        <button @click="fetchCredentials" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-[#C4B5FD] transition-all hover:rotate-180 duration-500 hover:border-[#8B5CF6]/50 hover:shadow-[0_0_10px_rgba(139,92,246,0.2)]">
          ↻
        </button>
      </div>
    </div>
    
    <!-- Table / List -->
    <div class="overflow-x-auto bg-white/5 backdrop-blur-xl rounded-3xl border border-purple-500/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="text-left bg-white/5 border-b border-white/10">
            <th class="px-6 py-4 text-[10px] font-black text-[#A5B4FC] uppercase tracking-widest">凭证信息</th>
            <th class="px-6 py-4 text-[10px] font-black text-[#A5B4FC] uppercase tracking-widest hidden md:table-cell">上传者</th>
            <th class="px-6 py-4 text-[10px] font-black text-[#A5B4FC] uppercase tracking-widest">状态</th>
            <th class="px-6 py-4 text-[10px] font-black text-[#A5B4FC] uppercase tracking-widest hidden md:table-cell">健康度</th>
            <th class="px-6 py-4 text-right text-[10px] font-black text-[#A5B4FC] uppercase tracking-widest">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr v-if="credentials.length === 0">
              <td colspan="5" class="px-6 py-12 text-center">
                <div class="flex flex-col items-center text-[#A5B4FC]">
                  <span class="text-4xl mb-2">🍃</span>
                  <span class="font-medium">暂无相关数据</span>
                </div>
              </td>
          </tr>
          <tr v-for="cred in credentials" :key="cred.id"
              class="group hover:bg-white/5 transition-colors hover:shadow-[0_0_15px_rgba(139,92,246,0.05)]">
            
            <!-- ID & Name -->
            <td class="px-6 py-3">
              <div class="flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-black text-[#C4B5FD] bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">#{{ cred.id }}</span>
                  <span class="text-sm font-bold text-white truncate max-w-[150px]" :title="cred.name">{{ cred.name }}</span>
                </div>
                <div v-if="cred.google_email" class="mt-1 text-[11px] text-[#A5B4FC] font-mono truncate max-w-[220px] opacity-70">
                  {{ cred.google_email.substring(0, 4) }}...{{ cred.google_email.substring(cred.google_email.length - 10) }}
                </div>
              </div>
            </td>

            <!-- Owner -->
            <td class="px-6 py-3 hidden md:table-cell">
              <div class="flex items-center gap-2">
                <!-- Discord Avatar or Email Initial -->
                <img v-if="cred.owner_discord_avatar" 
                     :src="`https://cdn.discordapp.com/avatars/${cred.owner_discord_id}/${cred.owner_discord_avatar}.png?size=32`"
                     class="w-6 h-6 rounded-full border border-white/10 shadow-sm"
                     :alt="cred.owner_discord_username" />
                <div v-else class="w-6 h-6 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] flex items-center justify-center text-[10px] text-white font-bold border border-white/10 shadow-sm">
                  {{ cred.owner_email?.[0]?.toUpperCase() || '?' }}
                </div>
                <!-- Discord Name or Email -->
                <div class="flex flex-col">
                  <span v-if="cred.owner_discord_username" class="text-xs font-medium text-[#A5B4FC]">{{ cred.owner_discord_username }}</span>
                  <span class="text-[10px] text-[#A5B4FC]/60 font-mono" :class="{ 'text-xs text-[#A5B4FC]': !cred.owner_discord_username }">{{ cred.owner_email }}</span>
                  <span v-if="cred.owner_discord_id" class="text-[9px] text-[#A5B4FC]/40 font-mono">ID: {{ cred.owner_discord_id }}</span>
                </div>
              </div>
            </td>

            <!-- Status -->
            <td class="px-6 py-3">
              <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border shadow-sm"
                :class="{
                  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400': cred.status === 'ACTIVE',
                  'bg-amber-500/10 border-amber-500/20 text-amber-400': cred.status === 'COOLING',
                  'bg-rose-500/10 border-rose-500/20 text-rose-400': cred.status === 'DEAD',
                  'bg-slate-500/10 border-slate-500/20 text-slate-400': cred.status === 'VALIDATING'
                }">
                <span class="relative flex h-2 w-2">
                  <span v-if="cred.status === 'ACTIVE'" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2" :class="{
                    'bg-emerald-400': cred.status === 'ACTIVE',
                    'bg-amber-400': cred.status === 'COOLING',
                    'bg-rose-400': cred.status === 'DEAD',
                    'bg-slate-400': cred.status === 'VALIDATING'
                  }"></span>
                </span>
                <span class="text-[10px] font-black tracking-wider">
                    {{ cred.status === 'ACTIVE' ? '正常' : (cred.status === 'DEAD' ? '失效' : (cred.status === 'COOLING' ? '冷却' : '验证中')) }}
                </span>
              </div>
            </td>

            <!-- Error / Health -->
            <td class="px-6 py-3 hidden md:table-cell">
              <div v-if="cred.last_error" class="group/err relative flex items-center">
                <span class="text-xs font-bold text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 cursor-help truncate max-w-[120px]">
                  ⚠ {{ cred.last_error }}
                </span>
              </div>
              <div v-else class="text-xs text-emerald-400 font-bold flex items-center gap-1">
                <span class="text-lg">❤️</span> 健康 <span class="text-[#A5B4FC] font-normal opacity-70">({{ cred.fail_count }})</span>
              </div>
            </td>

            <!-- Actions -->
            <td class="px-6 py-3 text-right">
              <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <!-- Toggle -->
                <button
                  v-if="cred.status === 'DEAD'"
                  @click="toggleCredential(cred.id, true)"
                  class="w-8 h-8 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shadow-sm transition-colors"
                  title="激活恢复"
                >
                  ⚡
                </button>
                <button
                  v-else
                  @click="toggleCredential(cred.id, false)"
                  class="w-8 h-8 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 flex items-center justify-center shadow-sm transition-colors"
                  title="强制停用"
                >
                  ⏸
                </button>

                <!-- Delete -->
                <button
                  @click="deleteCredential(cred.id)"
                  class="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 flex items-center justify-center shadow-sm transition-colors"
                  title="彻底删除"
                >
                  🗑
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex justify-center mt-6 gap-2" v-if="meta.total_pages > 1">
      <button
        @click="changePage(-1)"
        :disabled="page <= 1"
        class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold text-[#C4B5FD] shadow-sm"
      >
        ← 上一页
      </button>
      <span class="px-4 py-2 text-sm text-[#A5B4FC] font-mono">
        PAGE {{ page }} / {{ meta.total_pages }}
      </span>
      <button
        @click="changePage(1)"
        :disabled="page >= meta.total_pages"
        class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold text-[#C4B5FD] shadow-sm"
      >
        下一页 →
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { api } from '@/utils/api'; 

interface Credential {
  id: number;
  name: string;
  owner_email: string;
  owner_discord_id?: string;
  owner_discord_username?: string;
  owner_discord_avatar?: string;
  google_email?: string;
  status: string;
  fail_count: number;
  last_validated: string;
  last_error: string | null;
}

const credentials = ref<Credential[]>([]);
const page = ref(1);
const filterStatus = ref('ALL');
const meta = reactive({ total: 0, total_pages: 1, limit: 10 });

const fetchCredentials = async () => {
  try {
    const res = await api.get('/admin/credentials', {
      params: {
        page: page.value,
        limit: 10,
        status: filterStatus.value
      }
    });
    credentials.value = res.data.data;
    Object.assign(meta, res.data.meta);
  } catch (err) {
    console.error('Failed to fetch credentials', err);
  }
};

const changePage = (delta: number) => {
  page.value += delta;
  fetchCredentials();
};

const toggleCredential = async (id: number, enable: boolean) => {
  try {
    await api.post(`/admin/credentials/${id}/toggle`, { enable });
    await fetchCredentials();
  } catch (err) {
    alert('状态修改失败');
  }
};

const deleteCredential = async (id: number) => {
  if (!confirm(`确认删除 #${id}？这会彻底移除该凭证。`)) return;
  try {
    await api.delete(`/admin/credentials/${id}`);
    await fetchCredentials();
  } catch (err) {
    alert('删除失败');
  }
};

onMounted(() => {
  fetchCredentials();
});
</script>

<style scoped>
/* Smooth scrollbar for the table area */
.overflow-auto::-webkit-scrollbar {
  width: 6px;
}
.overflow-auto::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}
.overflow-auto::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 10px;
}
.overflow-auto::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>
