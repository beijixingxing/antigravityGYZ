<template>
  <nav class="bottom-nav">
    <a href="#" @click.prevent="$emit('update:currentTab', 'home')" class="bottom-nav-item" :class="{ active: currentTab === 'home' }">
      <span class="icon">🏠</span>
      <span>概览</span>
    </a>
    <a href="#" @click.prevent="$emit('update:currentTab', 'antigravity')" class="bottom-nav-item" :class="{ active: currentTab === 'antigravity' }">
      <span class="icon">🚀</span>
      <span>反重力</span>
    </a>
    <a href="#" @click.prevent="$emit('update:currentTab', 'upload')" class="bottom-nav-item" :class="{ active: currentTab === 'upload' }">
      <span class="icon">📤</span>
      <span>上传</span>
    </a>
    <a href="#" @click.prevent="$emit('update:currentTab', 'keys')" class="bottom-nav-item" :class="{ active: currentTab === 'keys' }">
      <span class="icon">🔑</span>
      <span>密钥</span>
    </a>
    <a v-if="isAdmin" href="#" @click.prevent="$emit('update:currentTab', 'admin')" class="bottom-nav-item" :class="{ active: currentTab === 'admin' }">
      <span class="icon">⚙️</span>
      <span>管理</span>
    </a>
  </nav>
</template>

<script setup lang="ts">
defineProps<{
  currentTab: string;
  isAdmin: boolean;
}>();

defineEmits(['update:currentTab']);
</script>

<style scoped>
.bottom-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 64px;
    background: rgba(30, 27, 75, 0.95);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    z-index: 100;
    justify-content: space-around;
    align-items: center;
    padding-bottom: env(safe-area-inset-bottom);
}

.bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    text-decoration: none;
    font-size: 0.75rem;
    gap: 4px;
    width: 100%;
    height: 100%;
}

.bottom-nav-item.active {
    color: #fff;
}

.bottom-nav-item .icon {
    font-size: 1.25rem;
}

@media (max-width: 768px) {
    .bottom-nav {
        display: flex;
    }
}
</style>