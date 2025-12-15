<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" @click="handleBackdropClick"></div>
    
    <!-- Modal Content -->
    <div 
        v-motion-pop
        class="relative bg-white text-gray-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
    >
        <!-- Header -->
        <div class="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-white">
            <h3 class="text-2xl font-black text-indigo-950 flex items-center gap-2">
                📢 公告通知
                <span v-if="forceRead" class="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase">Important</span>
            </h3>
            <button v-if="!forceRead" @click="close" class="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center transition">
                ✕
            </button>
        </div>

        <!-- Scrollable Body -->
        <div class="p-8 overflow-y-auto custom-scrollbar flex-1 text-base leading-relaxed text-gray-700 markdown-body" v-html="renderedContent"></div>

        <!-- Footer -->
        <div class="px-8 py-6 border-t border-gray-100 bg-gray-50 flex justify-end">
            <button 
                @click="close" 
                :disabled="timeLeft > 0 && forceRead"
                class="px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg"
                :class="(timeLeft > 0 && forceRead) 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30'"
            >
                <span v-if="timeLeft > 0 && forceRead">请阅读 ({{ timeLeft }}s)</span>
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
let timer: any = null;

const startTimer = () => {
    if (!props.forceRead) {
        timeLeft.value = 0;
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

const close = () => {
    if (props.forceRead && timeLeft.value > 0) return;
    emit('close');
};

const handleBackdropClick = () => {
    if (!props.forceRead) close();
};

watch(() => props.show, (newVal) => {
    if (newVal) {
        startTimer();
    } else {
        if (timer) clearInterval(timer);
    }
});

onUnmounted(() => {
    if (timer) clearInterval(timer);
});
</script>

<style>
.markdown-body h1 { font-size: 1.5em; font-weight: bold; margin-bottom: 0.5em; }
.markdown-body h2 { font-size: 1.25em; font-weight: bold; margin-bottom: 0.5em; margin-top: 1em; }
.markdown-body p { margin-bottom: 1em; }
.markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 1em; }
.markdown-body ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 1em; }
.markdown-body a { color: #4f46e5; text-decoration: underline; }
.markdown-body blockquote { border-left: 4px solid #e5e7eb; padding-left: 1em; color: #6b7280; margin-bottom: 1em; }
.markdown-body code { background-color: #f3f4f6; padding: 0.2em 0.4em; rounded: 0.25em; font-family: monospace; font-size: 0.9em; }
.markdown-body pre { background-color: #f3f4f6; padding: 1em; rounded: 0.5em; overflow-x: auto; margin-bottom: 1em; }
.markdown-body pre code { background-color: transparent; padding: 0; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 0.5em; margin: 1em 0; }
</style>