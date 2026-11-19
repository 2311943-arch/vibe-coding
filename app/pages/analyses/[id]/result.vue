<script setup lang="ts">
// 화면 3: 악보 결과. 코드 악보와 추정 타브를 같은 시간 눈금으로 정렬해 보여 준다.
useHead({ title: '악보 결과 · 기타 영상 악보 변환' })

const route = useRoute()
const jobId = computed(() => String(route.params.id))

type View = 'loading' | 'ready' | 'missing' | 'error'
const view = ref<View>('loading')
const result = ref<AnalysisResult | null>(null)
const sourceUrl = ref<string | null>(null)

/** 한 행에 담을 시간(초). 모바일에서는 가로 스크롤로 본다. */
const ROW_SECONDS = 8

async function load() {
  const access = loadJobAccess(jobId.value)
  if (!access) {
    view.value = 'missing'
    return
  }
  sourceUrl.value = access.sourceUrl
  view.value = 'loading'
  try {
    result.value = await $fetch<AnalysisResult>(`/api/analyses/${jobId.value}/result`, {
      query: { token: access.token },
    })
    view.value = 'ready'
  } catch (err: any) {
    if (err?.statusCode === 404) {
      view.value = 'missing'
    } else if (err?.statusCode === 409) {
      // 아직 끝나지 않았거나 실패한 작업이면 진행 화면이 상태를 안내한다.
      await navigateTo(`/analyses/${jobId.value}`, { replace: true })
    } else {
      view.value = 'error'
    }
  }
}

onMounted(load)

const hasTab = computed(() => (result.value?.tab.length ?? 0) > 0)

type Tab = 'sheet' | 'chords'
const activeTab = ref<Tab>('sheet')

const rows = computed(() =>
  result.value
    ? splitIntoRows(result.value.chords, result.value.tab, result.value.duration, ROW_SECONDS)
    : [],
)

const uncertain = computed(() => result.value?.quality.uncertain_segments ?? [])

/** 코드 진행 요약: 같은 코드가 연달아 나오면 한 번만 쓴다. */
const progression = computed(() => {
  const out: { name: string; unknown: boolean; candidates: boolean }[] = []
  for (const c of result.value?.chords ?? []) {
    const unknown = c.chord_name === 'UNKNOWN'
    const name = unknown ? '미확정' : c.chord_name
    if (out.at(-1)?.name === name) continue
    out.push({ name, unknown, candidates: c.alternatives.length > 0 })
  }
  return out
})

function isUncertain(c: ChordEvent) {
  return (
    c.chord_name === 'UNKNOWN' ||
    c.alternatives.length > 0 ||
    uncertain.value.some((s) => s.end_time > c.start_time && s.start_time < c.end_time)
  )
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const tabs: { id: Tab; label: string }[] = [
  { id: 'sheet', label: '코드 + 타브' },
  { id: 'chords', label: '코드 진행' },
]

function onTabKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const i = tabs.findIndex((t) => t.id === activeTab.value)
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!
  activeTab.value = next.id
  nextTick(() => document.getElementById(`tab-${next.id}`)?.focus())
}
</script>

<template>
  <div>
    <div v-if="view === 'loading'" class="card narrow" aria-busy="true">
      <p class="text-muted">악보를 불러오는 중…</p>
    </div>

    <section v-else-if="view === 'missing'" class="narrow">
      <div class="card">
        <h1 class="title">결과를 찾을 수 없어요</h1>
        <p class="body-text">
          결과는 1시간 뒤 삭제되고, 분석을 요청한 브라우저 탭에서만 볼 수 있어요. 링크를 다시 넣어 새로 분석해 주세요.
        </p>
        <div class="actions">
          <NuxtLink to="/" class="btn btn-primary">처음으로</NuxtLink>
        </div>
      </div>
    </section>

    <section v-else-if="view === 'error'" class="narrow">
      <div class="card">
        <h1 class="title">결과를 불러오지 못했어요</h1>
        <p class="body-text">네트워크 상태를 확인하고 다시 시도해 주세요.</p>
        <div class="actions">
          <button class="btn btn-primary" type="button" @click="load">다시 불러오기</button>
        </div>
      </div>
    </section>

    <article v-else-if="result" class="result">
      <header class="result-head">
        <div class="badges">
          <span class="badge">{{ result.status === 'PARTIAL' ? '일부만 완료' : '분석 완료' }}</span>
          <span v-if="hasTab" class="badge">추정 타브</span>
          <span v-if="uncertain.length" class="badge">불확실 구간 {{ uncertain.length }}곳</span>
          <span v-if="result.is_demo" class="badge">데모 샘플</span>
        </div>
        <h1>{{ hasTab ? '코드 악보와 기타 타브' : '코드 악보' }}</h1>
        <p v-if="sourceUrl" class="text-sm text-muted source">
          분석한 영상: <a :href="sourceUrl" target="_blank" rel="noopener noreferrer nofollow">{{ sourceUrl }}</a>
        </p>
      </header>

      <div v-if="result.is_demo" class="notice">
        <p class="notice-title">실제 분석 결과가 아니에요</p>
        <p class="text-sm">
          아직 분석 서버가 연결되지 않아, 화면 확인용 샘플 악보(C – G – Am – Fmaj7)를 보여 드리고 있어요.
        </p>
      </div>

      <div v-if="result.status === 'PARTIAL'" class="notice">
        <p class="notice-title">일부 결과만 만들었어요</p>
        <p class="text-sm">{{ result.quality.note ?? '분석 가능한 부분만 보여 드려요.' }}</p>
      </div>

      <section class="summary" aria-labelledby="summary-title">
        <h2 id="summary-title" class="section-title">코드 진행</h2>
        <ol class="progression">
          <li v-for="(p, i) in progression" :key="i" :class="['chip', { unknown: p.unknown }]">
            {{ p.name }}<span v-if="p.candidates" class="chip-mark" aria-label="후보 여러 개">*</span>
          </li>
        </ol>
        <p v-if="progression.some((p) => p.candidates)" class="text-sm text-muted">
          * 표시는 후보가 여러 개인 코드예요. 아래 악보에서 다른 후보를 확인할 수 있어요.
        </p>
      </section>

      <hr class="divider" />

      <section aria-label="악보">
        <div class="tabs" role="tablist" aria-label="보기 방식">
          <button
            v-for="t in tabs"
            :id="`tab-${t.id}`"
            :key="t.id"
            role="tab"
            type="button"
            :aria-selected="activeTab === t.id"
            :aria-controls="`panel-${t.id}`"
            :tabindex="activeTab === t.id ? 0 : -1"
            :class="['tab', { active: activeTab === t.id }]"
            @click="activeTab = t.id"
            @keydown="onTabKey"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- 코드 + 타브 -->
        <div v-show="activeTab === 'sheet'" id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet" class="panel">
          <p class="text-sm text-muted legend">
            <template v-if="hasTab">
              숫자는 누를 프렛 번호예요(0은 개방현). 맨 위 줄이 가장 가는 1번 줄(e)이에요. 표준 튜닝, 카포 없음 기준이에요.
            </template>
            <template v-else>타브를 만들지 못해 코드만 보여 드려요.</template>
            <span v-if="uncertain.length"> 회색 배경은 확신하기 어려운 구간이에요.</span>
          </p>
          <div class="sheet-scroll">
            <div class="sheet">
              <SheetRow
                v-for="row in rows"
                :key="row.index"
                :row="row"
                :row-seconds="ROW_SECONDS"
                :uncertain="uncertain"
                :show-tab="hasTab"
              />
            </div>
          </div>
        </div>

        <!-- 코드 진행 목록 -->
        <div v-show="activeTab === 'chords'" id="panel-chords" role="tabpanel" aria-labelledby="tab-chords" class="panel">
          <ul class="chord-list">
            <li v-for="(c, i) in result.chords" :key="i" class="chord-item">
              <span class="chord-time text-sm text-muted">{{ formatTime(c.start_time) }}–{{ formatTime(c.end_time) }}</span>
              <span :class="['chord-main', { unknown: c.chord_name === 'UNKNOWN' }]">
                {{ c.chord_name === 'UNKNOWN' ? '미확정' : c.chord_name }}
              </span>
              <span v-if="c.alternatives.length" class="text-sm text-muted">또는 {{ c.alternatives.join(', ') }}</span>
              <span v-if="isUncertain(c)" class="badge">불확실</span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="uncertain.length" class="uncertain" aria-labelledby="uncertain-title">
        <h2 id="uncertain-title" class="section-title">확신하기 어려운 구간</h2>
        <ul class="uncertain-list">
          <li v-for="(s, i) in uncertain" :key="i" class="text-sm">
            <span class="chord-time">{{ formatTime(s.start_time) }}–{{ formatTime(s.end_time) }}</span>
            <span class="body-text">{{ s.reason }}</span>
          </li>
        </ul>
      </section>

      <hr class="divider" />

      <footer class="result-foot">
        <p class="text-sm text-muted">
          이 타브는 원 연주자의 운지를 복원한 것이 아니라, 찾은 음을 기타로 칠 수 있게 다시 배치한 추정 결과예요.
          직접 쳐 보면서 귀로 맞춰 보세요. 결과는 1시간 뒤 삭제돼요.
        </p>
        <NuxtLink to="/" class="btn btn-secondary">다른 영상 분석하기</NuxtLink>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 560px;
  margin: 0 auto;
}

.title {
  margin-bottom: 8px;
}

.body-text {
  color: var(--body);
}

.actions {
  margin-top: 24px;
}

.result {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.result-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source {
  overflow-wrap: anywhere;
}

.notice {
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--body);
}

.notice-title {
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 4px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 12px;
}

.progression {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  padding: 8px 16px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-full);
  font-size: 16px;
  font-weight: 600;
}

.chip.unknown {
  color: var(--muted);
}

.chip-mark {
  color: var(--muted);
  margin-left: 2px;
}

.tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--hairline);
}

.tab {
  background: none;
  border: 0;
  padding: 12px 0;
  margin-bottom: -1px;
  font-size: 16px;
  font-weight: 500;
  color: var(--muted);
  border-bottom: 2px solid transparent;
  cursor: pointer;
}

.tab.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
}

.panel {
  padding-top: 24px;
}

.legend {
  margin-bottom: 16px;
}

.sheet-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: max-content;
}

.chord-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chord-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.chord-time {
  min-width: 88px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.chord-main {
  font-size: 18px;
  font-weight: 600;
  min-width: 64px;
}

.chord-main.unknown {
  color: var(--muted);
}

.uncertain-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.uncertain-list li {
  display: flex;
  gap: 12px;
}

.result-foot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

@media (max-width: 743px) {
  .result-foot .btn {
    width: 100%;
  }
  .uncertain-list li {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
