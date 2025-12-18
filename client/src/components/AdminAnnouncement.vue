<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../utils/api';

const announcementContent = ref('');
const announcementDuration = ref(5);
const isPublishing = ref(false);
const publishMessage = ref('');

onMounted(async () => {
  await fetchAnnouncement();
});

const fetchAnnouncement = async () => {
    try {
        const res = await api.get('/announcement');
        if (res.data.content) announcementContent.value = res.data.content;
        if (res.data.duration) announcementDuration.value = res.data.duration;
    } catch (e) { console.error(e); }
};

const publishAnnouncement = async () => {
    isPublishing.value = true;
    publishMessage.value = '';
    try {
        await api.post('/admin/announcement', { 
            content: announcementContent.value,
            duration: announcementDuration.value
        });
        publishMessage.value = '公告已发布！所有用户下次访问将强制弹出。';
        setTimeout(() => publishMessage.value = '', 5000);
    } catch (e) {
        publishMessage.value = '发布失败';
    } finally {
        isPublishing.value = false;
    }
};
</script>

<template>
    <div class="bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_15px_rgba(139,92,246,0.1)] h-full flex flex-col w-full">
        <div class="flex items-center gap-4 mb-4">
            <h2 class="text-xl font-bold text-[#C4B5FD] flex items-center gap-2 whitespace-nowrap">
                <span>📢 全局公告管理</span>
            </h2>
            <div class="h-6 w-[1px] bg-white/10"></div>
            <p class="text-sm text-[#A5B4FC] opacity-60">发布后所有用户下次访问将强制弹窗显示</p>
        </div>
        
        <div class="relative group flex-1 flex flex-col">
            <textarea
                v-model="announcementContent"
                class="w-full min-h-[60vh] bg-black/20 border border-white/10 rounded-xl p-4 text-base text-white focus:border-[#8B5CF6] outline-none transition group-hover:border-[#8B5CF6]/50 group-hover:shadow-[0_0_10px_rgba(139,92,246,0.1)] resize-none font-mono"
                placeholder="在此输入公告内容 (支持 Markdown)..."
            ></textarea>
        </div>

        <div class="flex justify-between items-center mt-6 bg-black/20 p-4 rounded-xl border border-white/5">
            <div class="flex items-center gap-4">
                <label class="text-sm text-[#94A3B8]">强制观看时长</label>
                <div class="flex items-center gap-2">
                    <input type="number" v-model.number="announcementDuration" min="0" class="w-20 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-center text-sm font-bold text-white focus:border-[#8B5CF6] outline-none transition">
                    <span class="text-xs text-white/50">秒</span>
                </div>
            </div>

            <div class="flex items-center gap-4">
                <span v-if="publishMessage" class="text-sm font-bold text-green-400 animate-pulse">{{ publishMessage }}</span>
                <button
                    @click="publishAnnouncement"
                    :disabled="isPublishing"
                    class="px-8 py-3 bg-gradient-to-br from-[#8B5CF6] to-[#4338CA] text-white rounded-xl font-bold text-sm hover:opacity-90 transition shadow-lg shadow-indigo-500/20 disabled:opacity-50 hover:scale-105 hover:shadow-[0_0_20px_rgba(139,92,246,0.5)] duration-300 flex items-center gap-2"
                >
                    <span v-if="isPublishing" class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    {{ isPublishing ? '发布中...' : '立即发布' }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Hide spin buttons for input type number */
input[type=number]::-webkit-inner-spin-button, 
input[type=number]::-webkit-outer-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}

input[type=number] {
  -moz-appearance: textfield;
}
</style>