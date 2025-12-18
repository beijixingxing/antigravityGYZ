<template>
  <header class="top-banner">
    <div class="banner-left">
      <!-- Logo moved to Sidebar -->
    </div>
    <div class="banner-right">
      <div v-if="!userInfo.discordId" class="relative group mr-4">
        <button class="bind-btn discord">
          <span class="icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/>
            </svg>
          </span> 账号绑定
        </button>
        <div class="absolute top-full right-0 mt-2 w-40 bg-[#1e1b4b] border border-white/10 rounded-xl shadow-xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
            <button @click="$emit('bindDiscord')" class="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2">
                <span class="icon-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/>
                    </svg>
                </span> Discord
            </button>
            <button @click="$emit('bindDiscordApp')" class="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2 border-t border-white/5">
                <span class="icon-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/>
                    </svg>
                </span> App 绑定
            </button>
        </div>
      </div>

      <div class="user-level-wrapper">
        <div class="user-level">
          <span class="level-icon">👑</span>
          <span class="level-name">{{ userTitle }}</span>
        </div>
        <div class="level-dropdown">
          <div class="level-dropdown-header">
            <span class="level-icon-large">👑</span>
            <span class="level-title">{{ userTitle }}</span>
          </div>
          <div class="level-desc">{{ welcomeMessage }}</div>
          <button @click="$emit('upgrade')" class="primary-btn full-width">去升级 →</button>
        </div>
      </div>
      <button @click="$emit('logout')" class="logout-btn">退出</button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  userTitle: string;
  welcomeMessage: string;
  userInfo: any;
}>();

defineEmits(['logout', 'upgrade', 'bindDiscord', 'bindDiscordApp']);
</script>

<style scoped>
.top-banner {
    height: 70px;
    background: rgba(30, 27, 75, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    flex-shrink: 0;
    z-index: 200;
}

.banner-left {
    display: flex;
    align-items: center;
    gap: 16px;
}

.banner-right {
    margin-left: auto; /* Push to right */
    display: flex;
    align-items: center;
    gap: 16px;
}

.logout-btn {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 20px;
    transition: all 0.2s;
}

.logout-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #fecaca;
    border-color: rgba(239, 68, 68, 0.3);
}

.bind-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid transparent;
}

.bind-btn.discord {
    background: #5865F2;
    color: white;
}

.bind-btn.discord:hover {
    background: #4752C4;
}

.bind-btn.app {
    background: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
    border-color: rgba(255, 255, 255, 0.1);
}

.bind-btn.app:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}

.user-level-wrapper {
    position: relative;
    cursor: pointer;
}

.user-level {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: linear-gradient(135deg, #8B5CF6, #4338CA);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    font-size: 0.875rem;
    color: #fff;
    transition: all 0.2s;
}

.user-level-wrapper:hover .user-level {
    background: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
}

.level-icon {
    font-size: 1rem;
}

.level-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    width: 280px;
    background: rgba(30, 41, 59, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    opacity: 0;
    visibility: hidden;
    transform: translateY(10px);
    transition: all 0.2s ease;
    z-index: 100;
    margin-top: 12px;
}

.user-level-wrapper:hover .level-dropdown {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

.level-dropdown::before {
    content: '';
    position: absolute;
    top: -6px;
    right: 20px;
    width: 12px;
    height: 12px;
    background: rgba(30, 41, 59, 0.95);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    transform: rotate(45deg);
}

.level-dropdown-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 12px;
    text-align: center;
}

.level-icon-large {
    font-size: 2.5rem;
    margin-bottom: 8px;
}

.level-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
}

.level-desc {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 16px;
    line-height: 1.5;
    text-align: center;
}

.primary-btn {
    background: linear-gradient(135deg, #8B5CF6, #4338CA);
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
}

.primary-btn:hover {
    opacity: 0.9;
}

@media (max-width: 768px) {
    .top-banner {
        padding: 0 16px;
    }
    .bind-btn {
        padding: 6px;
        gap: 0;
    }
    .bind-btn span:not(.icon) {
        display: none;
    }
}
</style>