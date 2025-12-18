<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" @click="handleBackdropClick"></div>
    
    <!-- Modal Content -->
    <div
        v-motion-pop
        class="relative bg-[#1e293b] text-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] border border-white/10"
    >
        <!-- Header -->
        <div class="px-8 py-6 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-[#2e1065] to-[#1e293b]">
            <h3 class="text-2xl font-black text-[#C4B5FD] flex items-center gap-2">
                📢 公告通知
                <span v-if="forceRead" class="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase shadow-lg shadow-red-500/30">Important</span>
            </h3>
            <button v-if="!forceRead" @click="close" class="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition text-white/50 hover:text-white">
                ✕
            </button>
        </div>

        <!-- Scrollable Body -->
        <div
            ref="contentRef"
            @scroll="checkScroll"
            class="p-8 overflow-y-auto custom-scrollbar flex-1 text-base leading-relaxed text-gray-200 markdown-body"
            v-html="renderedContent"
        ></div>

        <!-- Footer -->
        <div class="px-8 py-6 border-t border-white/10 bg-[#0f172a]/50 flex justify-end">
            <button
                @click="close"
                :disabled="!canClose"
                class="px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg"
                :class="!canClose
                    ? 'bg-white/10 text-white/30 cursor-not-allowed'
                    : 'bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] hover:opacity-90 text-white shadow-indigo-500/30'"
            >
                {{ buttonText }}
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
    duration?: number; // Duration in seconds
}>();

const renderedContent = computed(() => md.render(props.content || ''));

const emit = defineEmits(['close']);

const timeLeft = ref(0);
const hasScrolledToBottom = ref(false);
const isOverflowing = ref(false);
const contentRef = ref<HTMLElement | null>(null);
let timer: any = null;

const startTimer = () => {
    if (!props.forceRead) {
        timeLeft.value = 0;
        return;
    }
    timeLeft.value = props.duration || 5;
    if (timer) clearInterval(timer);
    
    timer = setInterval(() => {
        timeLeft.value--;
        if (timeLeft.value <= 0) {
            clearInterval(timer);
        }
    }, 1000);
};

const checkScroll = () => {
    if (!contentRef.value) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.value;
    // Allow a small buffer (e.g. 10px) for float precision issues
    if (scrollTop + clientHeight >= scrollHeight - 10) {
        hasScrolledToBottom.value = true;
    }
};

const checkOverflow = () => {
    if (!contentRef.value) return;
    isOverflowing.value = contentRef.value.scrollHeight > contentRef.value.clientHeight;
    if (!isOverflowing.value) {
        hasScrolledToBottom.value = true; // If no scroll needed, consider it scrolled
    } else {
        hasScrolledToBottom.value = false; // Reset if overflowing
    }
};

const canClose = computed(() => {
    if (!props.forceRead) return true;
    if (timeLeft.value > 0) return false;
    if (isOverflowing.value && !hasScrolledToBottom.value) return false;
    return true;
});

const buttonText = computed(() => {
    if (!props.forceRead) return '我知道了';
    if (timeLeft.value > 0) return `请阅读 (${timeLeft.value}s)`;
    if (isOverflowing.value && !hasScrolledToBottom.value) return '请阅读到底部';
    return '我知道了';
});

const close = () => {
    if (!canClose.value) return;
    emit('close');
};

const handleBackdropClick = () => {
    if (canClose.value) close();
};

watch(() => props.show, (newVal) => {
    if (newVal) {
        startTimer();
        // Wait for render to check overflow
        setTimeout(checkOverflow, 100);
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
.markdown-body h2 { font-size: 1.25em; font-weight: bold; margin-bottom: 0.5em; margin-top: 1em; color: #e2e8f0; }
.markdown-body p { margin-bottom: 1em; color: #cbd5e1; }
.markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 1em; color: #cbd5e1; }
.markdown-body ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 1em; color: #cbd5e1; }
.markdown-body a { color: #60a5fa; text-decoration: underline; font-weight: 600; }
.markdown-body a:hover { color: #93c5fd; }
.markdown-body blockquote { border-left: 4px solid #475569; padding-left: 1em; color: #94a3b8; margin-bottom: 1em; }
.markdown-body code { background-color: rgba(0,0,0,0.3); padding: 0.2em 0.4em; rounded: 0.25em; font-family: monospace; font-size: 0.9em; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.1); }
.markdown-body pre { background-color: rgba(0,0,0,0.3); padding: 1em; rounded: 0.5em; overflow-x: auto; margin-bottom: 1em; border: 1px solid rgba(255,255,255,0.1); }
.markdown-body pre code { background-color: transparent; padding: 0; border: none; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 0.5em; margin: 1em 0; }
</style>