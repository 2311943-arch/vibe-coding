// GET /api/analyses/:id/result?token=... — 분석 결과 조회
export default defineEventHandler((event): AnalysisResult => {
  const id = getRouterParam(event, 'id') ?? ''
  const token = getQuery(event).token
  const job = findJob(id, typeof token === 'string' ? token : undefined)

  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { error_code: 'JOB_NOT_FOUND' } })
  }

  const current = jobStatus(job)
  if (current.status !== 'COMPLETED' && current.status !== 'PARTIAL') {
    // 아직 끝나지 않았거나 실패한 작업은 결과가 없다.
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: { error_code: current.error_code ?? 'NOT_READY', status: current.status },
    })
  }

  return buildDemoResult(job.id, current.status === 'PARTIAL' ? 'partial' : 'ok')
})
