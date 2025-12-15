<template>
  <div class="pointer-events-none fixed inset-0 z-[9999] overflow-hidden hidden md:block">
    <!-- 1. 跟随鼠标的粉色圆圈 -->
    <div 
      class="absolute w-8 h-8 border-2 border-pink-400/60 rounded-full -translate-x-1/2 -translate-y-1/2 transition-transform duration-75 ease-out will-change-transform"
      :style="{ left: mouseX + 'px', top: mouseY + 'px' }"
    ></div>

    <!-- 2. 爱心粒子 -->
    <div 
      v-for="p in particles" 
      :key="p.id"
      class="absolute text-[10px] select-none"
      :style="{ 
        left: p.x + 'px', 
        top: p.y + 'px', 
        opacity: p.life,
        transform: `scale(${p.life}) translateY(${p.offsetY}px)` 
      }"
    >
      ❤️
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

// 鼠标位置
const mouseX = ref(-100);
const mouseY = ref(-100);

// 粒子系统
interface Particle {
  id: number;
  x: number;
  y: number;
  life: number;
  offsetY: number;
}
const particles = ref<Particle[]>([]);
let particleIdCounter = 0;
let lastEmitX = 0;
let lastEmitY = 0;

// 配置
const EMIT_DISTANCE = 30; // 移动多少像素发射一颗心 (控制密度)

const handleMouseMove = (e: MouseEvent) => {
  mouseX.value = e.clientX;
  mouseY.value = e.clientY;

  // 计算距离
  const dist = Math.hypot(e.clientX - lastEmitX, e.clientY - lastEmitY);
  
  // 只有移动了一定距离才发射，防止静止时产生堆积，也控制了生成速度
  if (dist > EMIT_DISTANCE) {
    createParticle(e.clientX, e.clientY);
    lastEmitX = e.clientX;
    lastEmitY = e.clientY;
  }
};

const createParticle = (x: number, y: number) => {
  // 稍微随机一点偏移
  const offsetX = (Math.random() - 0.5) * 10; 
  particles.value.push({
    id: particleIdCounter++,
    x: x + offsetX,
    y: y,
    life: 1.0,
    offsetY: 0
  });
  
  // 限制粒子总数防止卡顿
  if (particles.value.length > 20) {
    particles.value.shift();
  }
};

// 动画循环
let animationFrame: number;
const loop = () => {
  // 更新粒子状态
  for (let i = particles.value.length - 1; i >= 0; i--) {
    const p = particles.value[i];
    p.life -= 0.02; // 慢慢消失
    p.offsetY -= 1; // 向上漂浮
    
    if (p.life <= 0) {
      particles.value.splice(i, 1);
    }
  }
  animationFrame = requestAnimationFrame(loop);
};

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove);
  loop();
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  cancelAnimationFrame(animationFrame);
});
</script>
