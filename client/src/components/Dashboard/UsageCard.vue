<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title">📊 今日用量</div>
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
            <div class="model-value">{{ stats.model_usage?.['gemini-2.5-flash'] || 0 }}</div>
          </div>
          <div class="model-row">
            <div class="model-label">gemini-2.5-pro</div>
            <div class="model-bar">
              <div class="model-bar-fill pro" :style="{ width: getPercentage('gemini-2.5-pro') + '%' }"></div>
            </div>
            <div class="model-value">{{ stats.model_usage?.['gemini-2.5-pro'] || 0 }}</div>
          </div>
          <div class="model-row">
            <div class="model-label">gemini-3-pro</div>
            <div class="model-bar">
              <div class="model-bar-fill preview" :style="{ width: getPercentage('gemini-3-pro-preview') + '%' }"></div>
            </div>
            <div class="model-value">{{ stats.model_usage?.['gemini-3-pro-preview'] || 0 }}</div>
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

const percentage = computed(() => {
    if (!props.stats.daily_limit) return 0;
    return Math.min(100, Math.round((props.stats.today_used / props.stats.daily_limit) * 100));
});

const getPercentage = (model: string) => {
    const usage = props.stats.model_usage?.[model] || 0;
    const total = props.stats.today_used || 1;
    return Math.min(100, Math.round((usage / total) * 100));
};
</script>

<style scoped>
.card {
    background: rgba(30, 41, 59, 0.4);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s;
    height: 100%;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 20px -3px rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.1);
}

.card-header {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.card-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: #C4B5FD;
}

.card-body {
    padding: 20px;
}

.gauge-container {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.gauge {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: conic-gradient(#8b5cf6 v-bind(percentage + '%'), rgba(255,255,255,0.1) 0%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    box-shadow: 0 0 20px rgba(139, 92, 246, 0.2);
    position: relative;
}

.gauge-inner {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background-color: #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.75rem;
    font-weight: 700;
    color: #f8fafc;
    z-index: 2;
}

.model-stats {
    width: 100%;
    margin-top: 12px;
}

.model-row {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
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
    width: 60px;
    text-align: right;
}

.flash { background: linear-gradient(90deg, #6366f1, #818cf8); box-shadow: 0 0 10px rgba(99, 102, 241, 0.4); }
.pro { background: linear-gradient(90deg, #d946ef, #f472b6); box-shadow: 0 0 10px rgba(217, 70, 239, 0.4); }
.preview { background: linear-gradient(90deg, #06b6d4, #22d3ee); box-shadow: 0 0 10px rgba(6, 182, 212, 0.4); }
</style>