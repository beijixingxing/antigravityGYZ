<template>
  <MainLayout
    :currentTab="currentTab"
    :userInfo="userInfo"
    :isAdmin="isAdmin"
    :userTitle="userTitle"
    :welcomeMessage="welcomeMessage"
    @update:currentTab="currentTab = $event"
    @logout="logout"
    @changePassword="showChangePwModal = true"
    @upgrade="currentTab = 'upload'"
    @bindDiscord="bindDiscord"
    @bindDiscordApp="bindDiscordApp"
  >
    <!-- Home Tab -->
    <div v-if="currentTab === 'home'" class="grid">
      <!-- Announcement Card -->
      <div class="card-wrapper">
        <AnnouncementCard :content="announcementData.content" />
      </div>

      <!-- Usage Card -->
      <div class="card-wrapper">
        <UsageCard :stats="stats" />
      </div>

      <!-- Anti-Gravity Card -->
      <div class="card-wrapper">
        <AntiGravityCard :stats="stats" @upload="handleAntiGravityUpload" />
      </div>
    </div>

    <!-- Upload Tab -->
    <div v-else-if="currentTab === 'upload'" class="max-w-4xl mx-auto space-y-8">
        <div class="bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-950 rounded-[40px] p-10 shadow-2xl border border-white/50">
          <h2 class="text-3xl font-black mb-4 text-[#4338CA]">CLI 凭证上传</h2>
          <p class="text-lg font-medium opacity-70 mb-6 text-[#4338CA]">
            上传 Google Cloud Code CLI 凭证 JSON 文件，立即解锁更多额度。若包含 Gemini 3.0 权限，将自动识别并解锁至臻权限。
          </p>

          <div class="relative group">
            <textarea 
              v-model="uploadContent" 
              rows="6" 
              class="w-full bg-white/60 border-2 border-transparent rounded-3xl p-6 text-indigo-950 placeholder-indigo-950/30 focus:border-indigo-400 focus:bg-white focus:outline-none font-mono text-sm resize-none transition-all"
              placeholder='在此粘贴 JSON 内容，或者点击下方上传文件...'
            ></textarea>
            
            <div class="absolute bottom-4 right-4">
               <label class="cursor-pointer bg-white text-indigo-600 px-4 py-2 rounded-full font-bold shadow-md hover:bg-indigo-50 transition flex items-center gap-2">
                 <span>{{ filesToUpload.length > 0 ? `已选 ${filesToUpload.length} 个文件` : '📂 批量上传' }}</span>
                 <input type="file" accept=".json" multiple class="hidden" @change="handleFileUpload">
               </label>
            </div>
          </div>

          <div class="flex items-center justify-end mt-6 gap-4 flex-wrap">
             <a 
               href="https://oauth.beijixingxing.com/" 
               target="_blank"
               class="px-6 py-4 text-white bg-green-500 rounded-full font-bold text-lg hover:bg-green-600 transition-all shadow-lg shadow-green-500/30 flex items-center gap-2"
             >
               🔗 获取凭证 / Get Credential
             </a>

             <button 
               @click="handleCheckRaw" 
               :disabled="isUploading || !uploadContent"
               class="px-6 py-4 text-indigo-600 bg-white border-2 border-indigo-100 rounded-full font-bold text-lg hover:bg-indigo-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
             >
               {{ isCheckingRaw ? '检测中...' : '🔍 仅检测 3.0 资格' }}
             </button>

             <button
               @click="handleUpload"
               :disabled="isUploading"
               class="px-10 py-4 bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white rounded-full font-black text-lg hover:opacity-90 hover:scale-105 hover:shadow-[0_0_20px_rgba(139,92,246,0.5)] transition-all duration-300 shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
             >
               {{ isUploading ? '验证中...' : '验证并提交 ✨' }}
             </button>
          </div>
        </div>
        
        <div class="bg-white/5 border border-white/10 rounded-[40px] p-8 text-white">
           <h3 class="text-xl font-bold mb-6 text-[#C4B5FD]">我的上传记录</h3>
           <div v-if="myCredentials.length === 0" class="text-center py-8 text-white/30">
             空空如也，快去上传一个吧！
           </div>
           <div v-else class="space-y-3">
             <div v-for="(cred, index) in visibleCredentials" :key="cred.id" 
                  class="flex items-center justify-between p-4 rounded-2xl transition bg-white/5 hover:bg-white/10"
             >
                <div class="flex items-center gap-4">
                  <div class="w-10 h-10 rounded-full flex items-center justify-center text-xl bg-white/10">
                    {{ cred.status === 'ACTIVE' ? '🟢' : (cred.status === 'DEAD' ? '🚫' : '🔴') }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-bold flex items-center gap-2 flex-wrap">
                        <span class="break-all">{{ cred.google_email || `凭证 #${index + 1}` }}</span>
                        <span v-if="cred.status === 'DEAD'" class="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded whitespace-nowrap">已失效</span>
                        <span v-if="cred.supports_v3" class="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30 whitespace-nowrap">Gemini 3.0</span>
                    </div>
                    <div class="text-xs opacity-50">{{ new Date(cred.created_at).toLocaleDateString() }}</div>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                    <button @click="deleteCredential(cred.id)" class="text-sm text-red-300 hover:text-red-100 px-3 py-1 rounded-lg hover:bg-red-500/20 transition">
                    {{ cred.status === 'DEAD' ? '移除' : '删除' }}
                    </button>
                </div>
             </div>
           </div>
        </div>
    </div>

    <!-- Keys Tab -->
    <div v-else-if="currentTab === 'keys'" class="max-w-4xl mx-auto text-white">
        <div class="flex justify-between items-center mb-8">
          <h2 class="text-3xl font-bold text-[#C4B5FD]">API 密钥管理</h2>
          <button @click="openCreateKeyModal" class="px-6 py-3 bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white rounded-full font-black hover:opacity-90 transition-colors shadow-lg shadow-indigo-500/20">
            + 新建密钥
          </button>
        </div>
        <div class="grid gap-4">
          <div v-for="k in apiKeys" :key="k.id" class="bg-white/10 border border-white/10 rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div class="flex flex-col">
              <div class="flex items-center gap-3 mb-1">
                  <span class="font-bold text-lg">{{ k.name || '未命名密钥' }}</span>
                  <span v-if="k.type === 'ADMIN'" class="bg-yellow-500/20 text-yellow-300 text-[10px] font-black px-2 py-0.5 rounded uppercase border border-yellow-500/30">Admin Key</span>
                  <span v-if="!k.is_active" class="bg-red-500/20 text-red-300 text-[10px] font-black px-2 py-0.5 rounded uppercase border border-red-500/30">Disabled</span>
              </div>
              <div class="flex items-center gap-2">
                <code class="text-sm font-mono text-teal-200/80 bg-black/20 px-2 py-1 rounded break-all">{{ k.key }}</code>
                <button @click="copyToClipboard(k.key)" class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors">📋</button>
              </div>
            </div>
            <div class="flex items-center gap-3 self-end md:self-center">
                <button @click="toggleKey(k)" class="px-4 py-2 rounded-xl text-xs font-bold transition-colors" :class="k.is_active ? 'bg-white/10 hover:bg-yellow-500/20 text-white' : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'">{{ k.is_active ? '禁用' : '启用' }}</button>
                <button @click="deleteKey(k.id)" class="w-10 h-10 rounded-xl bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-300 flex items-center justify-center font-bold transition">✕</button>
            </div>
          </div>
        </div>
    </div>

    <!-- Antigravity Tab -->
    <div v-else-if="currentTab === 'antigravity'" class="max-w-5xl mx-auto">
        <AntigravityView :isAdmin="isAdmin" :initialExpandOAuth="expandOAuth" />
    </div>

    <!-- Admin Tab -->
    <div v-else-if="currentTab === 'admin' && isAdmin" class="max-w-6xl mx-auto text-white">
        <!-- Admin Stats Widgets -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <!-- 1. Global Capacity -->
            <div class="card p-5">
                <div class="flex items-start justify-between mb-2">
                    <div>
                        <h4 class="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">全局算力负载</h4>
                        <span class="text-xl font-bold">⚡ 综合负载</span>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex-1 transform scale-100">
                        <GaugeChart 
                            :current="adminStats.overview.global_usage" 
                            :max="adminStats.overview.global_capacity || 1" 
                            progressColor="#818cf8" 
                            textColor="text-white" 
                        />
                    </div>
                    <div class="flex flex-col gap-2 w-1/3">
                        <div class="bg-black/20 rounded-lg p-1.5 text-center">
                            <div class="text-[9px] text-white/50">Flash</div>
                            <div class="text-[10px] font-bold">
                                {{ adminStats.overview.model_usage?.flash || 0 }} <span class="opacity-50">/ {{ (adminStats.overview.capacities?.flash || 0) / 1000 }}k</span>
                            </div>
                        </div>
                        <div class="bg-black/20 rounded-lg p-1.5 text-center">
                            <div class="text-[9px] text-white/50">2.5 Pro</div>
                            <div class="text-[10px] font-bold">
                                {{ adminStats.overview.model_usage?.pro || 0 }} <span class="opacity-50">/ {{ adminStats.overview.capacities?.pro || 0 }}</span>
                            </div>
                        </div>
                        <div class="bg-black/20 rounded-lg p-1.5 text-center border border-purple-500/30">
                            <div class="text-[9px] text-purple-300">3.0 Pro</div>
                            <div class="text-[10px] font-bold text-purple-200">
                                {{ adminStats.overview.model_usage?.v3 || 0 }} <span class="opacity-50">/ {{ adminStats.overview.capacities?.v3 || 0 }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 2. Health Status -->
            <div class="card p-5">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="text-[10px] font-black text-emerald-200 uppercase tracking-widest">凭证健康度</h4>
                </div>
                <div class="flex flex-col items-center justify-center h-full pb-2">
                    <div class="text-4xl font-black text-emerald-400 mb-1 drop-shadow-lg">{{ adminStats.overview.active_credentials }}</div>
                    <div class="text-xs font-bold text-white/60 mb-3">活跃凭证</div>
                    
                    <div class="w-full bg-black/20 h-2 rounded-full overflow-hidden flex">
                        <div class="bg-emerald-500 h-full transition-all duration-1000" :style="{ width: (adminStats.overview.active_credentials / (adminStats.overview.total_credentials || 1) * 100) + '%' }"></div>
                        <div class="bg-rose-500 h-full transition-all duration-1000 flex-1"></div>
                    </div>
                    <div class="flex justify-between w-full mt-2 text-[9px] font-black text-white/30 uppercase">
                        <span>{{ adminStats.overview.active_credentials }} Active</span>
                        <span>{{ adminStats.overview.dead_credentials }} Dead</span>
                    </div>
                </div>
            </div>

            <!-- 3. Top Users Leaderboard -->
            <div class="card p-5 flex flex-col">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="text-[10px] font-black text-amber-200 uppercase tracking-widest">Top 25 🏆</h4>
                    <div class="flex gap-1">
                        <button @click="leaderboardPage--" :disabled="leaderboardPage === 1" class="w-5 h-5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 text-[10px]">←</button>
                        <span class="text-[10px] font-mono pt-1">{{ leaderboardPage }}/5</span>
                        <button @click="leaderboardPage++" :disabled="leaderboardPage === 5" class="w-5 h-5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 text-[10px]">→</button>
                    </div>
                </div>
                
                <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    <div v-if="adminStats.leaderboard.length === 0" class="h-full flex items-center justify-center text-white/20 text-xs">
                        暂无数据
                    </div>
                    <div v-else class="space-y-1.5">
                        <div v-for="(user, idx) in visibleLeaderboard" :key="user.id" 
                                class="flex justify-between items-center p-2 rounded-lg bg-black/10 border border-white/5 hover:bg-white/10 transition-colors">
                            <div class="flex items-center gap-2">
                                <div class="w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black"
                                    :class="{
                                    'bg-yellow-400 text-yellow-900': ((leaderboardPage - 1) * 5 + idx) === 0,
                                    'bg-gray-300 text-gray-900': ((leaderboardPage - 1) * 5 + idx) === 1,
                                    'bg-orange-400 text-orange-900': ((leaderboardPage - 1) * 5 + idx) === 2,
                                    'bg-white/10 text-white/50': ((leaderboardPage - 1) * 5 + idx) > 2
                                    }">
                                {{ (leaderboardPage - 1) * 5 + idx + 1 }}
                                </div>
                                <span class="text-xs font-bold text-white/90">{{ user.discordUsername || user.email }}</span>
                            </div>
                            <span class="text-[10px] font-mono text-indigo-300">{{ user.today_used }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 4. Antigravity Leaderboard -->
            <div class="card p-5 flex flex-col">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="text-[10px] font-black text-cyan-200 uppercase tracking-widest">反重力 Top 25 🚀</h4>
                    <div class="flex gap-1">
                        <button @click="agLeaderboardPage--" :disabled="agLeaderboardPage === 1" class="w-5 h-5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 text-[10px]">←</button>
                        <span class="text-[10px] font-mono pt-1">{{ agLeaderboardPage }}/5</span>
                        <button @click="agLeaderboardPage++" :disabled="agLeaderboardPage === 5" class="w-5 h-5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 text-[10px]">→</button>
                    </div>
                </div>
                
                <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    <div v-if="agLeaderboard.length === 0" class="h-full flex items-center justify-center text-white/20 text-xs">
                        暂无数据
                    </div>
                    <div v-else class="space-y-1.5">
                        <div v-for="(user, idx) in visibleAgLeaderboard" :key="user.id" 
                                class="flex justify-between items-center p-2 rounded-lg bg-black/10 border border-white/5 hover:bg-white/10 transition-colors">
                            <div class="flex items-center gap-2">
                                <div class="w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black"
                                    :class="{
                                    'bg-yellow-400 text-yellow-900': ((agLeaderboardPage - 1) * 5 + idx) === 0,
                                    'bg-gray-300 text-gray-900': ((agLeaderboardPage - 1) * 5 + idx) === 1,
                                    'bg-orange-400 text-orange-900': ((agLeaderboardPage - 1) * 5 + idx) === 2,
                                    'bg-white/10 text-white/50': ((agLeaderboardPage - 1) * 5 + idx) > 2
                                    }">
                                {{ (agLeaderboardPage - 1) * 5 + idx + 1 }}
                                </div>
                                <span class="text-xs font-bold text-white/90">{{ user.discordUsername || user.email }}</span>
                            </div>
                            <span class="text-[10px] font-mono text-cyan-300">{{ user.total }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Admin Settings & Tables -->
        <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-[40px] p-1 shadow-[0_0_30px_rgba(139,92,246,0.15)] overflow-hidden">
            <div class="flex gap-2 p-2 border-b border-white/5">
                <button @click="adminTab = 'credentials'" class="px-6 py-3 rounded-full text-sm font-bold transition-all" :class="adminTab === 'credentials' ? 'bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' : 'text-[#A5B4FC] hover:bg-white/5 hover:text-white'">🎫 凭证管理</button>
                <button @click="adminTab = 'users'" class="px-6 py-3 rounded-full text-sm font-bold transition-all" :class="adminTab === 'users' ? 'bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' : 'text-[#A5B4FC] hover:bg-white/5 hover:text-white'">👥 用户管理</button>
                <button @click="adminTab = 'settings'" class="px-6 py-3 rounded-full text-sm font-bold transition-all" :class="adminTab === 'settings' ? 'bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' : 'text-[#A5B4FC] hover:bg-white/5 hover:text-white'">⚙️ 系统设置</button>
            </div>
            <div class="p-4 text-white">
                <AdminCredentialTable v-if="adminTab === 'credentials'" />
                <AdminUserTable v-if="adminTab === 'users'" />
                <div v-if="adminTab === 'settings'">
                    <AdminSettings class="mb-6" />
                </div>
            </div>
        </div>
    </div>

    <!-- Modals -->
    <div v-if="showChangePwModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-white/10 p-8 rounded-3xl w-full max-w-sm shadow-2xl">
            <h3 class="text-xl font-bold mb-6 text-white">🔒 修改密码</h3>
            <div class="space-y-4">
                <div>
                    <label class="text-xs text-white/50 mb-1 block">旧密码</label>
                    <input type="password" v-model="pwOld" class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-pink-500 outline-none transition">
                </div>
                <div>
                    <label class="text-xs text-white/50 mb-1 block">新密码 (至少6位)</label>
                    <input type="password" v-model="pwNew" class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-pink-500 outline-none transition">
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-8">
                <button @click="showChangePwModal = false" class="px-5 py-2 rounded-xl hover:bg-white/10 text-sm text-white/70">取消</button>
                <button @click="changePassword" class="px-5 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-xl font-bold text-sm">修改</button>
            </div>
        </div>
    </div>

    <!-- Create Key Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl">
            <h3 class="text-2xl font-bold mb-6 text-white">创建新密钥</h3>
            <input v-model="newKeyName" placeholder="给密钥起个名字" class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 mb-4 text-white focus:outline-none focus:border-teal-500 transition-colors">
            <div v-if="isAdmin" class="mb-6 flex items-center gap-3">
                <input type="checkbox" id="adminKey" v-model="newKeyIsAdmin" class="w-5 h-5 rounded bg-black/30 border-white/10 text-teal-500 focus:ring-teal-500">
                <label for="adminKey" class="text-sm text-gray-300">这是管理员密钥 (无限额度)</label>
            </div>
            <div class="flex justify-end gap-3">
                <button @click="showCreateModal = false" class="px-6 py-2 rounded-xl hover:bg-white/10 transition-colors text-white">取消</button>
                <button @click="confirmCreateKey" class="px-6 py-2 bg-teal-500 text-black font-bold rounded-xl hover:bg-teal-400 transition-colors">创建</button>
            </div>
        </div>
    </div>

  </MainLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/utils/api';
import MainLayout from '../layouts/MainLayout.vue';
import AnnouncementCard from '../components/Dashboard/AnnouncementCard.vue';
import UsageCard from '../components/Dashboard/UsageCard.vue';
import AntiGravityCard from '../components/Dashboard/AntiGravityCard.vue';
import AntigravityView from '../components/AntigravityView.vue';
import AdminCredentialTable from '../components/AdminCredentialTable.vue';
import AdminUserTable from '../components/AdminUserTable.vue';
import AdminQuotaSettings from '../components/AdminQuotaSettings.vue';
import AdminSettings from '../components/AdminSettings.vue';
import GaugeChart from '../components/GaugeChart.vue';

const router = useRouter();
const currentTab = ref('home');
const adminTab = ref('credentials');
const expandOAuth = ref(false);

// State
const stats = ref<any>({});
const userInfo = ref<any>({});
const isAdmin = ref(false);
const announcementData = ref({ content: '', version: 0 });
const apiKeys = ref<any[]>([]);
const myCredentials = ref<any[]>([]);
const adminStats = ref({
  overview: {
    active_credentials: 0,
    dead_credentials: 0,
    total_credentials: 0,
    global_capacity: 0,
    global_usage: 0,
    capacities: { flash: 0, pro: 0, v3: 0 },
    model_usage: { flash: 0, pro: 0, v3: 0 },
    utilization_rate: 0
  },
  leaderboard: [] as any[]
});
const agLeaderboard = ref<any[]>([]);
const leaderboardPage = ref(1);
const agLeaderboardPage = ref(1);

// Upload State
const uploadContent = ref('');
const isUploading = ref(false);
const isCheckingRaw = ref(false);
const filesToUpload = ref<File[]>([]);
const visibleLimit = ref(5);

// Modals
const showChangePwModal = ref(false);
const showCreateModal = ref(false);
const pwOld = ref('');
const pwNew = ref('');
const newKeyName = ref('');
const newKeyIsAdmin = ref(false);

// Computed
const userTitle = computed(() => {
    if (stats.value.contributed_v3_active > 0) return '至臻大佬 💎';
    if (stats.value.level > 0 || stats.value.contributed_active > 0) return '大佬 👑';
    return '萌新 🌱';
});

const welcomeMessage = computed(() => {
    if (stats.value.contributed_v3_active > 0) return '尊贵的 Gemini 3.0 贡献者，您已解锁最高权限！';
    if (stats.value.level > 0 || stats.value.contributed_active > 0) return '感谢您的无私奉献，您拥有尊贵的加成额度。';
    const quota = stats.value.system_config?.quota?.contributor || 1500;
    return `还没有上传凭证哦，上传一个即可解锁 ${quota} 次/天！`;
});

const visibleCredentials = computed(() => {
    return myCredentials.value.slice(0, visibleLimit.value);
});

const visibleLeaderboard = computed(() => {
    const list = adminStats.value?.leaderboard;
    if (!Array.isArray(list)) return [];
    const start = (leaderboardPage.value - 1) * 5;
    return list.slice(start, start + 5);
});

const visibleAgLeaderboard = computed(() => {
    if (!Array.isArray(agLeaderboard.value)) return [];
    const start = (agLeaderboardPage.value - 1) * 5;
    return agLeaderboard.value.slice(start, start + 5);
});

// Methods
const fetchStats = async () => {
  try {
    const res = await api.get('/dashboard/stats', { params: { _t: Date.now() } });
    stats.value = res.data;
    userInfo.value = res.data;
    isAdmin.value = res.data.role === 'ADMIN';

    if(isAdmin.value) {
        const resAdmin = await api.get('/admin/stats');
        adminStats.value = resAdmin.data;
        try {
            const ag = await api.get('/antigravity/stats');
            // Merge a minimal AG usage widget into adminStats.overview without impacting Cloud Code stats
            adminStats.value.overview = {
                ...adminStats.value.overview,
                ag_usage: ag.data.global_usage || { claude: 0, gemini3: 0 },
                ag_total: ag.data.global_capacity || { claude: 0, gemini3: 0 }
            };
            // Get Antigravity Leaderboard
            agLeaderboard.value = ag.data.leaderboard || [];
        } catch {}
    }

    const resKeys = await api.get('/dashboard/api-keys');
    apiKeys.value = resKeys.data;

    const resCreds = await api.get('/credentials');
    myCredentials.value = resCreds.data;
    
    const resAnnounce = await api.get('/announcement');
    announcementData.value = resAnnounce.data;

  } catch(e: any) {
      if(e.response?.status === 401) router.push('/login');
  }
};

const logout = () => {
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    router.push('/login');
};

const changePassword = async () => {
    if(pwNew.value.length < 6) return alert('密码过短');
    try {
        await api.post('/auth/change-password', { oldPassword: pwOld.value, newPassword: pwNew.value });
        alert('密码修改成功');
        showChangePwModal.value = false;
        pwOld.value = '';
        pwNew.value = '';
    } catch(e: any) {
        alert('修改失败: ' + (e.response?.data?.error || '未知错误'));
    }
};

// Upload Handlers
const handleFileUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        filesToUpload.value = Array.from(target.files);
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadContent.value = (e.target?.result as string) || '';
        };
        reader.readAsText(target.files[0]);
    }
};

const handleCheckRaw = async () => {
    if (!uploadContent.value) return;
    isCheckingRaw.value = true;
    try {
        const res = await api.post('/credentials/check-raw', { json_content: uploadContent.value });
        const data = res.data;
        if (data.success) {
            if (data.supports_v3) {
                alert('🎉 恭喜！此凭证拥有 Gemini 3.0 (Preview) 权限！');
            } else {
                alert('💨 此凭证有效，但暂未开放 Gemini 3.0 权限。');
            }
        } else {
            alert('检测失败: ' + data.error);
        }
    } catch (e: any) {
        alert('检测出错: ' + (e.response?.data?.error || e.message));
    } finally {
        isCheckingRaw.value = false;
    }
};

const handleUpload = async () => {
    if (filesToUpload.value.length === 0 && !uploadContent.value) return;
    isUploading.value = true;
    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    if (filesToUpload.value.length > 0) {
        for (const file of filesToUpload.value) {
            try {
                const content = await file.text();
                await api.post('/credentials', { json_content: content });
                successCount++;
            } catch (e: any) {
                failCount++;
                lastError = e.response?.data?.error || e.message || '未知错误';
            }
        }
    } else if (uploadContent.value) {
        try {
            await api.post('/credentials', { json_content: uploadContent.value });
            successCount++;
        } catch (e: any) {
            failCount++;
            lastError = e.response?.data?.error || e.message || '未知错误';
        }
    }

    isUploading.value = false;
    
    if (failCount > 0 && successCount === 0) {
        // 全部失败，显示详细错误
        alert(`上传失败\n\n${lastError}`);
    } else if (failCount > 0) {
        // 部分失败
        alert(`上传完成: 成功 ${successCount} 个, 失败 ${failCount} 个\n\n最后一个错误:\n${lastError}`);
    } else {
        // 全部成功
        alert(`🎉 上传成功！共 ${successCount} 个凭证`);
    }
    
    uploadContent.value = '';
    filesToUpload.value = [];
    fetchStats();
};

const deleteCredential = async (id: number) => {
    if(!confirm('确定删除此凭证？')) return;
    try {
        await api.delete(`/credentials/${id}`);
        fetchStats();
    } catch(e) {
        alert('删除失败');
    }
};

// Key Handlers
const openCreateKeyModal = () => {
    newKeyName.value = '';
    newKeyIsAdmin.value = false;
    showCreateModal.value = true;
};

const confirmCreateKey = async () => {
    try {
        await api.post('/dashboard/api-keys', { 
            name: newKeyName.value,
            type: newKeyIsAdmin.value ? 'ADMIN' : 'NORMAL'
        });
        showCreateModal.value = false;
        fetchStats();
    } catch (e: any) {
        alert('创建失败: ' + (e.response?.data?.error || e.message));
    }
};

const toggleKey = async (key: any) => {
    try {
        await api.patch(`/dashboard/api-keys/${key.id}`, { is_active: !key.is_active });
        fetchStats();
    } catch (e) {
        alert('操作失败');
    }
};

const deleteKey = async (id: number) => {
    if(!confirm('确定删除此密钥？')) return;
    try {
        await api.delete(`/dashboard/api-keys/${id}`);
        fetchStats();
    } catch (e) {
        alert('删除失败');
    }
};

const copyToClipboard = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
        alert('已复制');
    } catch (err) {
        alert('复制失败');
    }
};

const bindDiscord = async () => {
    console.log('bindDiscord clicked');
    try {
        const res = await api.get('/auth/discord/url', { params: { mode: 'bind' } });
        const url = res.data?.url;
        if (!url) throw new Error('Discord OAuth 未配置');
        window.location.href = url;
    } catch (e: any) {
        console.error('bindDiscord error', e);
        alert(e.response?.data?.error || e.message);
    }
};

const bindDiscordApp = async () => {
    console.log('bindDiscordApp clicked');
    try {
        const res = await api.get('/auth/discord/url', { params: { mode: 'bind' } });
        const url = res.data?.url;
        if (!url) throw new Error('Discord OAuth 未配置');
        const ua = navigator.userAgent.toLowerCase();
        const isAndroid = ua.includes('android');
        if (isAndroid) {
            const noSchema = url.replace(/^https?:\/\//, '');
            const intent = `intent://${noSchema}#Intent;scheme=https;package=com.discord;S.browser_fallback_url=${encodeURIComponent(url)};end`;
            location.href = intent;
            setTimeout(() => { location.href = url; }, 1200);
        } else {
            location.href = url;
        }
    } catch (e: any) {
        console.error('bindDiscordApp error', e);
        alert(e.response?.data?.error || e.message);
    }
};

const handleAntiGravityUpload = () => {
    currentTab.value = 'antigravity';
    expandOAuth.value = true;
    // Reset after a short delay so it can be triggered again if user navigates away and back
    setTimeout(() => {
        expandOAuth.value = false;
    }, 1000);
};

onMounted(() => {
    fetchStats();
});

watch(currentTab, () => {
    fetchStats();
});
</script>

<style scoped>
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
}

.card-wrapper {
    height: 100%;
}

.card {
    background: rgba(30, 41, 59, 0.4);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 20px -3px rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.1);
}
</style>