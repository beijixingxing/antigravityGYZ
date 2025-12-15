<template>
  <div class="relative flex flex-col items-center justify-center">
    <!-- SVG Gauge -->
    <svg viewBox="0 0 200 120" class="w-full h-full overflow-visible">
      <!-- Track (Background Arc) -->
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" :stroke="trackColor" stroke-width="20" stroke-linecap="round" />
      
      <!-- Progress Arc -->
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" :stroke="progressColor" stroke-width="20" stroke-linecap="round" 
            :stroke-dasharray="dashArray" :stroke-dashoffset="dashOffset" 
            class="transition-all duration-1000 ease-out" />
    </svg>

    <!-- Content inside -->
    <div class="absolute bottom-0 text-center transform translate-y-4">
      <div class="text-4xl font-black" :class="textColor">{{ current }}</div>
      <div class="text-xs font-bold uppercase tracking-widest opacity-60">/ {{ max }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  current: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  trackColor: { type: String, default: 'rgba(0,0,0,0.1)' },
  progressColor: { type: String, default: '#064e3b' }, // emerald-950
  textColor: { type: String, default: 'text-emerald-950' }
});

// Arc length for radius 80 semicircle is PI * 80 ≈ 251.3
const ARC_LENGTH = 251.3;
const dashArray = ARC_LENGTH;

const dashOffset = computed(() => {
  const percentage = Math.min(props.current / props.max, 1);
  // Stroke-dashoffset: The amount to hide. 
  // 0 = full show, ARC_LENGTH = full hide.
  // We want to show 'percentage', so we hide (1 - percentage).
  return ARC_LENGTH * (1 - percentage);
});
</script>
