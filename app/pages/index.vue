<script setup lang="ts">
// 화면 1: 링크 입력
useHead({ title: '기타 영상 악보 변환' })

const url = ref('')
const hasPermission = ref(false)
const fieldError = ref<string | null>(null)
const serverError = ref<string | null>(null)
const submitting = ref(false)

const canSubmit = computed(() => url.value.trim() !== '' && hasPermission.value && !submitting.value)

async function onSubmit() {
  fieldError.value = null
  serverError.value = null

  // 형식 오류는 서버에 보내기 전에 입력란 아래에 보여 준다.
  const checked = validateInstagramUrl(url.value)
  if (!checked.ok) {
    fieldError.value = checked.message
    return
  }
  if (!hasPermission.value) return

  submitting.value = true
  try {
    const jobId = await startAnalysis(checked.url)
    await navigateTo(`/analyses/${jobId}`)
  } catch (err) {
    serverError.value = (err as Error).message
    submitting.value = false
  }
}

const steps = [
  { title: '링크 붙여 넣기', body: '기타를 치며 노래하는 인스타그램 릴스 링크를 넣어 주세요.' },
  { title: '연주 분석', body: '오디오를 준비하고 음표와 코드를 찾아요. 진행 중인 단계를 그대로 보여 드려요.' },
  { title: '코드 + 추정 타브', body: '코드 진행과, 찾은 음을 기타로 칠 수 있게 배치한 타브를 함께 보여 드려요.' },
]
</script>

<template>
  <div class="page">
    <section class="hero">
      <h1>연주 영상을 코드 악보와 기타 타브로</h1>
      <p class="lead">
        따라 쳐 보고 싶은 기타 연주 영상의 링크를 넣으면, 코드 진행과 추정 타브를 만들어 드려요.
        로그인은 필요 없어요.
      </p>

      <form class="card form" novalidate @submit.prevent="onSubmit">
        <label for="source-url" class="label">인스타그램 영상 링크</label>
        <input
          id="source-url"
          v-model="url"
          class="input"
          :class="{ 'input-error': fieldError }"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://www.instagram.com/reel/..."
          :aria-invalid="fieldError ? 'true' : 'false'"
          :aria-describedby="fieldError ? 'source-url-error' : 'source-url-help'"
          @input="fieldError = null"
        />
        <p v-if="fieldError" id="source-url-error" class="text-sm error" role="alert">{{ fieldError }}</p>
        <p v-else id="source-url-help" class="text-sm text-muted">릴스(/reel/…) 또는 게시물(/p/…) 링크를 지원해요.</p>

        <label class="check">
          <input v-model="hasPermission" type="checkbox" />
          <span class="text-sm">이 영상을 분석에 사용할 권한이 있어요. (본인 영상이거나 허락을 받은 영상)</span>
        </label>

        <button class="btn btn-primary submit" type="submit" :disabled="!canSubmit">
          {{ submitting ? '분석 요청 중…' : '악보 만들기' }}
        </button>

        <div v-if="serverError" class="server-error" role="alert">
          <p class="server-error-title">분석을 시작하지 못했어요</p>
          <p class="text-sm">{{ serverError }}</p>
        </div>
      </form>
    </section>

    <section class="steps" aria-labelledby="how-title">
      <h2 id="how-title">이렇게 만들어져요</h2>
      <ol class="step-list">
        <li v-for="(step, i) in steps" :key="step.title" class="card step">
          <span class="step-no" aria-hidden="true">{{ i + 1 }}</span>
          <p class="step-title">{{ step.title }}</p>
          <p class="text-sm text-muted">{{ step.body }}</p>
        </li>
      </ol>
    </section>

    <section class="notes" aria-labelledby="notes-title">
      <h2 id="notes-title">미리 알아 두세요</h2>
      <ul class="note-list text-sm">
        <li>타브는 영상 속 연주자의 운지를 그대로 되살린 것이 아니에요. 찾은 음을 기타로 칠 수 있게 다시 배치한 <strong>추정 결과</strong>예요.</li>
        <li>소리가 겹치거나 확신하기 어려운 구간은 억지로 정하지 않고 <strong>미확정</strong> 또는 여러 후보로 보여 드려요.</li>
        <li>비공개·삭제된 영상이나 링크만으로 열 수 없는 영상은 분석할 수 없어요.</li>
        <li>분석 결과는 1시간 뒤 자동으로 삭제돼요.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 64px;
}

.hero {
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lead {
  color: var(--body);
}

.form {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 14px;
  font-weight: 500;
  color: var(--muted);
}

.input {
  height: 56px;
  width: 100%;
  padding: 0 16px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--canvas);
  color: var(--ink);
  font-size: 16px;
}

.input::placeholder {
  color: var(--muted);
}

.input:focus {
  outline: none;
  border: 2px solid var(--ink);
  padding: 0 15px;
}

.input-error {
  border-color: var(--error);
}

.error {
  color: var(--error);
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
  cursor: pointer;
  color: var(--body);
}

.check input {
  width: 18px;
  height: 18px;
  margin: 1px 0 0;
  accent-color: var(--ink);
  flex-shrink: 0;
}

.submit {
  margin-top: 16px;
  width: 100%;
}

.server-error {
  margin-top: 8px;
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--body);
}

.server-error-title {
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 4px;
}

.steps h2,
.notes h2 {
  margin-bottom: 16px;
}

.step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-no {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--surface-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.step-title {
  font-size: 16px;
  font-weight: 600;
}

.note-list {
  margin: 0;
  padding-left: 20px;
  color: var(--body);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 743px) {
  .page {
    gap: 48px;
  }
  .step-list {
    grid-template-columns: 1fr;
  }
}
</style>
