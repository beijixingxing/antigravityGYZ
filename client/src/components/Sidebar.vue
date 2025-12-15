<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo-icon">☭</div>
      <div class="logo-text">星星人民公益站</div>
    </div>
    <div class="sidebar-profile">
      <div class="profile-avatar">
        <img v-if="userInfo.discordAvatar" :src="userInfo.discordAvatar" class="w-full h-full object-cover rounded-[24px]" alt="Avatar">
        <span v-else>{{ userInfo.username?.charAt(0).toUpperCase() || 'U' }}</span>
        <div class="profile-status"></div>
      </div>
      <div class="profile-name">{{ userInfo.username || 'User' }}</div>
      <div class="profile-role">{{ userInfo.role || 'Member' }}</div>
      <button @click="$emit('changePassword')" class="profile-action-btn">修改密码</button>
    </div>

    <nav class="nav-menu">
      <a href="#" @click.prevent="$emit('update:currentTab', 'home')" class="nav-item" :class="{ active: currentTab === 'home' }">
        <span class="icon">🏠</span> 控制台
      </a>
      <a href="#" @click.prevent="$emit('update:currentTab', 'antigravity')" class="nav-item" :class="{ active: currentTab === 'antigravity' }">
        <span class="icon">🚀</span> 反重力
      </a>
      <a href="#" @click.prevent="$emit('update:currentTab', 'upload')" class="nav-item" :class="{ active: currentTab === 'upload' }">
        <span class="icon">📤</span> CLI 上传
      </a>
      <a href="#" @click.prevent="$emit('update:currentTab', 'keys')" class="nav-item" :class="{ active: currentTab === 'keys' }">
        <span class="icon">🔑</span> 密钥管理
      </a>
      <a v-if="isAdmin" href="#" @click.prevent="$emit('update:currentTab', 'admin')" class="nav-item" :class="{ active: currentTab === 'admin' }">
        <span class="icon">⚙️</span> 管理
      </a>
    </nav>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  currentTab: string;
  userInfo: any;
  isAdmin: boolean;
}>();

defineEmits(['update:currentTab', 'changePassword']);
</script>

<style scoped>
.sidebar {
    width: 280px;
    background: rgba(30, 27, 75, 0.8);
    backdrop-filter: blur(20px);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    flex-direction: column;
    padding: 24px 16px;
    flex-shrink: 0;
    z-index: 100;
}

.sidebar-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px 24px 12px;
    margin-bottom: 12px;
}

.logo-icon {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    color: #fff;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

.logo-text {
    font-size: 1.125rem;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
    white-space: nowrap; /* Prevent wrapping */
}

.sidebar-profile {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 0 24px 0;
    margin-bottom: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.profile-avatar {
    width: 72px;
    height: 72px;
    border-radius: 24px;
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 16px;
    box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3);
    position: relative;
}

.profile-status {
    position: absolute;
    bottom: -4px;
    right: -4px;
    width: 20px;
    height: 20px;
    background-color: #10b981;
    border: 4px solid #1e1b4b;
    border-radius: 50%;
}

.profile-name {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
    margin-bottom: 4px;
}

.profile-role {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 16px;
}

.profile-action-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #cbd5e1;
    padding: 8px 20px;
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
}

.profile-action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
}

.nav-menu {
    flex: 1;
    overflow-y: auto;
}

.nav-item {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 20px;
    color: #cbd5e1;
    text-decoration: none;
    gap: 12px;
    font-weight: 500;
    transition: all 0.2s;
    border-radius: 16px;
    margin-bottom: 8px;
}

.nav-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    transform: translateX(4px);
}

.nav-item.active {
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.2), rgba(67, 56, 202, 0.2));
    border: 1px solid rgba(139, 92, 246, 0.5);
    color: #fff;
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.3);
    font-weight: 700;
}

.nav-item .icon {
    font-size: 1.5rem;
}

@media (max-width: 768px) {
    .sidebar {
        display: none;
    }
}
</style>