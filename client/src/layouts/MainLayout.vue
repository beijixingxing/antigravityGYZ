<template>
  <div class="app">
    <AnimatedBackground />
    
    <Sidebar
      :currentTab="currentTab"
      :userInfo="userInfo"
      :isAdmin="isAdmin"
      @update:currentTab="$emit('update:currentTab', $event)"
      @changePassword="$emit('changePassword')"
    />

    <div class="content-wrapper">
      <TopBanner
        :userTitle="userTitle"
        :welcomeMessage="welcomeMessage"
        :userInfo="userInfo"
        @logout="$emit('logout')"
        @upgrade="$emit('upgrade')"
        @bindDiscord="$emit('bindDiscord')"
        @bindDiscordApp="$emit('bindDiscordApp')"
      />

      <main class="main-content">
        <slot></slot>
      </main>
    </div>

    <BottomNav
      :currentTab="currentTab" 
      :isAdmin="isAdmin"
      @update:currentTab="$emit('update:currentTab', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import TopBanner from '../components/TopBanner.vue';
import Sidebar from '../components/Sidebar.vue';
import BottomNav from '../components/BottomNav.vue';
import AnimatedBackground from '../components/AnimatedBackground.vue';

defineProps<{
  currentTab: string;
  userInfo: any;
  isAdmin: boolean;
  userTitle: string;
  welcomeMessage: string;
}>();

defineEmits(['update:currentTab', 'logout', 'changePassword', 'upgrade', 'bindDiscord', 'bindDiscordApp']);
</script>

<style scoped>
.app {
    display: flex;
    flex-direction: row;
    height: 100vh;
    overflow: hidden;
    /* background: radial-gradient(circle at top right, #2e1065, #0f172a); Removed to show AnimatedBackground */
    color: #f8fafc;
    font-family: 'Inter', sans-serif;
}

.content-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    position: relative;
}

.main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px 32px 32px;
}

@media (max-width: 768px) {
    .main-content {
        padding: 24px 16px 80px 16px;
    }
}
</style>