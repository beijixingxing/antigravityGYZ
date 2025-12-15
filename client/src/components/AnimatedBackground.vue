<template>
  <div class="fixed inset-0 z-[-1] overflow-hidden bg-gradient-to-b from-[#2A1B4B] to-[#1A1235]">
    <!-- 1. Base Background (Deep Blue Purple -> Indigo) -->
    
    <!-- 2. Flowing Blobs -->
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
    <div class="blob blob-4"></div>

    <!-- 3. Noise Texture -->
    <div class="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay" :style="{ backgroundImage: `url(${noiseSvg})` }"></div>
  </div>
</template>

<script setup lang="ts">
const noiseSvg = "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E";
</script>

<style scoped>
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.6;
  animation: float 20s infinite ease-in-out alternate;
}

.blob-1 {
  top: -10%;
  left: -10%;
  width: 50vw;
  height: 50vw;
  background: #4c1d95; /* Violet 900 */
  animation-delay: 0s;
}

.blob-2 {
  bottom: -10%;
  right: -10%;
  width: 60vw;
  height: 60vw;
  background: #312e81; /* Indigo 900 */
  animation-delay: -5s;
}

.blob-3 {
  top: 20%;
  right: 20%;
  width: 40vw;
  height: 40vw;
  background: #be185d; /* Pink 700 */
  opacity: 0.4;
  animation-delay: -10s;
}

.blob-4 {
  bottom: 20%;
  left: 20%;
  width: 35vw;
  height: 35vw;
  background: #0e7490; /* Cyan 700 */
  opacity: 0.4;
  animation-delay: -15s;
}

@keyframes float {
  0% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -50px) scale(1.1);
  }
  66% {
    transform: translate(-20px, 20px) scale(0.9);
  }
  100% {
    transform: translate(0, 0) scale(1);
  }
}
</style>