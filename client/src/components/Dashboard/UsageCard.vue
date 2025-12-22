<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title">📊 今日用量</div>
      <div class="rpm-badge" v-if="stats.rate_limit">RPM <span class="rpm-value">{{ stats.rate_limit }}</span></div>
    </div>
    <div class="card-body">
      <div class="gauge-container">
        <div class="gauge">
          <div class="gauge-inner">{{ percentage }}%</div>
        </div>
        <div class="model-stats">
          <div class="model-row">
            <div class="model-label">gemini-2.5-flash</div>
            <div class="model-bar">
              <div class="model-bar-fill flash" :style="{ width: getPercentage('gemini-2.5-flash') + '%' }"></div>
            </div>
            <div class="model-value">{{ getUsageText('gemini-2.5-flash') }}</div>
          </div>
          <div class="model-row">
            <div class="model-label">gemini-2.5-pro</div>
            <div class="model-bar">
              <div class="model-bar-fill pro" :style="{ width: getPercentage('gemini-2.5-pro') + '%' }"></div>
            </div>
            <div class="model-value">{{ getUsageText('gemini-2.5-pro') }}</div>
          </div>
          <div class="model-row">
            <div class="model-label">gemini-3-pro</div>
            <div class="model-bar">
              <div class="model-bar-fill preview" :style="{ width: getPercentage('gemini-3-pro-preview') + '%' }"></div>
            </div>
            <div class="model-value">{{ getUsageText('gemini-3-pro-preview') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  stats: any;
}>();

const getTotalLimit = () => {
    const l = props.stats.daily_limit;
    if (!l) return 0;
    if (typeof l === 'number') return l;
    return (l.flash || 0) + (l.pro || 0) + (l.v3 || 0);
};

const getModelLimit = (model: string) => {
    const l = props.stats.daily_limit;
    if (!l) return 0;
    if (typeof l === 'number') return l;
    
    if (model.includes('flash')) return l.flash || 0;
    if (model.includes('2.5-pro')) return l.pro || 0;
    if (model.includes('3-pro')) return l.v3 || 0;
    
    return 0;
};

const percentage = computed(() => {
    const limit = getTotalLimit();
    if (limit <= 0) return 0;
    const used = props.stats.today_used || 0;
    const percent = Math.min(100, Math.round((used / limit) * 100));
    return isNaN(percent) ? 0 : percent;
});

const getPercentage = (model: string) => {
    const usage = props.stats.model_usage?.[model] || 0;
    const limit = getModelLimit(model);
    if (limit <= 0) return 0;
    const percent = Math.min(100, Math.round((usage / limit) * 100));
    return isNaN(percent) ? 0 : percent;
};

const getUsageText = (model: string) => {
    const usage = props.stats.model_usage?.[model] || 0;
    const limit = getModelLimit(model);
    return `${usage} / ${limit}`;
};
</script>

<style scoped>
.card {
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    transition: all 0.3s ease;
    height: 336px;
    display: flex;
    flex-direction: column;
}

.card:hover {
    transform: translateY(-6px);
    box-shadow: 0 12px 40px rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.4);
}

.card-header {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.05) 0%, transparent 100%);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.card-title {
    font-size: 1.25rem;
    font-weight: 800;
    color: #E9D5FF;
    text-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
    letter-spacing: 0.5px;
}

.rpm-badge {
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: #C4B5FD;
    font-size: 0.75rem;
    padding: 4px 12px;
    border-radius: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.2);
    display: flex;
    align-items: center;
    gap: 4px;
}

.rpm-value {
    color: #67e8f9;
    font-size: 0.9rem;
    font-weight: 900;
    text-shadow: 0 0 10px rgba(103, 232, 249, 0.5);
}

.card-body {
    padding: 10px 20px 20px 20px;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.gauge-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
}

.gauge {
    width: 90px;
    height: 90px;
    border-radius: 50%;
    background: conic-gradient(#8b5cf6 v-bind(percentage + '%'), rgba(255,255,255,0.1) 0%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
    box-shadow: 0 0 20px rgba(139, 92, 246, 0.2);
    position: relative;
    flex-shrink: 0;
}

.gauge-inner {
    width: 66px;
    height: 66px;
    border-radius: 50%;
    background-color: #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    color: #f8fafc;
    z-index: 2;
}

.model-stats {
    width: 100%;
    margin-top: 4px;
}

.model-row {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
}

.model-label {
    flex: 0 0 140px;
    font-size: 0.875rem;
    color: #94a3b8;
    font-weight: 500;
}

.model-bar {
    flex: 1;
    height: 8px;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}

.model-bar-fill {
    height: 100%;
    border-radius: 4px;
}

.model-value {
    margin-left: 12px;
    font-size: 0.75rem;
    color: #FFFFFF;
    width: 80px; /* Increased width to fit "0 / 0" format */
    text-align: right;
    white-space: nowrap;
}

.flash { background: linear-gradient(90deg, #6366f1, #818cf8); box-shadow: 0 0 10px rgba(99, 102, 241, 0.4); }
.pro { background: linear-gradient(90deg, #d946ef, #f472b6); box-shadow: 0 0 10px rgba(217, 70, 239, 0.4); }
.preview { background: linear-gradient(90deg, #06b6d4, #22d3ee); box-shadow: 0 0 10px rgba(6, 182, 212, 0.4); }
</style>
