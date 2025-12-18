<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title">
        ⚡ 反重力状态
      </div>
    </div>
    <div class="card-body">
      <div class="ag-status">
        <div class="ag-gauges">
          <div class="ag-gauge-item">
            <div class="gauge gauge-small gauge-claude" :style="gaugeStyle(claudePercentage, '#93C5FD')">
              <div class="gauge-inner">{{ claudePercentage }}%</div>
            </div>
            <div class="ag-gauge-label">
              Claude
            </div>
            <div class="ag-gauge-value">
                <span class="text-white">{{ isTokenMode ? formatNumber(stats.antigravity_usage?.claude || 0) : (stats.antigravity_usage?.claude || 0) }}</span>
                <span class="text-[#A5B4FC]"> / {{ isTokenMode ? formatNumber(stats.antigravity_usage?.limits?.claude || 0) : (stats.antigravity_usage?.limits?.claude || 100) }}</span>
                <span class="text-[10px] text-[#A5B4FC] opacity-80">{{ isTokenMode ? 'Tokens' : '次' }}</span>
            </div>
          </div>
          <div class="ag-gauge-item">
            <div class="gauge gauge-small gauge-gemini" :style="gaugeStyle(geminiPercentage, '#86EFAC')">
              <div class="gauge-inner">{{ geminiPercentage }}%</div>
            </div>
            <div class="ag-gauge-label">
              Gemini 3
            </div>
            <div class="ag-gauge-value">
                <span class="text-white">{{ isTokenMode ? formatNumber(stats.antigravity_usage?.gemini3 || 0) : (stats.antigravity_usage?.gemini3 || 0) }}</span>
                <span class="text-[#A5B4FC]"> / {{ isTokenMode ? formatNumber(stats.antigravity_usage?.limits?.gemini3 || 0) : (stats.antigravity_usage?.limits?.gemini3 || 200) }}</span>
                <span class="text-[10px] text-[#A5B4FC] opacity-80">{{ isTokenMode ? 'Tokens' : '次' }}</span>
            </div>
          </div>
        </div>
        <div class="ag-button">
          <button @click="$emit('upload')" class="primary-btn full-width">上传凭证</button>
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

defineEmits(['upload']);

const isTokenMode = computed(() => {
    return !!props.stats.antigravity_usage?.use_token_quota;
});

const formatNumber = (num: number) => {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
};

const claudePercentage = computed(() => {
    const current = props.stats.antigravity_usage?.claude || 0;
    const max = props.stats.antigravity_usage?.limits?.claude || 100;
    if (max === 0) return 0;
    return Math.min(100, Math.round((current / max) * 100));
});

const geminiPercentage = computed(() => {
    const current = props.stats.antigravity_usage?.gemini3 || 0;
    const max = props.stats.antigravity_usage?.limits?.gemini3 || 200;
    if (max === 0) return 0;
    return Math.min(100, Math.round((current / max) * 100));
});

const gaugeStyle = (percentage: number, color: string) => {
    return {
        background: `conic-gradient(${color} 0% ${percentage}%, rgba(255,255,255,0.1) ${percentage}% 100%)`
    };
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

.ag-status {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-top: 24px;
}

.ag-gauges {
    display: flex;
    justify-content: space-around;
    gap: 16px;
}

.ag-gauge-item {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.ag-gauge-label {
    font-size: 0.875rem;
    color: #94a3b8;
    font-weight: 600;
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.ag-gauge-value {
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 2px;
}

.ag-button {
    margin-top: 8px;
    text-align: center;
}

.primary-btn {
    background: linear-gradient(135deg, #8B5CF6, #4338CA);
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.primary-btn:hover {
    opacity: 0.9;
    transform: scale(1.02);
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.4);
}

.gauge {
    width: 140px;
    height: 140px;
    border-radius: 50%;
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

.gauge-small {
    width: 100px;
    height: 100px;
    margin-bottom: 8px;
}

.gauge-small .gauge-inner {
    width: 70px;
    height: 70px;
    font-size: 1rem;
}

.gauge-claude {
    box-shadow: 0 0 15px rgba(147, 197, 253, 0.3);
}

.gauge-gemini {
    box-shadow: 0 0 15px rgba(134, 239, 172, 0.3);
}
</style>