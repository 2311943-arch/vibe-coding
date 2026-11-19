<script setup lang="ts">
// 화면 2: 분석 진행. 서버가 내려 준 실제 상태(status/stage)만 보여 준다. 퍼센트 진행률은 쓰지 않는다.
useHead({ title: '분석 중 · 기타 영상 악보 변환' })

const route = useRoute()
const jobId = computed(() => String(route.params.id))

type View = 'loading' | 'running' | 'failed' | 'missing'
const view = ref<View>('loading')
const status = ref<AnalysisStatusResponse | null>(null)
const pollError = ref(false)
const retrying = ref(false)
const retryError = ref<string | null>(null)
let access: JobAccess | null = null

const POLL_MS = 1500
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false
let failures = 0

async function poll() {
  if (stopped || !access) return
  try {
    const res = await $fetch<AnalysisStatusResponse>(`/api/analyses/${jobId.value}`, {
      query: { token: access.token },
    })
    failures = 0
    pollError.value = false
    status.value = res

    if (res.status === 'COMPLETED' || res.status === 'PARTIAL') {
      stopped = true
      await navigateTo(`/analyses/${jobId.value}/result`, { replace: true })
      return
    }
    if (res.status === 'FAILED') {
      stopped = true
      view.value = 'failed'
      return
    }
    view.value = 'running'
  } catch (err: any) {
    if (err?.statusCode === 404) {
      stopped = true
      view.value = 'missing'
      return
    }
    // 일시적인 네트워크 오류는 상태를 바꾸지 않고 다시 시도한다.
    failures += 1
    pollError.value = failures >= 2
  }
  if (!stopped) timer = setTimeout(poll, failures ? POLL_MS * 2 : POLL_MS)
}

onMounted(() => {
  access = loadJobAccess(jobId.value)
  if (!access) {
    view.value = 'missing'
    return
  }
  poll()
})

onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})

const currentIndex = computed(() =>
  status.value ? PIPELINE_STAGES.findIndex((s) => s.status === status.value!.status) : -1,
)

function stepState(i: number): 'done' | 'current' | 'pending' {
  if (currentIndex.value < 0) return 'pending'
  if (i < currentIndex.value) return 'done'
  return i === currentIndex.value ? 'current' : 'pending'
}

const failure = computed(() => errorMessageFor(status.value?.error_code ?? null))

async function retrySameLink() {
  if (!access) return
  retrying.value = true
  retryError.value = null
  try {
    const newId = await startAnalysis(access.sourceUrl)
    await navigateTo(`/analyses/${newId}`, { replace: true })
  } catch (err) {
    retryError.value = (err as Error).message
    retrying.value = false
  }
}
</script>

<template>
  <div class="narrow">
    <!-- 불러오는 중 -->
    <div v-if="view === 'loading'" class="card" aria-busy="true">
      <p class="text-muted">작업 정보를 불러오는 중…</p>
    </div>

    <!-- 진행 중 -->
    <section v-else-if="view === 'running'" aria-labelledby="progress-title">
      <h1 id="progress-title">악보를 만들고 있어요</h1>
      <p class="sub text-muted">
        이 화면을 열어 두면 끝나는 대로 결과 화면으로 넘어가요. 영상 길이에 따라 몇 분 걸릴 수 있어요.
      </p>

      <div class="card">
        <p class="now" aria-live="polite">
          <span class="pulse" aria-hidden="true" />
          {{ status?.stage }}
        </p>
        <hr class="divider" />
        <ol class="stages">
          <li v-for="(stage, i) in PIPELINE_STAGES" :key="stage.status" :class="['stage', stepState(i)]">
            <span class="dot" aria-hidden="true">
              <svg v-if="stepState(i) === 'done'" viewBox="0 0 16 16" width="12" height="12">
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>{{ stage.label }}</span>
            <span class="sr-only">
              {{ stepState(i) === 'done' ? '(완료)' : stepState(i) === 'current' ? '(진행 중)' : '(대기)' }}
            </span>
          </li>
        </ol>
      </div>

      <p v-if="pollError" class="text-sm text-muted note" role="status">
        서버와 연결이 잠시 끊겼어요. 계속 다시 확인하고 있어요.
      </p>
    </section>

    <!-- 실패 -->
    <section v-else-if="view === 'failed'" aria-labelledby="fail-title">
      <div class="card">
        <span class="badge">분석 실패</span>
        <h1 id="fail-title" class="title">{{ failure.title }}</h1>
        <p class="body-text">{{ failure.hint }}</p>
        <div class="actions">
          <NuxtLink to="/" class="btn btn-primary">다른 링크로 시도</NuxtLink>
          <button class="btn btn-secondary" type="button" :disabled="retrying" @click="retrySameLink">
            {{ retrying ? '다시 요청 중…' : '같은 링크로 다시 시도' }}
          </button>
        </div>
        <p v-if="retryError" class="text-sm error" role="alert">{{ retryError }}</p>
      </div>
    </section>

    <!-- 작업 없음 / 만료 / 다른 브라우저 -->
    <section v-else aria-labelledby="missing-title">
      <div class="card">
        <h1 id="missing-title" class="title">분석 작업을 찾을 수 없어요</h1>
        <p class="body-text">
          결과는 1시간 뒤 삭제되고, 분석을 요청한 브라우저 탭에서만 볼 수 있어요. 링크를 다시 넣어 새로 분석해 주세요.
        </p>
        <div class="actions">
          <NuxtLink to="/" class="btn btn-primary">처음으로</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 560px;
  margin: 0 auto;
}

.sub {
  margin: 8px 0 24px;
}

.now {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
}

.pulse {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--ink);
  animation: pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
  }
}

.stages {
  list-style: none;
  margin: 24px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stage {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
}

.stage.pending {
  color: var(--muted-soft);
}

.stage.current {
  font-weight: 600;
}

.dot {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stage.done .dot {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--canvas);
}

.stage.current .dot {
  border: 2px solid var(--ink);
}

.note {
  margin-top: 16px;
}

.title {
  margin: 16px 0 8px;
}

.body-text {
  color: var(--body);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.error {
  color: var(--error);
  margin-top: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 743px) {
  .actions .btn {
    width: 100%;
  }
}
</style>
