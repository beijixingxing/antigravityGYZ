<template>
  <div class="antigravity-container relative min-h-[600px] md:min-h-[800px] overflow-hidden rounded-[30px] md:rounded-[40px]">
    
    <!-- Cosmic Background -->
    <div class="absolute inset-0 bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 overflow-hidden">
      <div v-for="i in 50" :key="'star-'+i" class="star absolute rounded-full bg-white" :style="starStyle(i)"></div>
      <div class="meteor meteor-1"></div>
      <div class="meteor meteor-2"></div>
      <div class="meteor meteor-3"></div>
      <div class="nebula nebula-1"></div>
      <div class="nebula nebula-2"></div>
      <div class="orbit orbit-1"></div>
      <div class="orbit orbit-2"></div>
    </div>

    <!-- Content -->
    <div class="relative z-10 p-4 md:p-8 space-y-6 md:space-y-8">
      
      <!-- Title -->
      <div class="text-center mb-6 md:mb-10">
        <h2 class="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 mb-2 md:mb-3 animate-pulse-slow">
          &#128640; Antigravity
        </h2>
        <p class="text-purple-300/70 text-sm md:text-base">支持模型：Claude Opus 4.5, Gemini 3.0 Pro, Claude Sonnet 4.5</p>
      </div>

      <!-- Usage Dashboard removed -->

      <!-- OAuth Card -->
      <div id="oauth-card" class="glow-card bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl md:rounded-3xl overflow-hidden transition-all duration-500 group">
        <div
          @click="isOAuthExpanded = !isOAuthExpanded"
          class="p-5 md:p-8 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div class="flex flex-col md:flex-row md:items-center gap-4">
            <div>
              <h3 class="text-xl md:text-2xl font-black text-white flex items-center gap-2 md:gap-3">
                <span class="text-2xl md:text-3xl animate-bounce-slow">&#128274;</span>
                <span class="neon-text">获取授权凭证</span>
              </h3>
              <p class="text-purple-300/60 text-xs md:text-sm mt-1 md:mt-2">通过 Google OAuth 授权获取反重力渠道访问凭证</p>
            </div>
          </div>
          <button class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white transition-transform duration-300"
            :class="{ 'rotate-180': isOAuthExpanded }">
            &#9660;
          </button>
        </div>

        <!-- Steps -->
        <div v-show="isOAuthExpanded" class="px-5 md:px-8 pb-5 md:pb-8 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 border-t border-purple-500/20 pt-6">
          <!-- Step 1 -->
          <div class="step-card bg-gradient-to-br from-purple-900/50 to-indigo-900/50 border border-purple-500/20 rounded-xl md:rounded-2xl p-4 md:p-6">
            <div class="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
              <span class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-sm md:text-base pulse-ring">1</span>
              <span class="text-white font-bold text-sm md:text-base">获取授权链接</span>
            </div>
            <button @click="getOAuthUrl" :disabled="loadingUrl"
              class="w-full py-3 md:py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-sm md:text-base hover:from-purple-500 hover:to-pink-500 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-purple-500/30 neon-button">
              <span v-if="loadingUrl" class="flex items-center justify-center gap-2">
                <span class="animate-spin">&#9881;</span> 加载中...
              </span>
              <span v-else class="flex items-center justify-center gap-2">
                &#128279; 点击获取授权链接
              </span>
            </button>

            <div v-if="oauthUrl" class="mt-3 md:mt-4 p-3 md:p-4 bg-black/40 rounded-xl border border-purple-500/30 break-all">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-purple-300/70">授权链接已生成</span>
                <button @click="copyUrl" class="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                  {{ copied ? '已复制' : '复制' }}
                </button>
              </div>
              <a :href="oauthUrl" target="_blank" class="text-xs md:text-sm text-cyan-400 hover:text-cyan-300 underline transition-colors">
                👉 点击此链接打开授权页面
              </a>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="step-card bg-gradient-to-br from-indigo-900/50 to-cyan-900/50 border border-cyan-500/20 rounded-xl md:rounded-2xl p-4 md:p-6 space-y-4">
            <div>
              <div class="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                <span class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-cyan-500 flex items-center justify-center text-white font-bold text-sm md:text-base pulse-ring-cyan">2</span>
                <span class="text-white font-bold text-sm md:text-base">提交授权码</span>
              </div>
              <div class="mb-2 text-xs text-cyan-200/80 leading-relaxed break-words">
                请在完成Google授权后, 从打开的显示无法访问的页面的地址栏中完整复制整个网址并粘贴到下方。
              </div>
              <textarea v-model="authCode" rows="3" placeholder="粘贴完整网址..."
                class="w-full px-4 py-3 rounded-xl bg-black/40 border border-cyan-500/30 text-white placeholder-white/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 outline-none transition-all text-xs resize-none"></textarea>
              <div class="mt-2 flex items-center gap-2 text-white/70 text-xs md:text-sm">
                <input type="checkbox" id="skipProjectId" v-model="skipProjectId" class="rounded border-cyan-500/30 bg-black/40 text-cyan-500 focus:ring-cyan-500/50">
                <label for="skipProjectId" class="cursor-pointer hover:text-cyan-300 transition-colors">如果是家庭共享账号，请勾选此项以跳过 Project ID 认证</label>
              </div>
              <button @click="submitAuthCode" :disabled="!authCode || submitting"
                class="w-full mt-3 md:mt-4 py-3 md:py-4 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold text-sm md:text-base hover:from-cyan-500 hover:to-teal-500 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/30 neon-button-cyan">
                <span v-if="submitting && uploadMode==='oauth'" class="flex items-center justify-center gap-2">
                  <span class="animate-spin">&#9881;</span> 验证中...
                </span>
                <span v-else class="flex items-center justify-center gap-2">
                  &#10024; 提交授权码
                </span>
              </button>
            </div>

            <div class="pt-3 border-t border-cyan-500/20 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-white font-bold text-xs md:text-sm flex items-center gap-2">
                  <span class="text-base md:text-lg">&#128190;</span> 本地 JSON 凭证上传
                </span>
                <span class="text-[10px] md:text-xs text-cyan-200/70">用于已导出 OAuth JSON 的账号</span>
              </div>
              <div class="flex flex-col md:flex-row md:items-center gap-2">
                <input
                  ref="fileInput"
                  type="file"
                  accept=".json,application/json"
                  class="block w-full text-xs md:text-sm text-cyan-100 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs md:file:text-sm file:font-semibold file:bg-cyan-500/20 file:text-cyan-100 hover:file:bg-cyan-500/30 cursor-pointer bg-black/30 rounded-lg border border-cyan-500/30"
                  @change="handleFileChange"
                >
                <button
                  @click="uploadLocalCredential"
                  :disabled="!localJsonContent || submitting"
                  class="flex-1 md:flex-none md:w-40 py-2.5 md:py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold text-xs md:text-sm hover:from-emerald-400 hover:to-cyan-400 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30"
                >
                  <span v-if="submitting && uploadMode==='local'" class="flex items-center justify-center gap-2">
                    <span class="animate-spin">&#9881;</span> 上传中...
                  </span>
                  <span v-else class="flex items-center justify-center gap-2">
                    &#128640; 上传本地凭证
                  </span>
                </button>
              </div>
              <div v-if="localFileName" class="text-[10px] md:text-xs text-cyan-200/80 truncate">
                已选择：{{ localFileName }}
              </div>
            </div>
          </div>

          <!-- Message -->
          <div v-if="message" class="col-span-1 md:col-span-2 mt-2 p-3 md:p-4 rounded-xl text-center text-sm md:text-base font-bold animate-fade-in"
               :class="messageType === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'">
            {{ message }}
          </div>
        </div>
      </div>

      <!-- 我的凭证 -->
      <div class="glow-card bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl md:rounded-3xl p-5 md:p-8">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg md:text-xl font-black text-white flex items-center gap-2">
            <span class="text-xl md:text-2xl">&#128100;</span> 我的凭证
          </h3>
          <div class="flex items-center gap-2">
            <div class="text-xs text-purple-300/70">第 {{ page }} / {{ pageCount }} 页</div>
            <button @click="prevPage" :disabled="page<=1" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold">&lt;</button>
            <button @click="nextPage" :disabled="page>=pageCount" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold">&gt;</button>
            <button @click="fetchMyTokens" class="px-3 py-2 bg-purple-600/50 hover:bg-purple-600/70 rounded-xl text-white text-xs md:text-sm font-bold transition-all flex items-center justify-center gap-2">
            <span :class="{ 'animate-spin': loadingMyTokens }">&#8635;</span> 刷新
            </button>
          </div>
        </div>
        <div v-if="myTokens.length === 0" class="text-purple-300/60 text-sm">暂无凭证</div>
        <div v-else class="space-y-3">
          <div v-for="t in myTokens" :key="t.id" class="stat-card bg-gradient-to-br from-purple-900/40 to-fuchsia-900/40 border border-purple-500/30 rounded-xl p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-1">
                <div class="text-xs text-purple-300/70">#{{ t.id }}</div>
                <div class="text-sm text-white">{{ t.email || '未知邮箱' }}</div>
                <div class="text-xs">
                  <span v-if="t.status==='ACTIVE'" class="px-2 py-1 bg-green-500/20 text-green-400 rounded-full font-bold">活跃</span>
                  <span v-else-if="t.status==='COOLING'" class="px-2 py-1 bg-amber-500/20 text-amber-400 rounded-full font-bold">冷却中</span>
                  <span v-else class="px-2 py-1 bg-gray-500/20 text-gray-400 rounded-full font-bold">失效</span>
                  <span class="ml-2 px-2 py-1" :class="t.is_enabled ? 'bg-emerald-500/20 text-emerald-300 rounded-full' : 'bg-gray-500/20 text-gray-300 rounded-full'">
                    {{ t.is_enabled ? '已启用' : '已禁用' }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button @click="toggleMyToken(t)"
                  class="px-3 py-2 rounded-lg text-xs font-bold"
                  :class="t.is_enabled ? 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-300' : 'bg-green-500/20 hover:bg-green-500/40 text-green-300'">
                  {{ t.is_enabled ? '禁用' : '启用' }}
                </button>
                <button @click="deleteMyToken(t)" class="px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs font-bold">
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Admin Section -->
      <div v-if="isAdmin" class="space-y-6 md:space-y-8">
        
        <!-- Divider -->
        <div class="flex items-center gap-4">
          <div class="h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent flex-1"></div>
          <span class="text-purple-400/80 text-xs md:text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <span class="animate-pulse">&#128081;</span> 管理员控制台
          </span>
          <div class="h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent flex-1"></div>
        </div>

        <!-- Pools Overview -->
        <div v-if="poolsOverview" class="grid grid-cols-2 gap-3 md:gap-4">
          <div class="stat-card bg-gradient-to-br from-indigo-900/60 to-blue-900/60 border border-indigo-500/40 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-[10px] md:text-xs text-indigo-100/80 uppercase tracking-wider font-bold mb-2">Normal 凭证池</div>
            <div class="flex items-center justify-center gap-4">
              <div class="text-center">
                <div class="text-2xl md:text-4xl font-black text-indigo-200">{{ poolsOverview.counts?.normal || 0 }}</div>
                <div class="text-[10px] md:text-xs text-indigo-200/70">数量</div>
              </div>
              <div class="text-center">
                <div class="text-2xl md:text-4xl font-black text-cyan-200">
                  {{ poolsOverview.remaining?.normal_avg != null ? (poolsOverview.remaining.normal_avg * 100).toFixed(0) : '—' }}%
                </div>
                <div class="text-[10px] md:text-xs text-indigo-200/70">平均剩余</div>
              </div>
            </div>
          </div>
          <div class="stat-card bg-gradient-to-br from-purple-900/60 to-fuchsia-900/60 border border-purple-500/40 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-[10px] md:text-xs text-purple-100/80 uppercase tracking-wider font-bold mb-2">Pro 凭证池</div>
            <div class="flex items-center justify-center gap-4">
              <div class="text-center">
                <div class="text-2xl md:text-4xl font-black text-purple-200">{{ poolsOverview.counts?.pro || 0 }}</div>
                <div class="text-[10px] md:text-xs text-purple-200/70">数量</div>
              </div>
              <div class="text-center">
                <div class="text-2xl md:text-4xl font-black text-pink-200">
                  {{ poolsOverview.remaining?.pro_avg != null ? (poolsOverview.remaining.pro_avg * 100).toFixed(0) : '—' }}%
                </div>
                <div class="text-[10px] md:text-xs text-purple-200/70">平均剩余</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
          <div class="stat-card bg-gradient-to-br from-emerald-900/50 to-teal-900/50 border border-emerald-500/30 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-2xl md:text-4xl font-black text-emerald-400 mb-1 md:mb-2">{{ stats.total || 0 }}</div>
            <div class="text-[10px] md:text-xs text-emerald-300/70 uppercase tracking-wider font-bold">总数</div>
          </div>
          <div class="stat-card bg-gradient-to-br from-green-900/50 to-emerald-900/50 border border-green-500/30 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-2xl md:text-4xl font-black text-green-400 mb-1 md:mb-2">{{ stats.active || 0 }}</div>
            <div class="text-[10px] md:text-xs text-green-300/70 uppercase tracking-wider font-bold">活跃</div>
          </div>
          <div class="stat-card bg-gradient-to-br from-gray-900/50 to-slate-900/50 border border-gray-500/30 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-2xl md:text-4xl font-black text-gray-400 mb-1 md:mb-2">{{ stats.inactive || 0 }}</div>
            <div class="text-[10px] md:text-xs text-gray-300/70 uppercase tracking-wider font-bold">禁用</div>
          </div>
          <div class="stat-card bg-gradient-to-br from-indigo-900/50 to-blue-900/50 border border-indigo-500/30 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-2xl md:text-4xl font-black text-indigo-400 mb-1 md:mb-2">{{ stats.total_capacity || 0 }}</div>
            <div class="text-[10px] md:text-xs text-indigo-300/70 uppercase tracking-wider font-bold">总使用上限</div>
          </div>
          <div class="stat-card bg-gradient-to-br from-amber-900/50 to-orange-900/50 border border-amber-500/30 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <button @click="refreshAllTokens" :disabled="refreshing" class="w-full">
              <div class="text-2xl md:text-3xl mb-1 md:mb-2" :class="{ 'animate-spin': refreshing }">&#128260;</div>
              <div class="text-[10px] md:text-xs text-amber-300/70 uppercase tracking-wider font-bold">刷新全部</div>
            </button>
          </div>
        </div>

        <!-- Admin Usage Overview -->
        <div v-if="agOverview" class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <div class="stat-card bg-gradient-to-br from-purple-900/60 to-indigo-900/60 border border-purple-500/40 rounded-xl md:rounded-2xl p-4 md:p-5 text-center">
            <div class="text-2xl md:text-4xl font-black text-purple-200 mb-1 md:mb-2">
              {{
                formatNumber(
                    isTokenMode 
                    ? ((agOverview.usage?.tokens?.claude || 0) + (agOverview.usage?.tokens?.gemini3 || 0))
                    : ((agOverview.usage?.requests?.claude || 0) + (agOverview.usage?.requests?.gemini3 || 0))
                )
              }}
            </div>
            <div class="text-[10px] md:text-xs text-purple-100/80 uppercase tracking-wider font-bold">
              所有成员今日已用{{ isTokenMode ? 'Tokens' : '反重力额度' }}
            </div>
          </div>
          <div class="stat-card bg-gradient-to-br from-blue-900/60 to-cyan-900/60 border border-cyan-500/40 rounded-xl md:rounded-2xl p-4 md:p-5">
            <div class="text-[10px] md:text-xs text-cyan-100/80 uppercase tracking-wider font-bold mb-2 text-center">
              系统提供的总凭证额度（按模型类型）
            </div>
            <div class="flex flex-col gap-2 text-xs md:text-sm text-cyan-100/90">
              <div class="flex items-baseline justify-between">
                <span class="font-semibold">Claude {{ isTokenMode ? 'Tokens' : '容量' }}</span>
                <span class="font-mono text-base md:text-lg text-cyan-200">
                  {{ formatNumber(isTokenMode ? (agOverview.capacity?.tokens?.claude || 0) : (agOverview.capacity?.requests?.claude || 0)) }}
                </span>
              </div>
              <div class="flex items-baseline justify-between">
                <span class="font-semibold">Gemini 3 {{ isTokenMode ? 'Tokens' : '容量' }}</span>
                <span class="font-mono text-base md:text-lg text-cyan-200">
                  {{ formatNumber(isTokenMode ? (agOverview.capacity?.tokens?.gemini3 || 0) : (agOverview.capacity?.requests?.gemini3 || 0)) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Antigravity Strict Mode 已移至【管理设置】页面统一管理 -->

        <!-- Token 列表 -->
        <div class="glow-card bg-white/5 backdrop-blur-xl border border-purple-500/30 rounded-2xl md:rounded-3xl overflow-hidden">
          <div class="p-4 md:p-6 border-b border-purple-500/20 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h3 class="text-lg md:text-xl font-black text-white flex items-center gap-2">
              <span class="text-xl md:text-2xl">&#128203;</span> Token List
            </h3>
            <div class="flex items-center gap-2 flex-wrap">
                <!-- Filter Dropdown -->
                <select v-model="tokenStatus" @change="tokenPage=1; fetchTokens()"
                    class="appearance-none bg-black/20 border border-white/10 pl-3 pr-8 py-1.5 text-purple-300 font-bold text-xs focus:outline-none focus:border-purple-500 cursor-pointer hover:bg-white/5 rounded-lg transition-all">
                    <option value="">📋 全部</option>
                    <option value="DUPLICATE">🔁 重复邮箱</option>
                </select>
                <select v-model="poolFilter" @change="tokenPage=1; fetchTokens()"
                    class="appearance-none bg-black/20 border border-white/10 pl-3 pr-8 py-1.5 text-purple-300 font-bold text-xs focus:outline-none focus:border-purple-500 cursor-pointer hover:bg-white/5 rounded-lg transition-all">
                    <option value="">池: 全部</option>
                    <option value="Normal">池: Normal</option>
                    <option value="Pro">池: Pro</option>
                </select>
                <div class="text-xs text-purple-300/70">第 {{ tokenPage }} / {{ tokenPageCount }} 页</div>
                <button @click="prevTokenPage" :disabled="tokenPage<=1" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold"><</button>
                <button @click="nextTokenPage" :disabled="tokenPage>=tokenPageCount" class="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 rounded-lg text-white text-xs font-bold">></button>
                <button @click="fetchTokens" class="px-4 py-2 bg-purple-600/50 hover:bg-purple-600/70 rounded-xl text-white text-xs md:text-sm font-bold transition-all flex items-center justify-center gap-2">
                <span :class="{ 'animate-spin': loadingTokens }">&#8635;</span> 刷新
                </button>
                <button @click="refreshQuotas" class="px-4 py-2 bg-indigo-600/50 hover:bg-indigo-600/70 rounded-xl text-white text-xs md:text-sm font-bold transition-all">刷新额度缓存</button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="text-left border-b border-purple-500/20 bg-purple-900/20">
                  <th @click="handleSort('id')" class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider cursor-pointer hover:text-purple-200 select-none">
                    ID <span v-if="tokenSortBy === 'id'">{{ tokenOrder === 'asc' ? '↑' : '↓' }}</span>
                  </th>
                  <th class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider">邮箱</th>
                  <th class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider hidden md:table-cell">上传者</th>
                  <th @click="handleSort('total_used')" class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider cursor-pointer hover:text-purple-200 select-none">
                    次数 <span v-if="tokenSortBy === 'total_used'">{{ tokenOrder === 'asc' ? '↑' : '↓' }}</span>
                  </th>
                  <th class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider hidden md:table-cell">状态</th>
                  <th class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs font-black text-purple-300/70 uppercase tracking-wider text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-purple-500/10">
                <tr v-if="tokens.length === 0">
                  <td colspan="4" class="px-6 py-12 text-center text-purple-300/50">
                    <div class="text-3xl md:text-4xl mb-2">&#127756;</div>
                    <div class="text-sm md:text-base">暂无 Token</div>
                  </td>
                </tr>
                <tr v-for="token in tokens" :key="token.id" class="hover:bg-purple-500/10 transition-colors group">
                  <td class="px-4 md:px-6 py-3 md:py-4">
                    <span class="px-2 py-1 bg-purple-500/20 rounded text-purple-300 font-mono text-xs md:text-sm">#{{ token.id }}</span>
                  </td>
                  <td class="px-4 md:px-6 py-3 md:py-4 text-white text-xs md:text-sm truncate max-w-[120px] md:max-w-[200px]">
                    {{ token.email || '未知邮箱' }}
                  </td>
                  <!-- Owner column with Discord info -->
                  <td class="px-4 md:px-6 py-3 md:py-4 hidden md:table-cell">
                    <div class="flex items-center gap-2">
                      <img v-if="token.owner_discord_avatar" 
                           :src="`https://cdn.discordapp.com/avatars/${token.owner_discord_id}/${token.owner_discord_avatar}.png?size=32`"
                           class="w-6 h-6 rounded-full border border-white/10 shadow-sm" />
                      <div v-else class="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-[10px] text-white font-bold">
                        {{ token.owner_email?.[0]?.toUpperCase() || '?' }}
                      </div>
                      <div class="flex flex-col">
                        <span v-if="token.owner_discord_username" class="text-xs font-medium text-purple-200">{{ token.owner_discord_username }}</span>
                        <span class="text-[10px] text-purple-300/60 font-mono">{{ token.owner_email || '未知' }}</span>
                        <span v-if="token.owner_discord_id" class="text-[9px] text-purple-300/40 font-mono">ID: {{ token.owner_discord_id }}</span>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 md:px-6 py-3 md:py-4 text-purple-300 text-xs md:text-sm">
                    {{ token.total_used || 0 }}
                  </td>
                  <td class="px-4 md:px-6 py-3 md:py-4 hidden md:table-cell">
                    <div class="flex items-center gap-2">
                      <span v-if="token.is_enabled" class="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-bold inline-flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span> 已启用
                      </span>
                      <span v-else class="px-3 py-1 bg-gray-500/20 text-gray-400 rounded-full text-xs font-bold">已禁用</span>
                      <span v-if="token.status==='ACTIVE'" class="px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-bold">活跃</span>
                      <span v-else-if="token.status==='COOLING'" class="px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-bold">冷却中</span>
                      <span v-else class="px-3 py-1 bg-gray-500/20 text-gray-300 rounded-full text-xs font-bold">失效</span>
                      <span v-if="token.classification" class="px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-xs font-bold">{{ token.classification }}</span>
                      <span v-if="typeof token.remaining==='number'" class="px-3 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-xs font-bold">{{ (token.remaining*100).toFixed(0) }}%</span>
                    </div>
                  </td>
                  <td class="px-4 md:px-6 py-3 md:py-4 text-right">
                    <div class="flex items-center justify-end gap-2 opacity-70 md:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button @click="toggleToken(token)"
                        class="w-8 h-8 rounded-lg flex items-center justify-center transition-all text-sm md:text-base"
                        :class="token.is_enabled ? 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-400' : 'bg-green-500/20 hover:bg-green-500/40 text-green-400'"
                        :title="token.is_enabled ? 'Disable' : 'Enable'">
                        {{ token.is_enabled ? '&#9208;' : '&#9654;' }}
                      </button>
                      <button @click="deleteToken(token)"
                        class="w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 flex items-center justify-center transition-all text-sm md:text-base"
                        title="Delete">
                        &#128465;
                      </button>
                      <button @click="openQuotaModal(token)"
                        class="px-3 h-8 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 flex items-center justify-center transition-all text-xs font-bold"
                        title="查看额度">
                        额度
                      </button>
                      <button @click="forceRefreshQuota(token)"
                        class="px-3 h-8 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 flex items-center justify-center transition-all text-xs font-bold"
                        title="强制刷新额度">
                        刷新额度
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-if="quotaModalVisible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div class="w-[90%] max-w-[720px] bg-white/5 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-4 md:p-6">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span v-if="quotaData?.classification==='Pro'" class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold">Pro</span>
              <span v-else class="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold">Normal</span>
              <span class="text-xs text-indigo-200/80">{{ quotaData?.window_label || '' }}</span>
            </div>
            <div class="text-[10px] md:text-xs text-indigo-200/70" v-if="quotaData?.meta">
              {{ quotaData?.meta?.from_cache ? '缓存' : '实时' }} · {{ new Date(quotaData?.meta?.fetched_at).toLocaleString() }}
            </div>
            <button @click="closeQuotaModal" class="px-3 py-1 rounded-lg bg-white/10 text-white text-xs">关闭</button>
          </div>
          <div v-if="quotaLoading" class="text-center text-indigo-200 py-6">
            <span class="animate-spin">&#9881;</span>
          </div>
          <div v-else-if="quotaError" class="text-center text-red-300 py-4">{{ quotaError }}</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="text-left border-b border-indigo-500/20">
                  <th class="px-3 py-2 text-[10px] md:text-xs text-indigo-200/80">模型ID</th>
                  <th class="px-3 py-2 text-[10px] md:text-xs text-indigo-200/80">剩余(%)</th>
                  <th class="px-3 py-2 text-[10px] md:text-xs text-indigo-200/80">重置时间</th>
                  <th class="px-3 py-2 text-[10px] md:text-xs text-indigo-200/80">距重置(小时)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in quotaData?.models || []" :key="m.model_id" class="border-b border-white/5">
                  <td class="px-3 py-2 text-white text-xs md:text-sm truncate">{{ m.model_id }}</td>
                  <td class="px-3 py-2 text-indigo-100 text-xs md:text-sm">{{ ((m.remaining || 0) * 100).toFixed(1) }}</td>
                  <td class="px-3 py-2 text-indigo-100 text-xs md:text-sm">{{ m.reset_time ? new Date(m.reset_time).toLocaleString() : '未知' }}</td>
                  <td class="px-3 py-2 text-indigo-100 text-xs md:text-sm">{{ m.hours_to_reset ? m.hours_to_reset.toFixed(1) : '未知' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { api } from '@/utils/api';

const props = defineProps<{ isAdmin?: boolean; initialExpandOAuth?: boolean }>();
const isAdmin = computed(() => props.isAdmin ?? false);

const oauthUrl = ref('');
const oauthPort = ref<number | null>(null);
const authCode = ref('');
const loadingUrl = ref(false);
const submitting = ref(false);
const copied = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const skipProjectId = ref(false);
const isOAuthExpanded = ref(true);

watch(() => props.initialExpandOAuth, (newVal) => {
    if (newVal) {
        isOAuthExpanded.value = true;
        // Scroll to OAuth card
        setTimeout(() => {
            const el = document.getElementById('oauth-card');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
});

const uploadMode = ref<'oauth' | 'local'>('oauth');
const fileInput = ref<HTMLInputElement | null>(null);
const localJsonContent = ref('');
const localFileName = ref('');

const myTokens = ref<any[]>([]);
const loadingMyTokens = ref(false);
const page = ref(1);
const limit = ref(10);
const total = ref(0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

const tokens = ref<any[]>([]);
const tokenPage = ref(1);
const tokenLimit = ref(10);
const tokenTotal = ref(0);
const tokenPageCount = computed(() => Math.max(1, Math.ceil(tokenTotal.value / tokenLimit.value)));
const tokenSortBy = ref('id');
const tokenOrder = ref<'asc' | 'desc'>('asc');
const tokenStatus = ref('');
const poolFilter = ref('');

const stats = ref({ total: 0, active: 0, inactive: 0, total_capacity: 0, personal_max_usage: 0 });
const agOverview = ref<any | null>(null);
const agConfig = ref<any | null>(null);
const poolsOverview = ref<any | null>(null);
const loadingTokens = ref(false);
const refreshing = ref(false);
// agStrictMode 和 togglingStrict 已移至【管理设置】页面

// Usage Dashboard removed

const starStyle = (i: number) => {
  const size = Math.random() * 3 + 1;
  return {
    width: `${size}px`,
    height: `${size}px`,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 3}s`,
    animationDuration: `${2 + Math.random() * 3}s`
  };
};

const getOAuthUrl = async () => {
  loadingUrl.value = true;
  message.value = '';
  try {
    const res = await api.get('/antigravity/oauth/url');
    oauthUrl.value = res.data.url;
    oauthPort.value = res.data.port;
  } catch (e: any) {
    message.value = ' 失败: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    loadingUrl.value = false;
  }
};

const copyUrl = async () => {
  try {
    await navigator.clipboard.writeText(oauthUrl.value);
    copied.value = true;
    setTimeout(() => copied.value = false, 2000);
  } catch (e) {
    const input = document.createElement('input');
    input.value = oauthUrl.value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    copied.value = true;
    setTimeout(() => copied.value = false, 2000);
  }
};

const submitAuthCode = async () => {
  if (!authCode.value) return;
  submitting.value = true;
  uploadMode.value = 'oauth';
  message.value = '';
  try {
    // Extract code and port from callback URL
    let code = authCode.value;
    let port = oauthPort.value;
    
    // If user pasted full URL, extract code and port
    if (authCode.value.includes('code=')) {
      try {
        const url = new URL(authCode.value);
        code = url.searchParams.get('code') || authCode.value;
        // Extract port from URL - use url.port directly or parse from origin
        const portMatch = url.origin.match(/:(\d+)/);
        const urlPort = url.port || (portMatch ? portMatch[1] : null);
        if (urlPort) port = parseInt(urlPort);
      } catch (e) {
        // Not a valid URL, use as-is
      }
    }
    
    if (!port) {
      message.value = 'Please get OAuth URL first';
      messageType.value = 'error';
      submitting.value = false;
      return;
    }
    
    const res = await api.post('/antigravity/oauth/exchange', { code, port, skip_project_id: skipProjectId.value });
    message.value = ' 添加成功！ ' + (res.data.token?.email ? '邮箱: ' + res.data.token.email : '');
    messageType.value = 'success';
    authCode.value = '';
    oauthUrl.value = '';
    fetchMyTokens();
    if (isAdmin.value) fetchTokens();
  } catch (e: any) {
    message.value = 'Failed: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    submitting.value = false;
  }
};

const handleFileChange = async (e: Event) => {
  localJsonContent.value = '';
  localFileName.value = '';
  const target = e.target as HTMLInputElement;
  const file = target.files && target.files[0];
  if (!file) return;
  localFileName.value = file.name;
  try {
    const text = await file.text();
    localJsonContent.value = text;
  } catch (err: any) {
    message.value = '读取文件失败: ' + err.message;
    messageType.value = 'error';
  }
};

const uploadLocalCredential = async () => {
  if (!localJsonContent.value) return;
  submitting.value = true;
  uploadMode.value = 'local';
  message.value = '';
  try {
    const res = await api.post('/antigravity/upload-local', {
      json_content: localJsonContent.value,
      skip_project_id: skipProjectId.value
    });
    message.value = '🚀 反重力凭证上传成功！';
    messageType.value = 'success';
    localJsonContent.value = '';
    localFileName.value = '';
    if (fileInput.value) {
      fileInput.value.value = '';
    }
    // 刷新凭证列表
    fetchMyTokens();
  } catch (e: any) {
    message.value = '本地上传失败: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    submitting.value = false;
    uploadMode.value = 'oauth';
  }
};

const fetchMyTokens = async () => {
  loadingMyTokens.value = true;
  try {
    const res = await api.get('/antigravity/my-tokens', { params: { page: page.value, limit: limit.value } });
    myTokens.value = res.data.tokens || [];
    total.value = res.data.total || 0;
    // Auto-collapse if user has tokens
    if (myTokens.value.length > 0) {
        isOAuthExpanded.value = false;
    }
  } catch (e) {
  } finally {
    loadingMyTokens.value = false;
  }
};

const prevPage = () => { if (page.value > 1) { page.value -= 1; fetchMyTokens(); } };
const nextPage = () => { if (page.value < pageCount.value) { page.value += 1; fetchMyTokens(); } };

const toggleMyToken = async (t: any) => {
  try {
    await api.put(`/antigravity/my-tokens/${t.id}`, { is_enabled: !t.is_enabled });
    t.is_enabled = !t.is_enabled;
  } catch (e: any) {
    alert('操作失败: ' + (e.response?.data?.error || e.message));
  }
};

const deleteMyToken = async (t: any) => {
  const created = t.created_at ? new Date(t.created_at).toLocaleString() : '';
  const email = t.email || '未知邮箱';
  const msg = `确认删除凭证 #${t.id}\n邮箱：${email}\n创建时间：${created}\n此操作不可恢复，继续吗？`;
  if (!confirm(msg)) return;
  try {
    await api.delete(`/antigravity/my-tokens/${t.id}`);
    fetchMyTokens();
  } catch (e: any) {
    alert('删除失败: ' + (e.response?.data?.error || e.message));
  }
};

const fetchTokens = async () => {
  if (!isAdmin.value) return;
  loadingTokens.value = true;
  try {
    const res = await api.get('/antigravity/tokens', {
        params: {
            page: tokenPage.value,
            limit: tokenLimit.value,
            sort_by: tokenSortBy.value,
            order: tokenOrder.value,
            status: tokenStatus.value || undefined,
            pool: poolFilter.value || undefined
        }
    });
    tokens.value = res.data.tokens || [];
    tokenTotal.value = res.data.meta?.total || 0;
    stats.value = res.data.stats || { total: 0, active: 0, inactive: 0 };
  } catch (e) {
    console.error('Failed to fetch tokens', e);
  } finally {
    loadingTokens.value = false;
  }
};

const prevTokenPage = () => { if (tokenPage.value > 1) { tokenPage.value -= 1; fetchTokens(); } };
const nextTokenPage = () => { if (tokenPage.value < tokenPageCount.value) { tokenPage.value += 1; fetchTokens(); } };

const handleSort = (field: string) => {
    if (tokenSortBy.value === field) {
        tokenOrder.value = tokenOrder.value === 'asc' ? 'desc' : 'asc';
    } else {
        tokenSortBy.value = field;
        tokenOrder.value = 'desc'; // Default to desc for new field (usually usage)
    }
    fetchTokens();
};

const fetchAgOverview = async () => {
  if (!isAdmin.value) return;
  try {
    const res = await api.get('/antigravity/stats');
    agOverview.value = res.data;
  } catch (e) {
    console.error('Failed to fetch antigravity stats', e);
  }
};

const fetchAgConfig = async () => {
  if (!isAdmin.value) return;
  try {
    const res = await api.get('/antigravity/config');
    agConfig.value = res.data;
  } catch (e) {
  }
};

// 严格模式已移至【管理设置】页面统一管理

// Usage Dashboard removed

const toggleToken = async (token: any) => {
  try {
    await api.put(`/antigravity/tokens/${token.id}`, { is_enabled: !token.is_enabled });
    token.is_enabled = !token.is_enabled;
    fetchTokens();
  } catch (e: any) {
    alert('Failed: ' + (e.response?.data?.error || e.message));
  }
};

const deleteToken = async (token: any) => {
  const created = token.created_at ? new Date(token.created_at).toLocaleString() : '';
  const email = token.email || '未知邮箱';
  const msg = `确认删除凭证 #${token.id}\n邮箱：${email}\n创建时间：${created}\n此操作不可恢复，继续吗？`;
  if (!confirm(msg)) return;
  try {
    await api.delete(`/antigravity/tokens/${token.id}`);
    fetchTokens();
  } catch (e: any) {
    alert('删除失败: ' + (e.response?.data?.error || e.message));
  }
};

const quotaModalVisible = ref(false);
const quotaLoading = ref(false);
const quotaError = ref('');
const quotaData = ref<any | null>(null);
const openQuotaModal = async (token: any) => {
  quotaError.value = '';
  quotaData.value = null;
  quotaLoading.value = true;
  try {
    const res = await api.get(`/antigravity/tokens/${token.id}/quotas`);
    quotaData.value = res.data;
    token._quota_class = res.data.classification;
    quotaModalVisible.value = true;
  } catch (e: any) {
    quotaError.value = e.response?.data?.error || e.message;
    quotaModalVisible.value = true;
  } finally {
    quotaLoading.value = false;
  }
};
const closeQuotaModal = () => { quotaModalVisible.value = false; };
const refreshQuotas = async () => {
  try {
    await api.get('/antigravity/quotas/refresh');
    fetchTokens();
    fetchPoolsOverview();
  } catch (e) {}
};
const forceRefreshQuota = async (token: any) => {
  quotaError.value = '';
  quotaData.value = null;
  quotaLoading.value = true;
  try {
    const res = await api.get(`/antigravity/tokens/${token.id}/quotas`, { params: { force: true } });
    quotaData.value = res.data;
    token._quota_class = res.data.classification;
    quotaModalVisible.value = true;
  } catch (e: any) {
    quotaError.value = e.response?.data?.error || e.message;
    quotaModalVisible.value = true;
  } finally {
    quotaLoading.value = false;
  }
};
const fetchPoolsOverview = async () => {
  if (!isAdmin.value) return;
  try {
    const res = await api.get('/antigravity/pools/overview');
    poolsOverview.value = res.data;
  } catch (e) {}
};
const refreshAllTokens = async () => {
  refreshing.value = true;
  try {
    await api.post('/antigravity/refresh-all');
    message.value = ' 所有 Token 已刷新';
    messageType.value = 'success';
    fetchTokens();
    fetchAgOverview();
    fetchAgConfig();
  } catch (e: any) {
    message.value = ' 刷新失败: ' + (e.response?.data?.error || e.message);
    messageType.value = 'error';
  } finally {
    refreshing.value = false;
  }
};

const isTokenMode = computed(() => {
  if (agConfig.value && typeof agConfig.value.use_token_quota !== 'undefined') {
    return !!agConfig.value.use_token_quota;
  }
  return !!agOverview.value?.meta?.limits?.use_token_quota;
});

const formatNumber = (num: number) => {
    if (!isTokenMode.value) return num;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num;
};

onMounted(() => {
  fetchMyTokens();
  if (isAdmin.value) {
    fetchTokens();
    fetchAgOverview();
    fetchAgConfig();
    fetchPoolsOverview();
    const interval = setInterval(fetchPoolsOverview, 60000);
    (window as any).__agPoolsInterval = interval;
  }
});
onUnmounted(() => {
  const interval = (window as any).__agPoolsInterval;
  if (interval) {
    clearInterval(interval);
    (window as any).__agPoolsInterval = null;
  }
});
</script>

<style scoped>
.star { animation: twinkle 3s infinite alternate; }
@keyframes twinkle { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }

.meteor { position: absolute; width: 2px; height: 80px; background: linear-gradient(to bottom, rgba(255,255,255,0.8), transparent); transform: rotate(45deg); animation: meteor 3s linear infinite; }
.meteor-1 { top: 10%; left: 20%; animation-delay: 0s; }
.meteor-2 { top: 30%; left: 60%; animation-delay: 1s; }
.meteor-3 { top: 5%; left: 80%; animation-delay: 2s; }
@keyframes meteor { 0% { transform: translateX(-100px) translateY(-100px) rotate(45deg); opacity: 1; } 70% { opacity: 1; } 100% { transform: translateX(300px) translateY(300px) rotate(45deg); opacity: 0; } }

.nebula { position: absolute; border-radius: 50%; filter: blur(60px); animation: nebula-drift 20s infinite alternate; }
.nebula-1 { width: 300px; height: 300px; background: radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent); top: -50px; right: -50px; }
.nebula-2 { width: 400px; height: 400px; background: radial-gradient(circle, rgba(236, 72, 153, 0.2), transparent); bottom: -100px; left: -100px; animation-delay: -10s; }
@keyframes nebula-drift { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(30px, 30px) scale(1.1); } }

.orbit { position: absolute; border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 50%; animation: orbit-rotate 30s linear infinite; }
.orbit-1 { width: 500px; height: 500px; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.orbit-2 { width: 700px; height: 700px; top: 50%; left: 50%; transform: translate(-50%, -50%); animation-direction: reverse; animation-duration: 40s; }
@keyframes orbit-rotate { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }

.glow-card { box-shadow: 0 0 30px rgba(139, 92, 246, 0.1), inset 0 0 30px rgba(139, 92, 246, 0.05); }
.glow-card:hover { box-shadow: 0 0 50px rgba(139, 92, 246, 0.2), inset 0 0 50px rgba(139, 92, 246, 0.1); }
.neon-text { text-shadow: 0 0 10px rgba(192, 132, 252, 0.8), 0 0 20px rgba(192, 132, 252, 0.5); }

.pulse-ring { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4); animation: pulse-ring 2s infinite; }
.pulse-ring-cyan { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); animation: pulse-ring-cyan 2s infinite; }
@keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(168, 85, 247, 0); } 100% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0); } }
@keyframes pulse-ring-cyan { 0% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(34, 211, 238, 0); } 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); } }

.neon-button { box-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
.neon-button:hover { box-shadow: 0 0 30px rgba(168, 85, 247, 0.6); }
.neon-button-cyan { box-shadow: 0 0 20px rgba(34, 211, 238, 0.4); }
.neon-button-cyan:hover { box-shadow: 0 0 30px rgba(34, 211, 238, 0.6); }

.stat-card { transition: all 0.3s ease; }
.stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
.animate-pulse-slow { animation: pulse 3s infinite; }
.animate-bounce-slow { animation: bounce 2s infinite; }
.animate-fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.step-card { transition: all 0.3s ease; }
.step-card:hover { transform: translateY(-3px); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); }
</style>
