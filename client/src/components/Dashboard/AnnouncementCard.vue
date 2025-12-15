<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title">
        <span class="text-[#FDE68A]">📢</span> 公告
      </div>
    </div>
    <div class="card-body">
      <div class="announcement-content">
        <div v-if="content" v-html="renderedContent"></div>
        <div v-else class="empty-state">
            <span>💤</span> 暂无公告
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';

const props = defineProps<{
  content: string;
}>();

const md = new MarkdownIt({ html: false, breaks: true, linkify: true });
const renderedContent = computed(() => md.render(props.content || ''));
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
    display: flex;
    flex-direction: column;
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
    flex: 1;
    overflow-y: auto;
}

.announcement-content {
    color: #E2E8F0; /* Lighter text */
    line-height: 1.6;
    font-size: 0.875rem;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #94A3B8; /* Lighter text */
    gap: 8px;
}
</style>