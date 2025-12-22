<template>
  <div class="admin-dashboard-cards">
    <!-- 三列卡片容器 -->
    <div class="cards-grid">
      <!-- 卡片1：凭证&额度总览 -->
      <div class="dashboard-card">
        <div class="card-header">
          <div class="card-title">✨ 凭证&额度总览</div>
        </div>
        <div class="card-body">
          <!-- 子模块1：凭证池 -->
          <div class="card-section">
            <div class="section-title">凭证池</div>
            <div class="credential-pools">
              <div class="pool-card">
                <div class="pool-label">Normal 凭证池</div>
                <div class="pool-value">
                  <CountUp :to="poolsOverview?.counts?.normal || 0" />
                </div>
                <div class="pool-subtext">
                  平均剩余：{{ poolsOverview?.remaining?.normal_avg !== null ? poolsOverview.remaining.normal_avg.toFixed(1) + '%' : '—%' }}
                </div>
              </div>
              <div class="pool-card">
                <div class="pool-label">Pro 凭证池</div>
                <div class="pool-value">
                  <CountUp :to="poolsOverview?.counts?.pro || 0" />
                </div>
                <div class="pool-subtext">
                  平均剩余：{{ poolsOverview?.remaining?.pro_avg !== null ? poolsOverview.remaining.pro_avg.toFixed(1) + '%' : '—%' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 子模块2：凭证状态 -->
          <div class="card-section">
            <div class="section-header-row">
              <div class="section-title">凭证状态</div>
              <button @click="refreshAg" class="refresh-btn">
                🔄 刷新全部
              </button>
            </div>
            <div class="credential-stats-grid">
              <div class="stat-item">
                <span class="stat-label">总数</span>
                <span class="stat-value text-white"><CountUp :to="antigravityTokenStats?.total || 0" /></span>
              </div>
              <div class="stat-item">
                <span class="stat-label">活跃 ✅</span>
                <span class="stat-value text-emerald-400"><CountUp :to="antigravityTokenStats?.active || 0" /></span>
              </div>
              <div class="stat-item">
                <span class="stat-label">禁用 ❌</span>
                <span class="stat-value text-rose-400"><CountUp :to="antigravityTokenStats?.inactive || 0" /></span>
              </div>
              <div class="stat-item">
                <span class="stat-label">上限</span>
                <span class="stat-value text-indigo-300"><CountUp :to="antigravityTokenStats?.total_capacity || 0" /></span>
              </div>
            </div>
          </div>

          <!-- 子模块3：系统模型额度 -->
          <div class="card-section">
            <div class="section-title">系统总凭证额度（按模型）</div>
            <div class="quota-single-line">
              <div class="quota-item">
                <span class="quota-label">Claude {{ isTokenMode ? 'Tokens' : '容量' }}</span>
                <span class="quota-value">
                  {{ isTokenMode ? formatNumber(antigravityStats?.capacity?.tokens?.claude || 0) : (antigravityStats?.capacity?.requests?.claude || 0) }}
                </span>
              </div>
              <div class="quota-divider"></div>
              <div class="quota-item">
                <span class="quota-label">Gemini 3 {{ isTokenMode ? 'Tokens' : '容量' }}</span>
                <span class="quota-value">
                  {{ isTokenMode ? formatNumber(antigravityStats?.capacity?.tokens?.gemini3 || 0) : (antigravityStats?.capacity?.requests?.gemini3 || 0) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 卡片2：算力&健康度 -->
      <div class="dashboard-card">
        <div class="card-header">
          <div class="card-title">⚡ 算力&健康度</div>
        </div>
        <div class="card-body">
          <!-- 子模块1：全局算力负载 -->
          <div class="card-section">
            <div class="section-title">全局算力负载</div>
            <div class="compute-load">
              <div class="load-main">
                <span class="load-label">综合负载</span>
                <span class="load-value highlight">
                  <CountUp :to="adminStats?.overview?.global_usage || 0" />
                  <span class="text-sm text-gray-500 font-normal">/ {{ adminStats?.overview?.global_capacity || 1 }}</span>
                </span>
              </div>
              <div class="load-details">
                <div class="load-detail">
                  <span class="detail-label">Flash</span>
                  <span class="detail-value">
                    {{ adminStats?.overview?.model_usage?.flash || 0 }}/{{ (adminStats?.overview?.capacities?.flash || 0) / 1000 }}k
                  </span>
                </div>
                <div class="load-detail">
                  <span class="detail-label">2.5 Pro</span>
                  <span class="detail-value">
                    {{ adminStats?.overview?.model_usage?.pro || 0 }}/{{ adminStats?.overview?.capacities?.pro || 0 }}
                  </span>
                </div>
                <div class="load-detail">
                  <span class="detail-label">3.0 Pro</span>
                  <span class="detail-value highlight">
                    {{ adminStats?.overview?.model_usage?.v3 || 0 }}/{{ adminStats?.overview?.capacities?.v3 || 0 }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 子模块2：凭证健康度 -->
          <div class="card-section">
            <div class="section-title">凭证健康度</div>
            <div class="health-status">
              <div class="health-main">
                <span class="health-label">活跃凭证</span>
                <span class="health-value highlight"><CountUp :to="adminStats?.overview?.active_credentials || 0" /></span>
              </div>
              <div class="health-progress">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: healthPercentage + '%' }"></div>
                </div>
                <div class="progress-labels">
                  <span>✅ {{ adminStats?.overview?.active_credentials || 0 }} Active</span>
                  <span>❌ {{ adminStats?.overview?.dead_credentials || 0 }} Dead</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 子模块3：反重力额度 -->
          <div class="card-section">
            <div class="section-title">额度统计</div>
            <div class="antigravity-quota">
              <div class="quota-text">
                所有成员今日已用{{ isTokenMode ? ' Tokens' : '反重力额度' }}
                <div class="quota-big-number">
                  {{ antigravityTotalUsage || 0 }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 卡片3：排行榜汇总 -->
      <div class="dashboard-card">
        <div class="card-header">
          <div class="card-title">🏆 排行榜汇总</div>
        </div>
        <div class="card-body">
          <!-- 子模块1：Top 25榜单 -->
          <div class="card-section">
            <div class="section-header-row">
              <div class="section-title">Top 25</div>
              <div class="pagination-mini">
                <button @click="leaderboardPage--" :disabled="leaderboardPage === 1" class="page-btn">←</button>
                <span class="page-info">{{ leaderboardPage }}/{{ Math.ceil((adminStats?.leaderboard?.length || 0) / 5) }}</span>
                <button @click="leaderboardPage++" :disabled="leaderboardPage >= Math.ceil((adminStats?.leaderboard?.length || 0) / 5)" class="page-btn">→</button>
              </div>
            </div>
            <div class="leaderboard-list">
              <div v-if="!adminStats?.leaderboard || adminStats.leaderboard.length === 0" class="empty-list">
                暂无数据
              </div>
              <div v-else class="leaderboard-items">
                <div v-for="(user, index) in visibleLeaderboard" :key="user.id" class="leaderboard-item">
                  <div class="rank">{{ (leaderboardPage - 1) * 5 + index + 1 }}</div>
                  <div class="user-info">
                    <div class="username">{{ user.discordUsername || user.email }}</div>
                  </div>
                  <div class="usage">{{ user.today_used }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 子模块2：反重力Top 25榜单 -->
          <div class="card-section">
            <div class="section-header-row">
              <div class="section-title">反重力 Top 25 🚀</div>
              <div class="pagination-mini">
                <button @click="agLeaderboardPage--" :disabled="agLeaderboardPage === 1" class="page-btn">←</button>
                <span class="page-info">{{ agLeaderboardPage }}/{{ Math.ceil((antigravityStats?.leaderboard?.length || 0) / 5) }}</span>
                <button @click="agLeaderboardPage++" :disabled="agLeaderboardPage >= Math.ceil((antigravityStats?.leaderboard?.length || 0) / 5)" class="page-btn">→</button>
              </div>
            </div>
            <div class="leaderboard-list">
              <div v-if="!antigravityStats?.leaderboard || antigravityStats.leaderboard.length === 0" class="empty-list">
                暂无数据
              </div>
              <div v-else class="leaderboard-items">
                <div v-for="(user, index) in visibleAgLeaderboard" :key="user.id" class="leaderboard-item">
                  <div class="rank">{{ (agLeaderboardPage - 1) * 5 + index + 1 }}</div>
                  <div class="user-info">
                    <div class="username">{{ user.discordUsername || user.email }}</div>
                  </div>
                  <div class="usage">{{ isTokenMode ? formatNumber(user.total) : user.total }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, watch } from 'vue';
import { api } from '@/utils/api';

// Props
const props = defineProps<{
  adminStats?: any;
  antigravityStats?: any;
  antigravityTokenStats?: any;
  poolsOverview?: any;
}>();

// Emits
const emit = defineEmits(['refresh', 'refresh-ag']);

// Local state
const leaderboardPage = ref(1);
const agLeaderboardPage = ref(1);
const isLoading = ref(false);

// Simple CountUp Component
const CountUp = {
  props: {
    to: { type: Number, required: true },
    duration: { type: Number, default: 1500 }
  },
  setup(props: any) {
    const current = ref(0);
    
    watch(() => props.to, (newVal: number) => {
      const start = current.value;
      const end = newVal;
      const startTime = performance.now();
      
      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / props.duration, 1);
        // Ease out expo
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        
        current.value = Math.floor(start + (end - start) * ease);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    }, { immediate: true });
    
    return () => h('span', current.value);
  }
};

// Computed properties
const healthPercentage = computed(() => {
  const active = props.adminStats?.overview?.active_credentials || 0;
  const total = props.adminStats?.overview?.total_credentials || 1;
  return Math.round((active / total) * 100);
});

const isTokenMode = computed(() => {
  return !!props.antigravityStats?.meta?.limits?.use_token_quota;
});

const formatNumber = (num: number) => {
    if (!isTokenMode.value) return num;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num;
};

const antigravityTotalUsage = computed(() => {
  const usage = props.antigravityStats?.usage;
  if (!usage) return 0;
  if (isTokenMode.value) {
      const claude = usage.tokens?.claude || 0;
      const gemini3 = usage.tokens?.gemini3 || 0;
      return formatNumber(claude + gemini3);
  }
  const claude = usage.requests?.claude || 0;
  const gemini3 = usage.requests?.gemini3 || 0;
  return claude + gemini3;
});

const visibleLeaderboard = computed(() => {
  const list = props.adminStats?.leaderboard || [];
  const start = (leaderboardPage.value - 1) * 5;
  return list.slice(start, start + 5);
});

const visibleAgLeaderboard = computed(() => {
  const list = props.antigravityStats?.leaderboard || [];
  const start = (agLeaderboardPage.value - 1) * 5;
  return list.slice(start, start + 5);
});

// Methods
const refreshAll = async () => {
  isLoading.value = true;
  try {
    emit('refresh');
  } finally {
    isLoading.value = false;
  }
};

const refreshAg = async () => {
    emit('refresh-ag');
};

</script>

<style scoped>
.admin-dashboard-cards {
  width: 100%;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  width: 100%;
}

@media (max-width: 1200px) {
  .cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}

.dashboard-card {
  background: linear-gradient(135deg, #3a2270, #2d1b5a);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  transition: all 0.3s ease;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.dashboard-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 12px 40px rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.4);
}

.card-header {
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(90deg, rgba(139, 92, 246, 0.05) 0%, transparent 100%);
}

.card-title {
  font-size: 1.25rem;
  font-weight: 800;
  color: #d8b4fe;
  text-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
  letter-spacing: 0.5px;
  text-decoration: underline;
  text-decoration-color: rgba(139, 92, 246, 0.3);
  text-underline-offset: 4px;
}

.card-body {
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.card-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #a78bfa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 凭证池样式 */
.credential-pools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.pool-card {
  background: rgba(45, 27, 90, 0.5);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  border: 1px solid rgba(139, 92, 246, 0.15);
  transition: background 0.2s;
}

.pool-card:hover {
  background: rgba(255, 255, 255, 0.05);
}

.pool-label {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 8px;
  font-weight: 600;
}

.pool-value {
  font-size: 2rem;
  font-weight: 800;
  color: #67e8f9;
  margin-bottom: 4px;
  text-shadow: 0 0 15px rgba(103, 232, 249, 0.2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.pool-subtext {
  font-size: 0.75rem;
  color: #64748b;
}

/* 凭证状态样式 */
.credential-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-item {
  background: rgba(45, 27, 90, 0.5);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.stat-label {
  font-size: 0.75rem;
  color: #94a3b8;
}

.stat-value {
  font-size: 1rem;
  font-weight: 700;
}

.refresh-btn {
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  color: #C4B5FD;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.refresh-btn:hover {
  background: rgba(139, 92, 246, 0.3);
  border-color: rgba(139, 92, 246, 0.5);
  transform: scale(1.05);
}

/* 模型额度样式 */
.quota-single-line {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: rgba(45, 27, 90, 0.5);
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.quota-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.quota-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
}

.quota-label {
  font-size: 0.75rem;
  color: #94a3b8;
}

.quota-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #f8fafc;
}

/* 算力负载样式 */
.compute-load {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.load-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: rgba(45, 27, 90, 0.5);
  border-radius: 12px;
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.load-label {
  font-size: 0.875rem;
  color: #94a3b8;
  font-weight: 600;
}

.load-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f8fafc;
}

.load-value.highlight {
  color: #67e8f9;
  text-shadow: 0 0 10px rgba(103, 232, 249, 0.2);
}

.load-details {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.load-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: rgba(45, 27, 90, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.detail-label {
  font-size: 0.625rem;
  color: #94a3b8;
  margin-bottom: 4px;
}

.detail-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #f8fafc;
}

.detail-value.highlight {
  color: #C4B5FD;
}

/* 健康度样式 */
.health-status {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.health-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.health-label {
  font-size: 0.875rem;
  color: #94a3b8;
}

.health-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f8fafc;
}

.health-value.highlight {
  color: #67e8f9;
}

.health-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-bar {
  height: 10px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #10B981, #34D399);
  border-radius: 5px;
  transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.3);
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #94a3b8;
  font-weight: 500;
}

/* 反重力额度样式 */
.antigravity-quota {
  padding: 16px;
  background: rgba(45, 27, 90, 0.5);
  border-radius: 12px;
  border: 1px solid rgba(139, 92, 246, 0.15);
}

.quota-text {
  font-size: 0.875rem;
  color: #94a3b8;
  text-align: center;
}

.quota-big-number {
  font-size: 2rem;
  font-weight: 800;
  color: #F472B6;
  margin-top: 8px;
  text-shadow: 0 0 15px rgba(244, 114, 182, 0.3);
}

/* 排行榜样式 */
.leaderboard-list {
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.empty-list {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 0.875rem;
  padding: 20px;
}

.leaderboard-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.leaderboard-item {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: rgba(45, 27, 90, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(139, 92, 246, 0.15);
  transition: all 0.2s;
}

.leaderboard-item:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateX(4px);
}

.rank {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #f8fafc;
  background: rgba(139, 92, 246, 0.2);
  border-radius: 6px;
  margin-right: 12px;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.username {
  font-size: 0.875rem;
  font-weight: 500;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.usage {
  font-size: 0.875rem;
  font-weight: 700;
  color: #C4B5FD;
  margin-left: 12px;
}

/* 分页样式 */
.pagination-mini {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #f8fafc;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.75rem;
  color: #94a3b8;
  min-width: 30px;
  text-align: center;
}

/* 文本颜色工具类 */
.text-emerald-400 {
  color: #67e8f9;
}

.text-rose-400 {
  color: #fb7185;
}

.text-indigo-300 {
  color: #a5b4fc;
}
</style>
