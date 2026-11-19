<template>
  <div class="shell">
    <header class="top-nav">
      <div class="container top-nav-inner">
        <NuxtLink to="/" class="brand">기타 악보 변환</NuxtLink>
        <span class="text-sm text-muted">연주 영상 → 코드 + 추정 타브</span>
      </div>
    </header>
    <main class="container main">
      <NuxtPage />
    </main>
    <footer class="footer">
      <div class="container text-sm text-muted">
        타브는 영상 속 연주자의 운지를 복원한 것이 아니라, 추출된 음정을 기타로 연주할 수 있게
        재배치한 <strong>추정 결과</strong>입니다. 권한이 있는 영상만 분석해 주세요.
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top-nav {
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}

.top-nav-inner {
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand {
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
  color: var(--ink);
}

.main {
  flex: 1;
  padding-top: 48px;
  padding-bottom: 64px;
}

.footer {
  border-top: 1px solid var(--hairline);
  padding: 24px 0;
}

@media (max-width: 743px) {
  .top-nav-inner span {
    display: none;
  }
  .main {
    padding-top: 32px;
  }
}
</style>
