<script setup>
defineProps({
  open: { type: Boolean, default: false },
  display: { type: String, default: '0' },
  history: { type: String, default: '' },
});

const emit = defineEmits([
  'close',
  'clear',
  'toggle-sign',
  'percent',
  'operator',
  'digit',
  'backspace',
  'decimal',
  'equals',
]);
</script>

<template>
  <div v-if="open" class="calculator-overlay" role="dialog" aria-label="Calculator">
    <section class="calculator-panel">
      <header>
        <strong>Calculator</strong>
        <button class="icon" type="button" @click="emit('close')">Close</button>
      </header>
      <div class="calculator-display">
        <span>{{ history }}</span>
        <strong>{{ display }}</strong>
      </div>
      <div class="calculator-keys">
        <button type="button" class="utility" @click="emit('clear')">C</button>
        <button type="button" class="utility" @click="emit('toggle-sign')">+/-</button>
        <button type="button" class="utility" @click="emit('percent')">%</button>
        <button type="button" class="operator" @click="emit('operator', '/')">/</button>
        <button v-for="digit in [7, 8, 9]" :key="digit" type="button" @click="emit('digit', digit)">{{ digit }}</button>
        <button type="button" class="operator" @click="emit('operator', '*')">x</button>
        <button v-for="digit in [4, 5, 6]" :key="digit" type="button" @click="emit('digit', digit)">{{ digit }}</button>
        <button type="button" class="operator" @click="emit('operator', '-')">-</button>
        <button v-for="digit in [1, 2, 3]" :key="digit" type="button" @click="emit('digit', digit)">{{ digit }}</button>
        <button type="button" class="operator" @click="emit('operator', '+')">+</button>
        <button type="button" @click="emit('backspace')">Del</button>
        <button type="button" @click="emit('digit', 0)">0</button>
        <button type="button" @click="emit('decimal')">.</button>
        <button type="button" class="equals" @click="emit('equals')">=</button>
      </div>
    </section>
  </div>
</template>
