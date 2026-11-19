// POST /api/analyses — 분석 작업 생성
export default defineEventHandler(async (event): Promise<CreateAnalysisResponse> => {
  const body = await readBody<Partial<CreateAnalysisRequest>>(event)

  if (!body || body.source_type !== 'instagram_url' || typeof body.source_url !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { error_code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않습니다.' },
    })
  }

  const checked = validateInstagramUrl(body.source_url)
  if (!checked.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { error_code: checked.error_code, message: checked.message },
    })
  }

  // Apify로 영상을 확인하는 설정이 켜져 있으면, 분석 권한이 있다는 확인을 받아야 한다(PRD 5, 8장).
  const apifyConfig = readApifyConfig(event)
  if (apifyConfig && body.rights_confirmed !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error_code: 'RIGHTS_NOT_CONFIRMED',
        message: '직접 올렸거나 사용 허락을 받은 영상만 분석할 수 있어요. 권한을 확인해 주세요.',
      },
    })
  }

  const created = createJob(checked.url, apifyConfig)
  if ('error' in created) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: { error_code: created.error, message: '지금은 요청이 많아요. 잠시 후 다시 시도해 주세요.' },
    })
  }

  return {
    job_id: created.job.id,
    status: 'QUEUED',
    access_token: created.job.token,
  }
})
