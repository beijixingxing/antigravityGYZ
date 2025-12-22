<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" @click="handleBackdropClick"></div>
    
    <!-- Modal Content -->
    <div 
        v-motion-pop
        class="relative bg-slate-900 border border-white/10 text-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
    >
        <!-- Header -->
        <div class="px-8 py-6 border-b border-white/10 flex justify-between items-center bg-white/5">
            <h3 class="text-2xl font-black text-indigo-100 flex items-center gap-2">
                📢 公告通知
                <span v-if="forceRead" class="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase">Important</span>
            </h3>
            <button v-if="!forceRead" @click="close" class="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition">
                ✕
            </button>
        </div>

        <!-- Scrollable Body -->
        <div 
            ref="scrollContainer"
            @scroll="handleScroll"
            class="p-8 overflow-y-auto custom-scrollbar flex-1 text-base leading-relaxed text-gray-200 markdown-body" 
            v-html="renderedContent"
        ></div>

        <!-- Footer -->
        <div class="px-8 py-6 border-t border-white/10 bg-white/5 flex justify-end">
            <button 
                @click="close" 
                :disabled="!canClose"
                class="px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg"
                :class="!canClose 
                    ? 'bg-white/10 text-white/30 cursor-not-allowed' 
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30'"
            >
                <span v-if="timeLeft > 0 && forceRead">请阅读 ({{ timeLeft }}s)</span>
                <span v-else-if="!hasScrolledToBottom && forceRead">请阅读到底部</span>
                <span v-else>我知道了</span>
            </button>
        </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true
});

const props = defineProps<{
    show: boolean;
    content: string;
    forceRead: boolean; // If true, enables the timer
}>();

const renderedContent = computed(() => md.render(props.content || ''));

const emit = defineEmits(['close']);

const timeLeft = ref(5);
const hasScrolledToBottom = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);
let timer: any = null;

const canClose = computed(() => {
    if (!props.forceRead) return true;
    return timeLeft.value <= 0 && hasScrolledToBottom.value;
});

const startTimer = () => {
    hasScrolledToBottom.value = false;
    if (!props.forceRead) {
        timeLeft.value = 0;
        hasScrolledToBottom.value = true;
        return;
    }
    timeLeft.value = 5;
    if (timer) clearInterval(timer);
    
    timer = setInterval(() => {
        timeLeft.value--;
        if (timeLeft.value <= 0) {
            clearInterval(timer);
        }
    }, 1000);
};

const handleScroll = () => {
    if (!props.forceRead || hasScrolledToBottom.value || !scrollContainer.value) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
    // Allow a small buffer (e.g., 5px) for floating point calculations
    if (scrollTop + clientHeight >= scrollHeight - 5) {
        hasScrolledToBottom.value = true;
    }
};

// Check if content is short enough to not need scrolling
const checkContentHeight = () => {
    if (!scrollContainer.value || !props.forceRead) return;
    
    // If content fits within container, mark as scrolled
    if (scrollContainer.value.scrollHeight <= scrollContainer.value.clientHeight) {
        hasScrolledToBottom.value = true;
    }
};

const close = () => {
    if (!canClose.value) return;
    emit('close');
};

const handleBackdropClick = () => {
    if (!props.forceRead) close();
};

watch(() => props.show, (newVal) => {
    if (newVal) {
        startTimer();
        // Wait for next tick to ensure content is rendered for height check
        setTimeout(checkContentHeight, 100);
    } else {
        if (timer) clearInterval(timer);
    }
});

onUnmounted(() => {
    if (timer) clearInterval(timer);
});
</script>

<style>
.markdown-body h1 { font-size: 1.5em; font-weight: bold; margin-bottom: 0.5em; color: #fff; }
.markdown-body h2 { font-size: 1.25em; font-weight: bold; margin-bottom: 0.5em; margin-top: 1em; color: #fff; }
.markdown-body h3, .markdown-body h4 { font-weight: bold; margin-bottom: 0.5em; color: #fff; }
.markdown-body p { margin-bottom: 1em; color: #cbd5e1; }
.markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 1em; color: #cbd5e1; }
.markdown-body ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 1em; color: #cbd5e1; }
.markdown-body a { color: #818cf8; text-decoration: none; transition: color 0.2s; }
.markdown-body a:hover { color: #a5b4fc; text-decoration: underline; }
.markdown-body blockquote { border-left: 4px solid #6366f1; padding-left: 1em; color: #94a3b8; margin-bottom: 1em; }
.markdown-body code { background-color: rgba(0,0,0,0.3); padding: 0.2em 0.4em; rounded: 0.25em; font-family: monospace; font-size: 0.9em; color: #fca5a5; }
.markdown-body pre { background-color: rgba(0,0,0,0.3); padding: 1em; rounded: 0.5em; overflow-x: auto; margin-bottom: 1em; }
.markdown-body pre code { background-color: transparent; padding: 0; color: #e2e8f0; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 0.5em; margin: 1em 0; }
.markdown-body strong { color: #fff; font-weight: 700; }
</style>
