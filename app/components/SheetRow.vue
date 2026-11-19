<script setup lang="ts">
// 악보 한 행: 위쪽 코드 띠 + 아래쪽 6줄 TAB. 같은 시간 눈금을 써서 코드와 타브가 위아래로 맞춰진다.
// 그리는 데 필요한 좌표 계산은 shared/utils/tab.ts의 순수 함수가 담당한다.

const props = defineProps<{
  row: SheetRow
  rowSeconds: number
  uncertain: UncertainSegment[]
  showTab: boolean
}>()

// 코드 이름 아래에 후보 코드 한 줄을 넣을 자리를 두려고 줄 영역을 조금 내린다.
const g: RowGeometry = { ...DEFAULT_GEOMETRY, top: 60 }
const STRING_LABELS: Record<number, string> = { 1: 'e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'E' }

const size = computed(() => {
  const full = rowSize(props.rowSeconds, g)
  // 코드만 볼 때는 줄 영역을 빼고 코드 띠 높이만 쓴다.
  return props.showTab ? full : { width: full.width, height: 64 }
})

const lineLeft = g.left
const lineRight = computed(() => size.value.width - g.right)

const shaded = computed(() =>
  props.uncertain
    .filter((s) => s.end_time > props.row.start && s.start_time < props.row.end)
    .map((s) => {
      const x1 = xForTime(Math.max(s.start_time, props.row.start), props.row.start, g)
      const x2 = xForTime(Math.min(s.end_time, props.row.end), props.row.start, g)
      return { x: x1, width: Math.max(0, x2 - x1) }
    }),
)

const chordMarks = computed(() =>
  props.row.chords.map((c) => {
    const unknown = c.chord_name === 'UNKNOWN'
    return {
      key: `${c.start_time}-${c.chord_name}`,
      x: xForTime(c.start_time, props.row.start, g),
      label: unknown ? '?' : c.chord_name,
      unknown,
      alternatives: c.alternatives.length ? `또는 ${c.alternatives.join(', ')}` : '',
    }
  }),
)

const notes = computed(() =>
  props.row.notes.map((n, i) => ({
    key: `${i}-${n.start_time}-${n.string_number}`,
    x: xForTime(n.start_time, props.row.start, g) + 8,
    y: yForString(n.string_number, g),
    label: String(n.fret_number),
  })),
)

const ariaLabel = computed(() => {
  const range = `${formatTime(props.row.start)}–${formatTime(props.row.end)}`
  const names = props.row.chords.map((c) => (c.chord_name === 'UNKNOWN' ? '미확정' : c.chord_name)).join(', ')
  return `${range} 구간. 코드: ${names || '없음'}${props.showTab ? `. 타브 음 ${props.row.notes.length}개` : ''}`
})

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <svg
    class="sheet-row"
    :width="size.width"
    :height="size.height"
    :viewBox="`0 0 ${size.width} ${size.height}`"
    role="img"
    :aria-label="ariaLabel"
  >
    <!-- 불확실 구간 음영 -->
    <rect
      v-for="(s, i) in shaded"
      :key="`u${i}`"
      :x="s.x"
      y="0"
      :width="s.width"
      :height="size.height - 18"
      class="uncertain"
    />

    <!-- 코드 띠 -->
    <g v-for="c in chordMarks" :key="c.key">
      <line :x1="c.x" :x2="c.x" y1="6" :y2="showTab ? yForString(6, g) : 44" class="chord-tick" />
      <text :x="c.x + 6" y="24" :class="['chord-name', { unknown: c.unknown }]">{{ c.label }}</text>
      <text v-if="c.alternatives" :x="c.x + 6" y="38" class="chord-alt">{{ c.alternatives }}</text>
    </g>

    <!-- TAB -->
    <template v-if="showTab">
      <g v-for="n in 6" :key="`s${n}`">
        <text :x="lineLeft - 10" :y="yForString(n, g) + 4" class="string-label">{{ STRING_LABELS[n] }}</text>
        <line :x1="lineLeft" :x2="lineRight" :y1="yForString(n, g)" :y2="yForString(n, g)" class="string" />
      </g>
      <line :x1="lineRight" :x2="lineRight" :y1="yForString(1, g)" :y2="yForString(6, g)" class="string" />
      <g v-for="n in notes" :key="n.key">
        <rect :x="n.x - 8" :y="n.y - 9" width="16" height="18" class="fret-bg" />
        <text :x="n.x" :y="n.y + 5" class="fret">{{ n.label }}</text>
      </g>
    </template>

    <!-- 시간 -->
    <text :x="lineLeft" :y="size.height - 4" class="time">{{ formatTime(row.start) }}</text>
    <text :x="lineRight" :y="size.height - 4" class="time end">{{ formatTime(row.end) }}</text>
  </svg>
</template>

<style scoped>
.sheet-row {
  display: block;
  font-family: var(--font);
}

.uncertain {
  fill: var(--surface-strong);
}

.chord-tick {
  stroke: var(--hairline);
  stroke-width: 1;
}

.chord-name {
  fill: var(--ink);
  font-size: 16px;
  font-weight: 600;
}

.chord-name.unknown {
  fill: var(--muted);
}

.chord-alt {
  fill: var(--muted);
  font-size: 11px;
}

.string-label {
  fill: var(--muted);
  font-size: 11px;
  text-anchor: middle;
}

.string {
  stroke: var(--border-strong);
  stroke-width: 1;
}

.fret-bg {
  fill: var(--canvas);
}

.fret {
  fill: var(--ink);
  font-size: 14px;
  font-weight: 600;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}

.time {
  fill: var(--muted-soft);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.time.end {
  text-anchor: end;
}
</style>
