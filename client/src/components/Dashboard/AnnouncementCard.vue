<template>
  <div class="card cursor-pointer group" @click="$emit('click')">
    <div class="card-header">
      <div class="card-title flex items-center gap-2">
        <span class="text-[#FDE68A]">📢</span> 公告
        <span class="text-xs font-normal text-white/30 group-hover:text-white/60 transition-colors ml-auto">点击查看详情</span>
      </div>
    </div>
    <div class="card-body relative flex flex-col">
      <div class="announcement-content markdown-body flex-1 overflow-hidden relative" :class="{ 'opacity-50': !content }">
        <div v-if="content" v-html="renderedContent" class="absolute inset-0"></div>
        <div v-else class="empty-state">
            <span>💤</span> 暂无公告
        </div>
      </div>
      <!-- Fade out effect at bottom -->
      <div v-if="content" class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#1e293b] to-transparent pointer-events-none"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';

const props = defineProps<{
  content: string;
}>();

defineEmits(['click']);

const md = new MarkdownIt({ html: false, breaks: true, linkify: true });
const renderedContent = computed(() => md.render(props.content || ''));
</script>

<style>
/* Global styles for markdown content within this component scope (but applied globally due to v-html) */
/* We use a specific class to scope it */
.announcement-content.markdown-body a {
    color: #60A5FA; /* Blue-400 */
    text-decoration: underline;
    font-weight: 600;
}
.announcement-content.markdown-body a:hover {
    color: #93C5FD; /* Blue-300 */
}
</style>

<style scoped>
.card {
    background: rgba(30, 41, 59, 0.4);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 20px -3px rgba(0, 0, 0, 0.2);
    border-color: rgba(139, 92, 246, 0.3); /* Purple border on hover */
}

.card-header {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.card-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: #C4B5FD;
}

.card-body {
    padding: 20px;
    flex: 1;
    overflow: hidden; /* Hide overflow for clamp */
}

.announcement-content {
    color: #E2E8F0;
    line-height: 1.6;
    font-size: 0.875rem;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #94A3B8;
    gap: 8px;
    padding-top: 20px;
}
</style>