// GET /api/analyses/:id?token=... — 분석 상태 조회
export default defineEventHandler((event): AnalysisStatusResponse => {
  const id = getRouterParam(event, 'id') ?? ''
  const token = getQuery(event).token
  const job = findJob(id, typeof token === 'string' ? token : undefined)

  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { error_code: 'JOB_NOT_FOUND' } })
  }
  return jobStatus(job)
})
