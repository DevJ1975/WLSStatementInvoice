<script setup>
defineProps({
  open: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] },
  input: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'update:input', 'submit']);
</script>

<template>
  <aside v-if="open" class="ai-chat-drawer" role="dialog" aria-label="Julie report assistant">
    <header>
      <div class="julie-title">
        <span class="julie-avatar" aria-hidden="true"><i></i></span>
        <div>
          <strong>Julie</strong>
          <span>Julie reviews this WLS report with Claude. You approve all changes.</span>
        </div>
      </div>
      <button class="secondary" type="button" @click="emit('close')">Close</button>
    </header>
    <div class="ai-chat-messages">
      <p
        v-for="(message, index) in messages"
        :key="`${message.role}-${index}`"
        :class="message.role"
      >
        {{ message.content }}
      </p>
    </div>
    <form class="ai-chat-form" @submit.prevent="emit('submit')">
      <label class="field-group">
        <span class="field-label">Ask Julie About This Report</span>
        <textarea
          :value="input"
          rows="3"
          placeholder="Ask Julie to check errors, totals, mileage, receipts, or readiness..."
          spellcheck="true"
          @input="emit('update:input', $event.target.value)"
        ></textarea>
      </label>
      <button type="submit" :disabled="loading || !input.trim()">
        <span v-if="loading" class="loading-spinner small" aria-hidden="true"></span>
        {{ loading ? 'Asking Julie...' : 'Ask Julie' }}
      </button>
    </form>
  </aside>
</template>
