<template>
  <div class="card cursor-pointer hover:border-indigo-500/30 group" @click="$emit('click')">
    <div class="card-header shrink-0">
      <div class="card-title">
        <span class="text-[#FDE68A]">📢</span> 公告
      </div>
      <div class="text-xs text-white/30 group-hover:text-indigo-400 transition-colors">
          点击查看详情 →
      </div>
    </div>
    <div class="card-body overflow-hidden relative">
      <div class="announcement-content">
        <div v-if="content" v-html="renderedContent"></div>
        <div v-else class="empty-state">
            <span>💤</span> 暂无公告
        </div>
      </div>
      <!-- Fade overlay -->
      <div v-if="content" class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0f172a] to-transparent pointer-events-none"></div>
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
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    transition: all 0.3s ease;
    height: 336px; /* Fixed height 336px */
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

.card-body {
    padding: 20px;
    flex: 1;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
}

.announcement-content {
    color: #e2e8f0;
    line-height: 1.6;
    font-size: 0.875rem;
    flex: 1;
    overflow: hidden;
}

.announcement-content :deep(h1),
.announcement-content :deep(h2),
.announcement-content :deep(h3),
.announcement-content :deep(h4) {
    color: #fff;
    font-weight: 700;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
}

.announcement-content :deep(p) {
    margin-bottom: 0.75em;
    color: #cbd5e1;
}

.announcement-content :deep(strong) {
    color: #fff;
    font-weight: 700;
}

.announcement-content :deep(a) {
    color: #818cf8;
    text-decoration: none;
    transition: color 0.2s;
}

.announcement-content :deep(a):hover {
    color: #a5b4fc;
    text-decoration: underline;
}

.announcement-content :deep(ul),
.announcement-content :deep(ol) {
    padding-left: 1.25em;
    margin-bottom: 0.75em;
    color: #cbd5e1;
}

.announcement-content :deep(li) {
    margin-bottom: 0.25em;
}

.announcement-content :deep(code) {
    background: rgba(0, 0, 0, 0.3);
    padding: 0.1em 0.3em;
    border-radius: 0.25em;
    font-family: monospace;
    font-size: 0.9em;
    color: #fca5a5;
}

.announcement-content :deep(blockquote) {
    border-left: 3px solid #6366f1;
    padding-left: 1em;
    color: #94a3b8;
    margin-bottom: 0.75em;
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
