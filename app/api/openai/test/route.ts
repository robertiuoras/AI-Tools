import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY

    if (!openaiApiKey) {
      return NextResponse.json({
        error: 'No API key found',
        details: 'OPENAI_API_KEY or NEXT_PUBLIC_OPENAI_API_KEY not set in environment variables'
      }, { status: 400 })
    }

    // Test the API key with a simple request
    const testResponse = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    })

    if (!testResponse.ok) {
      const errorText = await testResponse.text()
      let errorDetails: any = {}
      try {
        errorDetails = JSON.parse(errorText)
      } catch (e) {
        // Not JSON
      }

      const errorMessage = errorDetails?.error?.message || errorDetails?.message || errorText
      const errorType = errorDetails?.error?.type || errorDetails?.type
      const errorCode = errorDetails?.error?.code || errorDetails?.code
      const retryAfter = testResponse.headers.get('retry-after')

      // Determine error type
      let errorCategory = 'unknown'
      let suggestion = 'Check your API key and account status at https://platform.openai.com/account'
      
      if (testResponse.status === 401) {
        errorCategory = 'authentication'
        suggestion = 'API key is invalid. Check your OPENAI_API_KEY in environment variables.'
      } else if (testResponse.status === 429) {
        errorCategory = 'rate_limit'
        suggestion = `Rate limited. ${retryAfter ? `Retry after ${retryAfter} seconds. ` : ''}Check your tier at https://platform.openai.com/account/limits`
      } else if (testResponse.status === 402 || errorCode === 'insufficient_quota' || errorMessage.includes('billing') || errorMessage.includes('payment')) {
        errorCategory = 'billing'
        suggestion = 'This is a billing/quota issue, NOT a rate limit. Check your billing at https://platform.openai.com/account/billing'
      } else if (errorMessage.includes('organization') || errorType === 'organization_quota_exceeded') {
        errorCategory = 'organization_limit'
        suggestion = 'This is an organization-level limit. Check your organization settings at https://platform.openai.com/org-settings'
      }

      return NextResponse.json({
        error: `API key test failed: ${testResponse.status}`,
        errorCategory,
        details: errorDetails,
        message: errorMessage,
        errorType,
        errorCode,
        retryAfter,
        status: testResponse.status,
        suggestion
      }, { status: testResponse.status })
    }

    const models = await testResponse.json()
    
    // Test actual chat completion to see if we get rate limited
    let chatTestResult: any = null
    try {
      const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 5,
        }),
      })

      if (!chatResponse.ok) {
        const chatErrorText = await chatResponse.text()
        let chatErrorDetails: any = {}
        try {
          chatErrorDetails = JSON.parse(chatErrorText)
        } catch (e) {
          // Not JSON
        }

        const chatErrorMessage = chatErrorDetails?.error?.message || chatErrorDetails?.message || chatErrorText
        const chatErrorType = chatErrorDetails?.error?.type || chatErrorDetails?.type
        const chatErrorCode = chatErrorDetails?.error?.code || chatErrorDetails?.code
        const chatRetryAfter = chatResponse.headers.get('retry-after')

        chatTestResult = {
          success: false,
          status: chatResponse.status,
          error: chatErrorMessage,
          errorType: chatErrorType,
          errorCode: chatErrorCode,
          retryAfter: chatRetryAfter,
          details: chatErrorDetails,
        }
      } else {
        const chatData = await chatResponse.json()
        chatTestResult = {
          success: true,
          status: chatResponse.status,
          model: chatData.model,
          usage: chatData.usage,
        }
      }
    } catch (e) {
      chatTestResult = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
    
    // Also check usage/limits
    const usageResponse = await fetch('https://api.openai.com/v1/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    })

    let usageInfo = null
    if (usageResponse.ok) {
      try {
        usageInfo = await usageResponse.json()
      } catch (e) {
        // Ignore
      }
    }

    return NextResponse.json({
      success: true,
      message: 'API key is valid',
      keyFormat: openaiApiKey.startsWith('sk-') ? 'valid' : 'invalid format',
      keyLength: openaiApiKey.length,
      modelsAvailable: models.data?.length || 0,
      usage: usageInfo,
      chatTest: chatTestResult,
      suggestion: chatTestResult?.success === false && chatTestResult?.status === 429
        ? `Chat completion test failed with rate limit. ${chatTestResult.retryAfter ? `Retry after ${chatTestResult.retryAfter} seconds. ` : ''}Check your RPM limit at https://platform.openai.com/account/limits`
        : chatTestResult?.success === false && (chatTestResult?.errorCode === 'insufficient_quota' || chatTestResult?.status === 402)
        ? 'Chat completion test failed with billing/quota issue. This is NOT a rate limit. Check your billing at https://platform.openai.com/account/billing'
        : chatTestResult?.success === false
        ? `Chat completion test failed: ${chatTestResult.error || 'Unknown error'}. Check your account at https://platform.openai.com/account`
        : 'If you\'re still getting 429 errors, check your RPM (requests per minute) limit at https://platform.openai.com/account/limits'
    })
  } catch (error: any) {
    return NextResponse.json({
      error: 'Error testing API key',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}

